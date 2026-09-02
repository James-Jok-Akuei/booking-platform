import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { AnalyticsService, MAX_RANGE_DAYS } from '../src/analytics/analytics.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  asUser,
  createAdmin,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Figures are asserted as exact numbers throughout. "A value is present" would
 * pass against arithmetic that is silently wrong, which for a dashboard a
 * business makes decisions from is the failure that matters.
 */
describe('Business analytics (§29)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let analytics: AnalyticsService;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let locationTwo: string;
  let customer: { userId: string; email: string };

  const DAY = 86_400_000;
  const now = Date.now();
  /** Everything is seeded inside this window unless a test says otherwise. */
  const from = new Date(now - 10 * DAY);
  const to = new Date(now + 10 * DAY);
  const RANGE = { from: from.toISOString(), to: to.toISOString() };

  /**
   * Seeds one appointment with explicit money, so every sum below is
   * predictable rather than derived from the factory's defaults.
   */
  const seed = async (params: {
    locationId: string;
    status: AppointmentStatus;
    startsInDays: number;
    deposit?: number;
    fee?: number;
    /** Omit to simulate an appointment booked before snapshotting existed. */
    priceCents?: number | null;
    /** Set to mark the deposit as confirmed before whatever happened next. */
    depositPaid?: boolean;
    /** Omit on a CANCELLED row to simulate one from before §33. */
    cancelledBy?: CancelledBy;
  }) => {
    const start = new Date(now + params.startsInDays * DAY);
    const deposit = params.deposit ?? 900;
    const fee = params.fee ?? 450;
    const price = params.priceCents === undefined ? 4500 : params.priceCents;
    return prisma.appointment.create({
      data: {
        locationId: params.locationId,
        serviceId: alpha.serviceId,
        customerId: customer.userId,
        startTime: start,
        endTime: new Date(start.getTime() + 3_600_000),
        status: params.status,
        depositAmountCents: deposit,
        platformFeeAmountCents: fee,
        businessAmountCents: deposit - fee,
        currency: 'USD',
        servicePriceCents: price,
        depositPercentage: price === null ? null : 20,
        platformFeePercentage: price === null ? null : 10,
        depositPaidAt: params.depositPaid ? new Date(now - DAY) : null,
        cancelledAt:
          params.status === AppointmentStatus.CANCELLED ? new Date(now - DAY) : null,
        cancelledBy: params.cancelledBy ?? null,
      },
    });
  };

  beforeAll(async () => {
    moduleRef = await createTestModule([AnalyticsService]);
    prisma = moduleRef.get(PrismaService);
    analytics = moduleRef.get(AnalyticsService);
    await resetDatabase(prisma);

    admin = await createAdmin(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    customer = await createCustomer(prisma);

    const second = await prisma.location.create({
      data: { businessId: alpha.businessId, name: 'Branch Two', address: 'Second Road' },
    });
    locationTwo = second.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const AS_ALPHA = () => asUser(alpha.userId, 'BUSINESS');

  describe('per-location figures against a hand-built fixture', () => {
    beforeAll(async () => {
      await prisma.appointment.deleteMany({});
      // Location one: 4 COMPLETED, 1 CANCELLED, 1 NO_SHOW, 1 PENDING_PAYMENT.
      for (let i = 0; i < 4; i++) {
        await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -i - 1 });
      }
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.CANCELLED, startsInDays: -5 });
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.NO_SHOW, startsInDays: -6 });
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.PENDING_PAYMENT, startsInDays: -7 });
    });

    it('counts every status, including those with none', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      expect(r.appointments.total).toBe(7);
      expect(r.appointments.byStatus).toEqual({
        PENDING_PAYMENT: 1,
        BOOKED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 4,
        CANCELLED: 1,
        NO_SHOW: 1,
      });
    });

    it('computes rates over the whole period', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      // 4/7, 1/7, 1/7 to two decimals.
      expect(r.appointments.completionRate).toBe(57.14);
      expect(r.appointments.cancellationRate).toBe(14.29);
      expect(r.appointments.noShowRate).toBe(14.29);
    });

    it('sums only deposits known to have been collected', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      // 4 COMPLETED + 1 NO_SHOW = 5 x 900. PENDING_PAYMENT never paid;
      // CANCELLED is excluded as unknowable.
      expect(r.money.collectedThroughPlatform.depositsCents).toBe(4500);
      expect(r.money.collectedThroughPlatform.appointmentCount).toBe(5);
      expect(r.money.collectedThroughPlatform.businessShareOfDepositsCents).toBe(2250);
    });

    it('platform fees equal the sum of the snapshots in range', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      const expected = await prisma.appointment.aggregate({
        where: {
          locationId: alpha.locationId,
          status: { in: ['BOOKED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] },
          startTime: { gte: from, lt: to },
        },
        _sum: { platformFeeAmountCents: true },
      });

      expect(r.money.platformFeesPaidCents).toBe(expected._sum.platformFeeAmountCents);
      expect(r.money.platformFeesPaidCents).toBe(2250);
    });

    it('computes the balance owed from the price snapshot', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      // 4 COMPLETED, each 4500 price - 900 deposit = 3600 still owed.
      expect(r.money.balanceOwedToBusiness.amountCents).toBe(14400);
      expect(r.money.balanceOwedToBusiness.fromAppointments).toBe(4);
      expect(r.money.balanceOwedToBusiness.complete).toBe(true);
      expect(r.money).not.toHaveProperty('revenue');
    });

    it('never sums the balance into the platform-collected figure', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });

      // The two must stay separate: the platform saw 4500, not 18900.
      expect(r.money.collectedThroughPlatform.depositsCents).toBe(4500);
      expect(r.money.balanceOwedToBusiness.amountCents).toBe(14400);
    });
  });

  describe('balance owed is never silently partial', () => {
    beforeAll(async () => {
      await prisma.appointment.deleteMany({});
      // Two with a snapshot, one without (as a pre-snapshot booking would be).
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -1 });
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -2 });
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.COMPLETED,
        startsInDays: -3,
        priceCents: null,
      });
    });

    it('excludes appointments without a snapshot from the figure', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(r.money.balanceOwedToBusiness.amountCents).toBe(7200);
      expect(r.money.balanceOwedToBusiness.fromAppointments).toBe(2);
    });

    it('reports how many were excluded, and flags the total as incomplete', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(r.money.balanceOwedToBusiness.appointmentsMissingSnapshot).toBe(1);
      expect(r.money.balanceOwedToBusiness.complete).toBe(false);
      expect(r.money.balanceOwedToBusiness.note).toMatch(/Excludes 1 completed appointment/);
    });

    it('says the platform has not seen this money', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(r.money.balanceOwedToBusiness.note).toMatch(/cannot confirm it was paid/);
    });

    it('counts only COMPLETED appointments toward the balance', async () => {
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.BOOKED, startsInDays: -4 });

      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      // Unchanged: a booked appointment owes nothing yet.
      expect(r.money.balanceOwedToBusiness.amountCents).toBe(7200);
    });
  });

  describe('business-wide roll-up', () => {
    beforeAll(async () => {
      await prisma.appointment.deleteMany({});
      // Location one: 1 of 2 completed  -> 50%
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -1 });
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.CANCELLED, startsInDays: -1 });
      // Location two: 3 of 4 completed  -> 75%
      for (let i = 0; i < 3; i++) {
        await seed({ locationId: locationTwo, status: AppointmentStatus.COMPLETED, startsInDays: -2 });
      }
      await seed({ locationId: locationTwo, status: AppointmentStatus.CANCELLED, startsInDays: -2 });
    });

    it('totals across locations', async () => {
      const all = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, RANGE);

      expect(all.scope).toBe('BUSINESS');
      expect(all.appointments.total).toBe(6);
      expect(all.appointments.byStatus.COMPLETED).toBe(4);
    });

    it('a roll-up rate is NOT the mean of the per-location rates', async () => {
      const one = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });
      const two = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: locationTwo,
        ...RANGE,
      });
      const all = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, RANGE);

      expect(one.appointments.completionRate).toBe(50);
      expect(two.appointments.completionRate).toBe(75);

      // 4 completed of 6 total = 66.67, NOT (50 + 75) / 2 = 62.5.
      expect(all.appointments.completionRate).toBe(66.67);
      expect(all.appointments.completionRate).not.toBe(62.5);
    });

    it('money rolls up as the sum of its locations', async () => {
      const one = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });
      const two = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: locationTwo, ...RANGE,
      });
      const all = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, RANGE);

      expect(all.money.collectedThroughPlatform.depositsCents).toBe(
        one.money.collectedThroughPlatform.depositsCents +
          two.money.collectedThroughPlatform.depositsCents,
      );
      expect(all.money.platformFeesPaidCents).toBe(
        one.money.platformFeesPaidCents + two.money.platformFeesPaidCents,
      );
    });

    it("another location's appointments are excluded from a per-location view", async () => {
      const one = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(one.appointments.total).toBe(2);
      expect(one.money.collectedThroughPlatform.depositsCents).toBe(900);
    });
  });

  describe('date range', () => {
    beforeAll(async () => {
      await prisma.appointment.deleteMany({});
    });

    it('includes an appointment exactly on `from` and excludes one exactly on `to`', async () => {
      // Half-open [from, to), matching GET /appointments.
      const lower = new Date(now - 5 * DAY);
      const upper = new Date(now - 1 * DAY);
      await prisma.appointment.deleteMany({});
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -5 });
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -1 });

      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        from: lower.toISOString(),
        to: upper.toISOString(),
      });

      // The one exactly on `from` counts; the one exactly on `to` does not.
      expect(r.appointments.total).toBe(1);
    });

    it('excludes appointments outside the range entirely', async () => {
      await prisma.appointment.deleteMany({});
      await seed({ locationId: alpha.locationId, status: AppointmentStatus.COMPLETED, startsInDays: -100 });

      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(r.appointments.total).toBe(0);
      expect(r.money.collectedThroughPlatform.depositsCents).toBe(0);
    });

    it('rejects a range longer than the cap', async () => {
      await expect(
        analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
          from: new Date(now - (MAX_RANGE_DAYS + 2) * DAY).toISOString(),
          to: new Date(now).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a range exactly at the cap', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        from: new Date(now - MAX_RANGE_DAYS * DAY).toISOString(),
        to: new Date(now).toISOString(),
      });

      expect(r.range.days).toBe(MAX_RANGE_DAYS);
    });

    it('rejects an inverted range', async () => {
      await expect(
        analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
          from: new Date(now).toISOString(),
          to: new Date(now - DAY).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults to the last 30 days when no range is given', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {});

      expect(r.range.days).toBe(30);
    });
  });

  describe('empty period', () => {
    beforeAll(async () => {
      await prisma.appointment.deleteMany({});
      await prisma.review.deleteMany({});
    });

    it('returns zeroes and nulls without error', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, RANGE);

      expect(r.appointments.total).toBe(0);
      // Null, not 0 and never NaN: "no appointments" is not "0% completed".
      expect(r.appointments.completionRate).toBeNull();
      expect(r.appointments.cancellationRate).toBeNull();
      expect(r.appointments.noShowRate).toBeNull();
      expect(r.money.collectedThroughPlatform.depositsCents).toBe(0);
      expect(r.money.platformFeesPaidCents).toBe(0);
      expect(r.reviews).toEqual({ count: 0, averageRating: null });
      expect(r.busiest.dayOfWeek).toBeNull();
      expect(r.busiest.hour).toBeNull();
    });

    it('no rate is ever NaN', async () => {
      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, RANGE);

      for (const rate of [
        r.appointments.completionRate,
        r.appointments.cancellationRate,
        r.appointments.noShowRate,
      ]) {
        expect(Number.isNaN(rate as number)).toBe(false);
      }
    });
  });

  describe('reviews', () => {
    it('averages non-hidden reviews in range only', async () => {
      await prisma.appointment.deleteMany({});
      await prisma.review.deleteMany({});

      const mk = async (rating: number, hidden: boolean) => {
        const appt = await seed({
          locationId: alpha.locationId,
          status: AppointmentStatus.COMPLETED,
          startsInDays: -2,
        });
        await prisma.review.create({
          data: {
            appointmentId: appt.id,
            customerId: customer.userId,
            businessId: alpha.businessId,
            locationId: alpha.locationId,
            rating,
            hiddenAt: hidden ? new Date() : null,
          },
        });
      };
      await mk(5, false);
      await mk(3, false);
      await mk(1, true); // hidden — must not drag the average down

      const r = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId, ...RANGE,
      });

      expect(r.reviews).toEqual({ count: 2, averageRating: 4 });
    });
  });

  describe('cross-tenant access', () => {
    it("business A cannot read business B's analytics", async () => {
      await expect(
        analytics.getAnalytics(AS_ALPHA(), beta.businessId, RANGE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an admin can read any business', async () => {
      const r = await analytics.getAnalytics(
        asUser(admin.userId, 'ADMIN'),
        beta.businessId,
        RANGE,
      );

      expect(r.businessId).toBe(beta.businessId);
    });

    it("a location id from another business is refused, not silently ignored", async () => {
      await expect(
        analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
          locationId: beta.locationId,
          ...RANGE,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancelled deposits are counted by whether they were paid (§33)', () => {
    beforeEach(async () => {
      await prisma.appointment.deleteMany({});
    });

    const money = async () => {
      const report = await analytics.getAnalytics(AS_ALPHA(), alpha.businessId, {
        locationId: alpha.locationId,
        ...RANGE,
      });
      return report.money;
    };

    it('counts a deposit that was paid and then cancelled', async () => {
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
        depositPaid: true,
        cancelledBy: CancelledBy.CUSTOMER,
      });

      const m = await money();

      // The money arrived and, per §2, was not given back. Excluding it
      // understated what the platform actually took.
      expect(m.collectedThroughPlatform.depositsCents).toBe(900);
      expect(m.collectedThroughPlatform.appointmentCount).toBe(1);
      expect(m.platformFeesPaidCents).toBe(450);
    });

    it('excludes an expired unpaid hold', async () => {
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
        cancelledBy: CancelledBy.SYSTEM_EXPIRY,
      });

      const m = await money();

      expect(m.collectedThroughPlatform.depositsCents).toBe(0);
      expect(m.collectedThroughPlatform.appointmentCount).toBe(0);
    });

    it('separates the two in the same range', async () => {
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
        depositPaid: true,
        cancelledBy: CancelledBy.BUSINESS,
      });
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -3,
        cancelledBy: CancelledBy.SYSTEM_EXPIRY,
      });
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.COMPLETED,
        startsInDays: -4,
        depositPaid: true,
      });

      const m = await money();

      // The completed one plus the paid-then-cancelled one. The lapsed hold
      // is not money and never was.
      expect(m.collectedThroughPlatform.depositsCents).toBe(1800);
      expect(m.collectedThroughPlatform.appointmentCount).toBe(2);
    });

    it('reports itself complete when every cancellation in range is attributed', async () => {
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
        cancelledBy: CancelledBy.SYSTEM_EXPIRY,
      });

      const m = await money();

      expect(m.collectedThroughPlatform.cancelledWithUnknownPaymentState).toBe(0);
      expect(m.collectedThroughPlatform.complete).toBe(true);
      expect(m.collectedThroughPlatform.note).toContain('accounted for exactly');
    });

    it('counts, and says, how many pre-§33 cancellations it cannot place', async () => {
      // No cancelledBy and no depositPaidAt: exactly a row from before this
      // existed. Its payment state is not recoverable.
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
      });
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -3,
      });

      const m = await money();

      expect(m.collectedThroughPlatform.cancelledWithUnknownPaymentState).toBe(2);
      expect(m.collectedThroughPlatform.complete).toBe(false);
      // The number says so itself rather than leaving the reader to find out.
      expect(m.collectedThroughPlatform.note).toContain('2 cancelled appointment(s)');
      expect(m.collectedThroughPlatform.depositsCents).toBe(0);
    });

    it('never guesses: an unattributed cancellation is excluded, not assumed paid', async () => {
      await seed({
        locationId: alpha.locationId,
        status: AppointmentStatus.CANCELLED,
        startsInDays: -2,
      });

      const m = await money();

      expect(m.collectedThroughPlatform.depositsCents).toBe(0);
      expect(m.collectedThroughPlatform.appointmentCount).toBe(0);
    });
  });
});
