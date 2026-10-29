import { ForbiddenException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import {
  AppointmentStatus,
  BusinessStatus,
  LedgerEntryType,
  ReporterType,
  TicketCategory,
  UserRole,
} from '@prisma/client';
import { AdminOverviewService, OVERVIEW_DAYS } from '../src/analytics/admin-overview.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, asUser, createAdmin, createAppointment, createBusiness, createCustomer } from './setup/factories';

const DAY = 86_400_000;

/**
 * The admin console's home page (§243): the queues, the last fourteen days in
 * the platform's own time zone, and fees net of what was handed back.
 */
describe('The admin overview (§243)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let overview: AdminOverviewService;
  let admin: { userId: string };
  let shop: TestBusiness;

  /** A paid booking, its deposit landing `daysAgo` days ago, with its fee in the ledger. */
  const paidBooking = async (daysAgo: number, deposit: number, fee: number) => {
    const customer = await createCustomer(prisma);
    const at = new Date(Date.now() - daysAgo * DAY);
    const appointment = await createAppointment(prisma, {
      business: shop,
      customerId: customer.userId,
      status: AppointmentStatus.BOOKED,
    });
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { depositPaidAt: at, depositAmountMinor: deposit, platformFeeAmountMinor: fee },
    });
    await prisma.ledgerEntry.create({
      data: {
        businessId: shop.businessId,
        appointmentId: appointment.id,
        type: LedgerEntryType.PLATFORM_FEE,
        amountMinor: -fee,
        currency: 'RWF',
        createdAt: at,
      },
    });
    return appointment;
  };

  beforeAll(async () => {
    moduleRef = await createTestModule([AdminOverviewService]);
    prisma = moduleRef.get(PrismaService);
    overview = moduleRef.get(AdminOverviewService);
    await resetDatabase(prisma);

    admin = await createAdmin(prisma);
    // The money figures are for administrators with money access (§317).
    await prisma.user.update({ where: { id: admin.userId }, data: { moneyAccess: true } });
    // A live shop, and one waiting for approval with an unverified number.
    shop = await createBusiness(prisma);
    await createBusiness(prisma, { status: BusinessStatus.PENDING, payoutDestination: 'UNVERIFIED' });

    // This week: two paid bookings; last week: one. One fee handed back.
    const refunded = await paidBooking(0, 1000, 100);
    await paidBooking(2, 3000, 300);
    await paidBooking(9, 5000, 500);
    await prisma.ledgerEntry.create({
      data: {
        businessId: shop.businessId,
        appointmentId: refunded.id,
        type: LedgerEntryType.PLATFORM_FEE_REVERSAL,
        amountMinor: 100,
        currency: 'RWF',
      },
    });
    // An unpaid hold never counts as a booking.
    const stranger = await createCustomer(prisma);
    await createAppointment(prisma, { business: shop, customerId: stranger.userId, status: AppointmentStatus.PENDING_PAYMENT });

    // One new ticket, nobody on it.
    await prisma.ticket.create({
      data: {
        reference: 'TKT-TEST-1',
        reporterId: stranger.userId,
        reporterType: ReporterType.CUSTOMER,
        category: TicketCategory.OTHER,
        subject: 'Help',
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  it('is for administrators only', async () => {
    await expect(overview.overview(asUser(shop.userId, UserRole.BUSINESS))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('counts each queue, with when its oldest item arrived', async () => {
    const { waiting } = await overview.overview(asUser(admin.userId, UserRole.ADMIN));
    expect(waiting.businesses.count).toBe(1);
    expect(waiting.businesses.oldestAt).not.toBeNull();
    expect(waiting.destinations?.count).toBe(1);
    expect(waiting.tickets).toMatchObject({ count: 1, unassigned: 1 });
    expect(waiting.payouts).toMatchObject({ count: 0, oldestAt: null, amounts: [] });
  });

  it('gives fourteen days, today last, with bookings on the day their deposit was paid', async () => {
    const result = await overview.overview(asUser(admin.userId, UserRole.ADMIN));
    expect(result.days).toHaveLength(OVERVIEW_DAYS);
    expect(result.days.reduce((sum, d) => sum + d.bookings, 0)).toBe(3);
    expect(result.days[OVERVIEW_DAYS - 1].bookings).toBe(1);
  });

  it('compares this week with last, fees net of what was handed back', async () => {
    const { thisWeek, lastWeek } = await overview.overview(asUser(admin.userId, UserRole.ADMIN));
    expect(thisWeek).toMatchObject({ bookings: 2, depositsMinor: 4000, feesMinor: 300 });
    expect(lastWeek).toMatchObject({ bookings: 1, depositsMinor: 5000, feesMinor: 500 });
  });

  it('leaves the money out for an administrator without money access (§317)', async () => {
    const helper = await createAdmin(prisma);
    const result = await overview.overview(asUser(helper.userId, UserRole.ADMIN));
    expect(result.moneyAccess).toBe(false);
    expect(result.waiting.payouts).toBeNull();
    expect(result.waiting.destinations).toBeNull();
    expect(result.waiting.businesses.count).toBe(1);
    expect(result.thisWeek).toMatchObject({ bookings: 2, depositsMinor: null, feesMinor: null });
    expect(result.days.every((d) => d.depositsMinor === null && d.feesMinor === null)).toBe(true);
  });

  it('counts what customers can find', async () => {
    const { totals } = await overview.overview(asUser(admin.userId, UserRole.ADMIN));
    expect(totals.liveBusinesses).toBe(1);
    expect(totals.liveBranches).toBe(1);
    expect(totals.customers).toBe(4);
  });
});
