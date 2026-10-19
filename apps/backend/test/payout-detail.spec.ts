import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus, BusinessMemberRole, LedgerEntryType } from '@prisma/client';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, addMember, asUser, createAppointment, createBusiness, createCustomer } from './setup/factories';

const DAY = 86_400_000;

/**
 * A payout opened by its shop (§290): the bookings whose money is in it, the
 * totals over all of it, a page at a time, as a spreadsheet — and only for
 * the people allowed to read the shop's money.
 */
describe('A payout, opened by its shop (§290)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payouts: PayoutsService;
  let shop: TestBusiness;
  let other: TestBusiness;
  let payoutId: string;
  const appointmentIds: string[] = [];
  let customerEmail: string;

  beforeAll(async () => {
    moduleRef = await createTestModule([PayoutsService, PayoutDestinationsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    payouts = moduleRef.get(PayoutsService);
    await resetDatabase(prisma);
    shop = await createBusiness(prisma);
    other = await createBusiness(prisma);
    const customer = await createCustomer(prisma);
    customerEmail = customer.email;

    // Three bookings: two done (deposit 1000, fee −200 each), one the shop
    // cancelled (deposit given back, fee returned, the operator's fee kept).
    for (const [i, status] of [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.CANCELLED,
    ].entries()) {
      const appointment = await createAppointment(prisma, {
        business: shop,
        customerId: customer.userId,
        status,
        startsInHours: -72 + i,
      });
      appointmentIds.push(appointment.id);
      const line = (type: LedgerEntryType, amount: number) =>
        prisma.ledgerEntry.create({
          data: {
            businessId: shop.businessId,
            appointmentId: appointment.id,
            type,
            amountMinor: amount,
            currency: 'USD',
            settlementCurrency: 'RWF',
            settlementAmountMinor: amount,
            bookingExchangeRate: 1,
            availableAt: new Date(Date.now() - DAY),
          },
        });
      await line(LedgerEntryType.DEPOSIT_RECEIVED, 1000);
      await line(LedgerEntryType.PLATFORM_FEE, -200);
      if (status === AppointmentStatus.CANCELLED) {
        await line(LedgerEntryType.DEPOSIT_REFUND, -1000);
        await line(LedgerEntryType.PLATFORM_FEE_REVERSAL, 200);
        await line(LedgerEntryType.GATEWAY_FEE_DEBIT, -30);
      }
    }
    await payouts.run();
    payoutId = (await prisma.payout.findFirstOrThrow({ where: { businessId: shop.businessId } })).id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const owner = () => asUser(shop.userId, 'BUSINESS');

  it('lists each booking with its service, branch, customer and money, and adds it all up', async () => {
    const detail = await payouts.detailForBusiness(owner(), shop.businessId, payoutId, {});

    expect(detail.payout.settlementAmountMinor).toBe(1570);
    expect(detail.totals).toEqual({
      bookings: 3,
      depositsMinor: 3000,
      platformFeesMinor: -600,
      refundsMinor: -1000,
      feesReturnedMinor: 200,
      gatewayFeesMinor: -30,
      adjustmentsMinor: 0,
      netMinor: 1570,
    });
    expect(detail.bookings.map((b) => b.appointmentId)).toEqual(appointmentIds);
    expect(detail.bookings[0]).toMatchObject({
      serviceName: 'Test Service',
      branchName: 'Test Branch',
      customerEmail,
      status: AppointmentStatus.COMPLETED,
      depositMinor: 1000,
      platformFeeMinor: -200,
      others: [],
      netMinor: 800,
    });
    expect(detail.bookings[2].netMinor).toBe(-30);
    expect(detail.bookings[2].others).toEqual(
      expect.arrayContaining([
        { type: LedgerEntryType.DEPOSIT_REFUND, amountMinor: -1000 },
        { type: LedgerEntryType.PLATFORM_FEE_REVERSAL, amountMinor: 200 },
        { type: LedgerEntryType.GATEWAY_FEE_DEBIT, amountMinor: -30 },
      ]),
    );
    // Not sent yet: where it will go, by its end only.
    expect(detail.sendTo?.last3).toHaveLength(3);
    expect(detail.holdDays).toBeGreaterThan(0);
  });

  it('pages the bookings but keeps the totals whole', async () => {
    const page = await payouts.detailForBusiness(owner(), shop.businessId, payoutId, { limit: 2, offset: 2 });
    expect(page.bookings.map((b) => b.appointmentId)).toEqual([appointmentIds[2]]);
    expect(page.totals.bookings).toBe(3);
    expect(page.totals.netMinor).toBe(1570);
  });

  it('gives the whole payout as a spreadsheet, every booking and the total', async () => {
    const { csv, filename } = await payouts.exportForBusiness(owner(), shop.businessId, payoutId);
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toContain('Reservation No.');
    expect(rows).toHaveLength(1 + 3 + 1);
    expect(rows[1]).toContain(customerEmail);
    expect(rows[rows.length - 1]).toMatch(/^Total,.*,3000,-600,-830,1570,RWF$/);
    expect(filename).toMatch(/^payout-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('is only for the shop’s money people, and never another shop’s', async () => {
    await expect(
      payouts.detailForBusiness(asUser(other.userId, 'BUSINESS'), shop.businessId, payoutId, {}),
    ).rejects.toThrow(NotFoundException);
    await expect(
      payouts.detailForBusiness(asUser(other.userId, 'BUSINESS'), other.businessId, payoutId, {}),
    ).rejects.toThrow(NotFoundException);
    const staff = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
    await expect(
      payouts.detailForBusiness(asUser(staff.userId, 'BUSINESS'), shop.businessId, payoutId, {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('counts a payment on its way until it arrives — waiting to be sent or with the operator (§291)', async () => {
    expect(await payouts.balance(owner(), shop.businessId)).toMatchObject({ onTheWayMinor: 1570, onTheWayCount: 1 });
    await prisma.payout.update({ where: { id: payoutId }, data: { status: 'PROCESSING', sentAt: new Date() } });
    expect(await payouts.balance(owner(), shop.businessId)).toMatchObject({ onTheWayMinor: 1570, onTheWayCount: 1 });
    await prisma.payout.update({ where: { id: payoutId }, data: { status: 'PAID', paidAt: new Date(), reference: 'T-1' } });
    expect(await payouts.balance(owner(), shop.businessId)).toMatchObject({
      onTheWayMinor: 0,
      onTheWayCount: 0,
      lifetimePaidMinor: 1570,
    });
    await prisma.payout.update({ where: { id: payoutId }, data: { status: 'PENDING', sentAt: null, paidAt: null, reference: null } });
  });

  it('says how long money waits on the balance too', async () => {
    const balance = await payouts.balance(owner(), shop.businessId);
    expect(balance.holdDays).toBeGreaterThan(0);
  });
});
