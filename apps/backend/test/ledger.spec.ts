import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppointmentStatus,
  CancelledBy,
  LedgerEntryType,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AppointmentsScheduler } from '../src/appointments/appointments.scheduler';
import { PaymentsScheduler } from '../src/appointments/payments.scheduler';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService, PAYOUT_HOLD_DAYS } from '../src/ledger/ledger.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

const DAY = 86_400_000;
const HOLD_MS = PAYOUT_HOLD_DAYS * DAY;

/**
 * The ledger is the only record of what the platform owes anyone (§34). Every
 * test here asks one of two questions: did the right entries appear, and did
 * they become payable at the right moment. A balance is never stored, so a
 * wrong entry is the only way a business can be paid the wrong amount.
 */
describe('Ledger (§34)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let scheduler: AppointmentsScheduler;
  let business: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AppointmentsScheduler,
      PaymentsScheduler,
      AvailabilityService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    scheduler = moduleRef.get(AppointmentsScheduler);
    await resetDatabase(prisma);
    business = await createBusiness(prisma, { priceCents: 4500, depositPercentage: 20 });
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const entriesFor = (appointmentId: string) =>
    prisma.ledgerEntry.findMany({
      where: { appointmentId },
      orderBy: { type: 'asc' },
    });

  /** Books, then drives the deposit through to confirmation. */
  const paidAppointment = async (options: { endsInDays?: number } = {}) => {
    const endsInDays = options.endsInDays ?? -1;
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
        // Moved into the past so resolution rules have a real end time to
        // count from.
        startTime: new Date(Date.now() + endsInDays * DAY - 3_600_000),
        endTime: new Date(Date.now() + endsInDays * DAY),
      },
    });
    await appointments.applyPaymentResult(a.id, reference, 'SUCCESSFUL');
    return prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
  };

  describe('a confirmed deposit appends two entries', () => {
    it('records the deposit in and the platform fee out', async () => {
      const a = await paidAppointment();

      const entries = await entriesFor(a.id);

      expect(entries).toHaveLength(2);
      const deposit = entries.find((e) => e.type === LedgerEntryType.DEPOSIT_RECEIVED)!;
      const fee = entries.find((e) => e.type === LedgerEntryType.PLATFORM_FEE)!;
      expect(deposit.amountCents).toBe(a.depositAmountCents);
      // Signed from the business's point of view: the fee leaves them.
      expect(fee.amountCents).toBe(-a.platformFeeAmountCents);
      expect(deposit.currency).toBe(a.currency);
    });

    it('nets to businessAmountCents exactly', async () => {
      const a = await paidAppointment();

      const entries = await entriesFor(a.id);
      const net = entries.reduce((sum, e) => sum + e.amountCents, 0);

      // The invariant the whole ledger hangs on: what the rows say a business
      // is owed for an appointment equals what the appointment says.
      expect(net).toBe(a.businessAmountCents);
    });

    it('attributes them to the business that owns the location', async () => {
      const a = await paidAppointment();

      const entries = await entriesFor(a.id);

      expect(entries.every((e) => e.businessId === business.businessId)).toBe(true);
    });

    it('leaves availableAt null until the appointment resolves', async () => {
      const a = await paidAppointment();

      const entries = await entriesFor(a.id);

      // BOOKED is not an outcome. Nothing is payable yet.
      expect(entries.every((e) => e.availableAt === null)).toBe(true);
      expect(entries.every((e) => e.payoutId === null)).toBe(true);
    });

    it('appends nothing for an unpaid hold released by the sweep', async () => {
      const a = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      await appointments.cancel(customer.userId, a.id);

      // No money ever arrived, so there is nothing to record. An entry here
      // would be the platform claiming to hold money it never received.
      expect(await entriesFor(a.id)).toHaveLength(0);
    });

    it('never appends twice for one appointment, however often confirmation repeats', async () => {
      const a = await paidAppointment();
      const reference = `ref-${a.id}`;

      await appointments.applyPaymentResult(a.id, reference, 'SUCCESSFUL');
      await appointments.applyPaymentResult(a.id, reference, 'SUCCESSFUL');
      await appointments.applyPaymentResult(a.id, reference, 'SUCCESSFUL');

      // The conditional status update is the guard: the second call matches no
      // PENDING_PAYMENT row, so no entries follow.
      expect(await entriesFor(a.id)).toHaveLength(2);
    });
  });

  describe('availableAt is set by how the appointment ended', () => {
    const availableDates = async (appointmentId: string) =>
      (await entriesFor(appointmentId)).map((e) => e.availableAt);

    it('COMPLETED: a week after completion', async () => {
      const a = await paidAppointment();
      await prisma.appointment.update({
        where: { id: a.id },
        data: { status: AppointmentStatus.IN_PROGRESS, verifiedAt: new Date() },
      });

      const done = await appointments.complete(business.userId, a.id);

      const dates = await availableDates(a.id);
      expect(dates.every((d) => d !== null)).toBe(true);
      expect(dates[0]!.getTime()).toBe(done.completedAt!.getTime() + HOLD_MS);
    });

    it('NO_SHOW: a week after the SCHEDULED END TIME, not completion', async () => {
      const a = await paidAppointment({ endsInDays: -2 });
      await prisma.appointment.update({
        where: { id: a.id },
        data: { status: AppointmentStatus.BOOKED },
      });

      await appointments.noShow(business.userId, a.id);

      // A no-show never reaches COMPLETED. Keying off completedAt would leave
      // the business permanently unpaid for a deposit it is entitled to keep.
      const dates = await availableDates(a.id);
      expect(dates[0]!.getTime()).toBe(a.endTime.getTime() + HOLD_MS);
    });

    it('cancelled by the CUSTOMER on a paid deposit: a week after the end time', async () => {
      const a = await paidAppointment({ endsInDays: -3 });

      await appointments.cancel(customer.userId, a.id);

      const dates = await availableDates(a.id);
      expect(dates[0]!.getTime()).toBe(a.endTime.getTime() + HOLD_MS);
    });

    it('cancelled by the BUSINESS: nothing is released here', async () => {
      const a = await paidAppointment();

      await appointments.cancel(business.userId, a.id, {
        reason: 'Shop closed.',
        gatewayChargeCents: 50,
      });

      // A refund, not a payout. The original pair is released — settled by
      // being reversed — alongside three reversal entries (§36.1).
      const entries = await entriesFor(a.id);
      expect(entries).toHaveLength(5);
      expect(entries.every((e) => e.availableAt !== null)).toBe(true);
      // Net: the business is back to zero for this appointment, less the
      // gateway's charge.
      expect(entries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(-50);
    });

    it('stays null while the appointment is still open', async () => {
      const a = await paidAppointment({ endsInDays: 5 });

      const dates = await availableDates(a.id);

      expect(dates.every((d) => d === null)).toBe(true);
    });

    it('the auto-transition sweep releases what it resolves', async () => {
      const a = await paidAppointment({ endsInDays: -3 });
      await prisma.appointment.update({
        where: { id: a.id },
        data: { status: AppointmentStatus.IN_PROGRESS, verifiedAt: new Date() },
      });

      await scheduler.runAutoTransitions();

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.status).toBe(AppointmentStatus.COMPLETED);
      // The business never pressed a button; the money still becomes payable.
      const dates = await availableDates(a.id);
      expect(dates.every((d) => d !== null)).toBe(true);
    });

    it('is idempotent - resolving twice does not move the date', async () => {
      const a = await paidAppointment({ endsInDays: -2 });
      await appointments.cancel(customer.userId, a.id);
      const first = (await availableDates(a.id))[0]!.getTime();

      const ledger = moduleRef.get(LedgerService);
      const touched = await prisma.$transaction((tx) =>
        ledger.releaseOnResolution(tx, a.id),
      );

      expect(touched).toBe(0);
      expect((await availableDates(a.id))[0]!.getTime()).toBe(first);
    });
  });

  describe('entries are append-only, enforced by the database', () => {
    it('refuses to change what an entry says', async () => {
      const a = await paidAppointment();
      const [entry] = await entriesFor(a.id);

      await expect(
        prisma.ledgerEntry.update({
          where: { id: entry.id },
          data: { amountCents: 999_999 },
        }),
      ).rejects.toThrow(/append-only/);
    });

    it.each([
      ['type', { type: LedgerEntryType.ADJUSTMENT }],
      ['currency', { currency: 'EUR' }],
      ['appointmentId', { appointmentId: null }],
    ])('refuses to change %s', async (_label, data) => {
      const a = await paidAppointment();
      const [entry] = await entriesFor(a.id);

      await expect(
        prisma.ledgerEntry.update({ where: { id: entry.id }, data }),
      ).rejects.toThrow(/append-only/);
    });

    it('allows availableAt and payoutId, which record what HAPPENED to an entry', async () => {
      const a = await paidAppointment();
      const [entry] = await entriesFor(a.id);

      // A real payout, because payoutId is a foreign key once §35 lands.
      const payout = await prisma.payout.create({
        data: {
          businessId: business.businessId,
          amountCents: 1,
          currency: 'USD',
          runAt: new Date(),
        },
      });

      const updated = await prisma.ledgerEntry.update({
        where: { id: entry.id },
        data: { availableAt: new Date(), payoutId: payout.id },
      });

      expect(updated.payoutId).toBe(payout.id);
      expect(updated.availableAt).not.toBeNull();
    });

    it('leaves the original readable after an opposing entry is appended', async () => {
      const a = await paidAppointment();
      const [original] = await entriesFor(a.id);

      await prisma.ledgerEntry.create({
        data: {
          businessId: business.businessId,
          appointmentId: a.id,
          type: LedgerEntryType.ADJUSTMENT,
          amountCents: -original.amountCents,
          currency: original.currency,
        },
      });

      // A correction adds a row. It never rewrites one, which is what keeps the
      // history able to explain the balance.
      const after = await prisma.ledgerEntry.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(after.amountCents).toBe(original.amountCents);
      expect(
        (await entriesFor(a.id)).reduce((sum, e) => sum + e.amountCents, 0),
      ).toBe(a.businessAmountCents - original.amountCents);
    });
  });

  /**
   * Analytics infers "cancelledBy IS NULL means the row predates §33". That
   * inference is only sound while EVERY path that writes CANCELLED sets it, so
   * this reads the source and pins it. A new path added without cancelledBy
   * fails here rather than quietly poisoning a money figure months later.
   */
  describe('every path that writes CANCELLED sets cancelledBy (§33)', () => {
    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory()
          ? sourceFiles(full)
          : full.endsWith('.ts')
            ? [full]
            : [];
      });

    /** Every `status: AppointmentStatus.CANCELLED` that sits inside a write. */
    const writeSites = () => {
      const sites: Array<{ file: string; line: number; window: string }> = [];
      for (const file of sourceFiles(join(process.cwd(), 'src'))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!line.includes('status: AppointmentStatus.CANCELLED')) return;
          // A `data:` above it means this is a write; otherwise it is a filter.
          const before = lines.slice(Math.max(0, i - 8), i).join('\n');
          if (!/\bdata:\s*\{/.test(before)) return;
          sites.push({
            file: file.replace(process.cwd(), ''),
            line: i + 1,
            window: lines.slice(i, i + 14).join('\n'),
          });
        });
      }
      return sites;
    };

    it('finds the write sites it expects to find', () => {
      const sites = writeSites();

      // If this number changes, a path was added or removed and the test below
      // needs to have seen it. It has already earned its keep once: §36's admin
      // reclassification showed up here as a third site.
      expect(sites.length).toBe(3);
      expect(sites.map((s) => s.file).sort()).toEqual([
        '/src/appointments/appointments.service.ts',
        '/src/appointments/appointments.service.ts',
        '/src/appointments/payments.scheduler.ts',
      ]);
    });

    it('every one of them sets cancelledBy in the same write', () => {
      for (const site of writeSites()) {
        expect({
          site: `${site.file}:${site.line}`,
          setsCancelledBy: /cancelledBy/.test(site.window),
        }).toEqual({ site: `${site.file}:${site.line}`, setsCancelledBy: true });
      }
    });

    it('and both do so in practice, not only in the source', async () => {
      const paid = await paidAppointment();
      await appointments.cancel(customer.userId, paid.id);
      const byCustomer = await prisma.appointment.findUniqueOrThrow({
        where: { id: paid.id },
      });

      const held = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      await prisma.appointment.update({
        where: { id: held.id },
        data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      await moduleRef.get(PaymentsScheduler).expirePendingPayments();
      const expired = await prisma.appointment.findUniqueOrThrow({
        where: { id: held.id },
      });

      expect(byCustomer.cancelledBy).toBe(CancelledBy.CUSTOMER);
      expect(expired.status).toBe(AppointmentStatus.CANCELLED);
      expect(expired.cancelledBy).toBe(CancelledBy.SYSTEM_EXPIRY);
    });
  });
});
