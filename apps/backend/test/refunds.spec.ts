import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BillingAdjustmentType,
  CancelledBy,
  LedgerEntryType,
  Prisma,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  asUser,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

const DAY = 86_400_000;

/**
 * Business-cancellation refunds and executed adjustments (§36).
 *
 * The question every test here asks is the same one: after this happened, what
 * does the ledger say the business's position is? A refund that leaves them up
 * or down by a cent is a refund that will be argued about.
 */
describe('Refunds and adjustments (§36)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let payouts: PayoutsService;
  let ledger: LedgerService;

  let admin: { userId: string; email: string };
  let business: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      PayoutsService,
      PayoutDestinationsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    payouts = moduleRef.get(PayoutsService);
    ledger = moduleRef.get(LedgerService);
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
    admin = await createAdmin(prisma);
    business = await createBusiness(prisma, { priceCents: 4500, depositPercentage: 20 });
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');

  /** A booked appointment whose deposit has been confirmed. */
  const paidAppointment = async () => {
    const a = await createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.PENDING_PAYMENT,
    });
    const reference = `ref-${a.id}`;
    await prisma.appointment.update({
      where: { id: a.id },
      data: {
        paymentProviderReferenceId: reference,
        paymentInitiatedAt: new Date(),
        startTime: new Date(Date.now() - DAY - 3_600_000),
        endTime: new Date(Date.now() - DAY),
      },
    });
    await appointments.applyPaymentResult(a.id, reference, 'SUCCESSFUL');
    return prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
  };

  const entriesFor = (appointmentId: string) =>
    prisma.ledgerEntry.findMany({ where: { appointmentId }, orderBy: { type: 'asc' } });

  const netFor = async (appointmentId: string) =>
    (await entriesFor(appointmentId)).reduce((sum, e) => sum + e.amountCents, 0);

  const shape = (entries: Array<{ type: LedgerEntryType; amountCents: number; currency: string }>) =>
    entries
      .map((e) => ({ type: e.type, amountCents: e.amountCents, currency: e.currency }))
      .sort((a, b) => a.type.localeCompare(b.type));

  describe('a business cancellation refunds the customer in full', () => {
    it('appends the three reversal entries', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Stylist is ill.',
        gatewayChargeMinor: 32_500,
      });

      const entries = await entriesFor(a.id);
      const byType = Object.fromEntries(entries.map((e) => [e.type, e.amountCents]));
      expect(byType[LedgerEntryType.DEPOSIT_REFUND]).toBe(-a.depositAmountCents);
      expect(byType[LedgerEntryType.PLATFORM_FEE_REVERSAL]).toBe(a.platformFeeAmountCents);
      // 32 500 SSP at the booking rate of 650 is 50 USD cents (§45.4).
      expect(byType[LedgerEntryType.GATEWAY_FEE_DEBIT]).toBe(-50);
    });

    it('the refund pair nets to exactly -businessAmountCents', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      const entries = await entriesFor(a.id);
      const refundPair = entries
        .filter(
          (e) =>
            e.type === LedgerEntryType.DEPOSIT_REFUND ||
            e.type === LedgerEntryType.PLATFORM_FEE_REVERSAL,
        )
        .reduce((sum, e) => sum + e.amountCents, 0);

      // It cancels the pair appended when the deposit landed, exactly.
      expect(refundPair).toBe(-a.businessAmountCents);
    });

    it("zeroes the business's position for that appointment, less the gateway charge", async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      // Everything the appointment ever produced, summed: only the gateway's
      // charge is left, and it is the business's to bear (§25).
      expect(await netFor(a.id)).toBe(-50);
    });

    it('leaves the business exactly at zero when the gateway charged nothing', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 0,
      });

      expect(await netFor(a.id)).toBe(0);
    });

    it('refunds the customer the FULL deposit, platform fee included', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      const refund = (await entriesFor(a.id)).find(
        (e) => e.type === LedgerEntryType.DEPOSIT_REFUND,
      )!;
      // What the customer gets back is the whole deposit, not the deposit less
      // the platform's cut. The platform gives its own fee up (§25.1).
      expect(Math.abs(refund.amountCents)).toBe(a.depositAmountCents);
      expect(Math.abs(refund.amountCents)).toBeGreaterThan(a.businessAmountCents);
    });

    it('makes every entry payable at once — there is nothing left to wait for', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      const entries = await entriesFor(a.id);
      expect(entries).toHaveLength(5);
      expect(entries.every((e) => e.availableAt !== null)).toBe(true);
    });

    it('shows up as a negative balance that blocks a payout and carries forward', async () => {
      const a = await paidAppointment();
      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      const balance = await payouts.balance(AS_ADMIN(), business.businessId);
      const summary = await payouts.run();

      expect(balance.availableNowCents).toBeLessThan(0);
      expect(summary.payoutsCreated).toBe(0);
    });

    it('requires the gateway charge, and refuses to guess it', async () => {
      const a = await paidAppointment();

      await expect(
        appointments.cancel(business.userId, a.id, { reason: 'Closed.' }),
      ).rejects.toThrow(/gatewayChargeMinor is required/);

      // Nothing was written: the appointment is still BOOKED and unrefunded.
      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.status).toBe(AppointmentStatus.BOOKED);
      expect(await entriesFor(a.id)).toHaveLength(2);
    });

    it('does not require it when the deposit was never paid', async () => {
      const held = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });

      const cancelled = await appointments.cancel(business.userId, held.id, {
        reason: 'Never paid.',
      });

      // No money arrived, so there is nothing to refund and no charge to bear.
      expect(cancelled.cancelledBy).toBe(CancelledBy.BUSINESS);
      expect(await entriesFor(held.id)).toHaveLength(0);
    });

    it('refuses to refund the same appointment twice', async () => {
      const a = await paidAppointment();
      await appointments.cancel(business.userId, a.id, {
        reason: 'Closed.',
        gatewayChargeMinor: 32_500,
      });

      await expect(
        prisma.$transaction((tx) =>
          ledger.recordBusinessCancellationRefund(tx, a.id, 50),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('a customer cancellation and a no-show append nothing', () => {
    it('customer cancellation: the existing entries are all there is', async () => {
      const a = await paidAppointment();

      await appointments.cancel(customer.userId, a.id);

      // The absence IS the behaviour. §2's deposit is non-refundable, so
      // nothing reverses — the business simply keeps its share.
      const entries = await entriesFor(a.id);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.type).sort()).toEqual([
        LedgerEntryType.DEPOSIT_RECEIVED,
        LedgerEntryType.PLATFORM_FEE,
      ]);
      expect(await netFor(a.id)).toBe(a.businessAmountCents);
    });

    it('no-show: the same, and the business is paid', async () => {
      const a = await paidAppointment();

      await appointments.noShow(business.userId, a.id);

      const entries = await entriesFor(a.id);
      expect(entries).toHaveLength(2);
      expect(
        entries.some((e) => e.type === LedgerEntryType.DEPOSIT_REFUND),
      ).toBe(false);
      expect(await netFor(a.id)).toBe(a.businessAmountCents);
    });

    it('neither produces a gateway debit', async () => {
      const a = await paidAppointment();
      await appointments.cancel(customer.userId, a.id);

      const b = await paidAppointment();
      await appointments.noShow(business.userId, b.id);

      const all = [...(await entriesFor(a.id)), ...(await entriesFor(b.id))];
      expect(
        all.some((e) => e.type === LedgerEntryType.GATEWAY_FEE_DEBIT),
      ).toBe(false);
    });
  });

  describe('the admin dispute path runs the same refund, not a second one', () => {
    it('produces identical ledger entries to a self-service cancellation', async () => {
      const selfService = await paidAppointment();
      await appointments.cancel(business.userId, selfService.id, {
        reason: 'We closed.',
        gatewayChargeMinor: 32_500,
      });

      const disputed = await paidAppointment();
      await appointments.cancel(customer.userId, disputed.id);
      const ticket = await prisma.ticket.create({
        data: {
          reference: `TKT-DISPUTE-${Date.now()}`,
          reporterId: customer.userId,
          reporterType: 'CUSTOMER',
          category: 'APPOINTMENT_DISPUTE',
          subject: 'The shop was closed when I arrived',
          lastMessageAt: new Date(),
        },
      });

      await appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), disputed.id, {
        reason: 'Business did not open.',
        ticketId: ticket.id,
        gatewayChargeMinor: 32_500,
      });

      // Same types, same signs, same amounts. One implementation, called twice.
      expect(shape(await entriesFor(disputed.id))).toEqual(
        shape(await entriesFor(selfService.id)),
      );
      expect(await netFor(disputed.id)).toBe(-50);
    });

    it('records BUSINESS as responsible and the ADMIN as the actor', async () => {
      const a = await paidAppointment();
      await appointments.cancel(customer.userId, a.id);

      await appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), a.id, {
        reason: 'Business did not open.',
        gatewayChargeMinor: 16_250,
      });

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      // The exact divergence the two columns were kept apart for (§33.2).
      expect(row.cancelledBy).toBe(CancelledBy.BUSINESS);
      expect(row.cancelledByUserId).toBe(admin.userId);
      expect(row.cancelledByUserId).not.toBe(customer.userId);
    });

    it('links the ticket the decision came out of', async () => {
      const a = await paidAppointment();
      const ticket = await prisma.ticket.create({
        data: {
          reference: `TKT-LINK-${Date.now()}`,
          reporterId: customer.userId,
          reporterType: 'CUSTOMER',
          category: 'APPOINTMENT_DISPUTE',
          subject: 'Dispute',
          lastMessageAt: new Date(),
        },
      });

      await appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), a.id, {
        reason: 'Resolved for the customer.',
        ticketId: ticket.id,
        gatewayChargeMinor: 16_250,
      });

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.cancellationTicketId).toBe(ticket.id);
    });

    it('refuses a non-admin', async () => {
      const a = await paidAppointment();

      await expect(
        appointments.reclassifyAsBusinessCancellation(
          asUser(business.userId, 'BUSINESS'),
          a.id,
          { reason: 'Let me off.', gatewayChargeMinor: 0 },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to reclassify twice, so it cannot refund twice', async () => {
      const a = await paidAppointment();
      await appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), a.id, {
        reason: 'First.',
        gatewayChargeMinor: 16_250,
      });

      await expect(
        appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), a.id, {
          reason: 'Second.',
          gatewayChargeMinor: 16_250,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await netFor(a.id)).toBe(-25);
    });

    it('refuses an unknown ticket', async () => {
      const a = await paidAppointment();

      await expect(
        appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), a.id, {
          reason: 'Ghost ticket.',
          ticketId: '00000000-0000-4000-8000-000000000000',
          gatewayChargeMinor: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('executing a BillingAdjustment', () => {
    const adjustment = async (type: BillingAdjustmentType, amount: number) => {
      const a = await paidAppointment();
      return prisma.billingAdjustment.create({
        data: {
          businessId: business.businessId,
          appointmentId: a.id,
          type,
          amount: new Prisma.Decimal(amount),
          reason: 'Agreed in support.',
          createdById: admin.userId,
        },
      });
    };

    const execute = (id: string, ref: string | null = 'REF-1') =>
      prisma.$transaction((tx) => ledger.executeAdjustment(tx, id, ref, { role: 'ADMIN' }));

    it('emits a signed ADJUSTMENT entry and settles the row', async () => {
      const row = await adjustment(BillingAdjustmentType.FEE_REFUND, 12.5);

      const { adjustment: settled, entry } = await execute(row.id);

      // Major units on the adjustment, integer cents in the ledger.
      expect(entry.amountCents).toBe(1250);
      expect(entry.type).toBe(LedgerEntryType.ADJUSTMENT);
      expect(entry.billingAdjustmentId).toBe(row.id);
      expect(settled.settledAt).not.toBeNull();
      expect(settled.settlementRef).toBe('REF-1');
    });

    it('signs a GATEWAY_FEE_DEBIT negative, against the business', async () => {
      const row = await adjustment(BillingAdjustmentType.GATEWAY_FEE_DEBIT, 0.9);

      const { entry } = await execute(row.id);

      expect(entry.amountCents).toBe(-90);
    });

    it('makes it payable immediately', async () => {
      const row = await adjustment(BillingAdjustmentType.FEE_REFUND, 5);

      const { entry } = await execute(row.id);

      // A decision already made. There is no appointment outcome left to wait
      // for, so there is nothing to hold it against.
      expect(entry.availableAt).not.toBeNull();
    });

    it('cannot be executed twice', async () => {
      const row = await adjustment(BillingAdjustmentType.FEE_REFUND, 5);
      await execute(row.id);

      await expect(execute(row.id)).rejects.toBeInstanceOf(ConflictException);
      // And no second entry was written.
      expect(
        await prisma.ledgerEntry.count({ where: { billingAdjustmentId: row.id } }),
      ).toBe(1);
    });

    it('404s on an adjustment that does not exist', async () => {
      await expect(
        execute('00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('moves the balance the business sees', async () => {
      const row = await adjustment(BillingAdjustmentType.GATEWAY_FEE_DEBIT, 1);
      const before = await payouts.balance(AS_ADMIN(), business.businessId);

      await execute(row.id);

      const after = await payouts.balance(AS_ADMIN(), business.businessId);
      expect(after.availableNowCents).toBe(before.availableNowCents - 100);
    });
  });

  describe('held total', () => {
    it('equals the sum of every unstamped entry, in SETTLEMENT currency', async () => {
      const entries = await prisma.ledgerEntry.findMany({ where: { payoutId: null } });
      const expectedMinor = entries.reduce(
        (sum, e) => sum + (e.settlementAmountMinor ?? 0),
        0,
      );
      const expectedUsd = entries.reduce((sum, e) => sum + e.amountCents, 0);

      const held = await ledger.heldTotals({ role: 'ADMIN' });

      // The figure an operator compares against MTN's balance is the one in the
      // currency the money is actually held in (§51.1).
      const withSettlement = entries.filter((e) => e.settlementCurrency !== null);
      const ssp = held.bySettlementCurrency.find((c) => c.settlementCurrency === 'SSP')!;
      expect(ssp.amountMinor).toBe(expectedMinor);
      expect(ssp.entryCount).toBe(withSettlement.length);
      // Entries with no settlement figure are money the platform holds but
      // cannot pay out (§45.1). Counted separately rather than folded into a
      // currency they do not belong to.
      expect(held.entriesWithoutSettlement).toBe(
        entries.length - withSettlement.length,
      );
      expect(held.totalEntries).toBe(entries.length);
      // USD is carried alongside, explicitly labelled as reporting.
      expect(ssp.reportingUsdCents).toBeLessThanOrEqual(expectedUsd);
    });

    it('drops entries once a payout has settled them', async () => {
      await prisma.ledgerEntry.deleteMany({});
      await prisma.payout.deleteMany({});
      const a = await paidAppointment();
      await appointments.noShow(business.userId, a.id);
      await prisma.ledgerEntry.updateMany({
        where: { appointmentId: a.id },
        data: { availableAt: new Date(Date.now() - DAY) },
      });

      const before = await ledger.heldTotals({ role: 'ADMIN' });
      await payouts.run();
      const after = await ledger.heldTotals({ role: 'ADMIN' });

      expect(before.bySettlementCurrency[0].reportingUsdCents).toBe(
        a.businessAmountCents,
      );
      // Settled money is no longer held: it has gone out.
      expect(after.bySettlementCurrency).toHaveLength(0);
      expect(after.totalEntries).toBe(0);
    });

    it('counts matured and unmatured money alike', async () => {
      await prisma.ledgerEntry.deleteMany({});
      await prisma.payout.deleteMany({});
      const a = await paidAppointment();

      const held = await ledger.heldTotals({ role: 'ADMIN' });

      // Still BOOKED, so availableAt is null — but the platform is holding the
      // money all the same, and that is what this figure is for.
      expect(held.bySettlementCurrency[0].reportingUsdCents).toBe(
        a.businessAmountCents,
      );
      expect(held.bySettlementCurrency[0].entryCount).toBe(2);
      expect(held.bySettlementCurrency[0].settlementCurrency).toBe('SSP');
    });
  });

  describe('ledger admin operations assert the role in the service (§41)', () => {
    const NON_ADMINS = ['CUSTOMER', 'BUSINESS'];

    it.each(NON_ADMINS)('refuses a %s the held total', async (role) => {
      await expect(ledger.heldTotals({ role })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it.each(NON_ADMINS)('refuses a %s executing an adjustment', async (role) => {
      const a = await paidAppointment();
      const row = await prisma.billingAdjustment.create({
        data: {
          businessId: business.businessId,
          appointmentId: a.id,
          type: BillingAdjustmentType.FEE_REFUND,
          amount: new Prisma.Decimal(5),
          reason: 'Agreed in support.',
          createdById: admin.userId,
        },
      });

      await expect(
        prisma.$transaction((tx) =>
          ledger.executeAdjustment(tx, row.id, 'REF-X', { role }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Nothing settled, and no entry written.
      const after = await prisma.billingAdjustment.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.settledAt).toBeNull();
      expect(
        await prisma.ledgerEntry.count({ where: { billingAdjustmentId: row.id } }),
      ).toBe(0);
    });

    it.each(NON_ADMINS)('refuses a %s triggering a payout run', async (role) => {
      await expect(payouts.runAsAdmin({ role })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('still lets the scheduler run payouts with no acting user', async () => {
      // The cron path is a legitimate caller with no actor (§41.2).
      const summary = await payouts.run();

      expect(summary).toHaveProperty('payoutsCreated');
    });
  });

  describe('admin ledger reads (§53.3)', () => {
    const AS = { role: 'ADMIN' };

    it('lists the entries behind one appointment', async () => {
      const a = await paidAppointment();

      const page = await ledger.listEntries(AS, { appointmentId: a.id });

      expect(page.total).toBe(2);
      expect(page.entries.map((e) => e.type).sort()).toEqual([
        LedgerEntryType.DEPOSIT_RECEIVED,
        LedgerEntryType.PLATFORM_FEE,
      ]);
    });

    it('filters by business and by type', async () => {
      const a = await paidAppointment();

      const fees = await ledger.listEntries(AS, {
        businessId: business.businessId,
        type: LedgerEntryType.PLATFORM_FEE,
      });

      expect(fees.entries.every((e) => e.type === LedgerEntryType.PLATFORM_FEE)).toBe(
        true,
      );
      expect(fees.entries.some((e) => e.appointmentId === a.id)).toBe(true);
    });

    it('totals over the WHOLE filter, not the page', async () => {
      const a = await paidAppointment();

      const page = await ledger.listEntries(AS, { appointmentId: a.id, limit: 1 });

      // A total that changed when you turned the page would be worse than none.
      expect(page.entries).toHaveLength(1);
      expect(page.total).toBe(2);
      const ssp = page.totalsBySettlementCurrency.find(
        (t) => t.settlementCurrency === 'SSP',
      );
      expect(ssp?.reportingUsdCents).toBe(a.businessAmountCents);
    });

    it('lists adjustments, unsettled first, and counts what is outstanding', async () => {
      const a = await paidAppointment();
      const row = await prisma.billingAdjustment.create({
        data: {
          businessId: business.businessId,
          appointmentId: a.id,
          type: BillingAdjustmentType.FEE_REFUND,
          amount: new Prisma.Decimal(2),
          reason: 'Recorded, not yet executed.',
          createdById: admin.userId,
        },
      });

      const page = await ledger.listAdjustments(AS, { appointmentId: a.id });

      expect(page.total).toBe(1);
      // The state where a decision was taken and no money moved is exactly the
      // one somebody needs to find (§36.5).
      expect(page.outstanding).toBe(1);
      expect(page.adjustments[0].id).toBe(row.id);
      expect(page.adjustments[0].settledAt).toBeNull();
      expect(page.adjustments[0].ledgerEntries).toHaveLength(0);
    });

    it('shows an executed adjustment linked to its entry', async () => {
      const a = await paidAppointment();
      const row = await prisma.billingAdjustment.create({
        data: {
          businessId: business.businessId,
          appointmentId: a.id,
          type: BillingAdjustmentType.FEE_REFUND,
          amount: new Prisma.Decimal(3),
          reason: 'Will be executed.',
          createdById: admin.userId,
        },
      });
      await prisma.$transaction((tx) =>
        ledger.executeAdjustment(tx, row.id, 'REF-READ', AS),
      );

      const page = await ledger.listAdjustments(AS, { appointmentId: a.id });

      expect(page.outstanding).toBe(0);
      expect(page.adjustments[0].settledAt).not.toBeNull();
      expect(page.adjustments[0].ledgerEntries).toHaveLength(1);
    });

    it.each(['CUSTOMER', 'BUSINESS'])('refuses a %s both reads', async (role) => {
      await expect(ledger.listEntries({ role }, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(ledger.listAdjustments({ role }, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
