import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessStatus,
  LedgerEntryType,
  NotificationType,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import {
  BUSINESS_STATUS_TRANSITIONS,
  findBusinessTransition,
} from '../src/business/business-status';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  asUser,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
  futureSlot,
} from './setup/factories';

const DAY = 86_400_000;
const ALL_STATUSES = Object.values(BusinessStatus);

/**
 * Business approval (§42).
 *
 * Before this, BusinessStatus gated every public read but nothing could set it —
 * a business could only be approved by editing the database, which left the
 * whole public surface unreachable. These tests cover the lifecycle and, just as
 * importantly, what each status actually DOES.
 */
describe('Business approval (§42)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let moderation: BusinessModerationService;
  let appointments: AppointmentsService;
  let availability: AvailabilityService;
  let reviews: ReviewsService;
  let payouts: PayoutsService;
  let notifications: { notifyBusiness: { mock: { calls: any[][] } } };

  let admin: { userId: string; email: string };
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessModerationService,
      AppointmentsService,
      AvailabilityService,
      ReviewsService,
      PayoutsService,
      PayoutDestinationsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    moderation = moduleRef.get(BusinessModerationService);
    appointments = moduleRef.get(AppointmentsService);
    availability = moduleRef.get(AvailabilityService);
    reviews = moduleRef.get(ReviewsService);
    payouts = moduleRef.get(PayoutsService);
    notifications = moduleRef.get(NotificationsService) as never;
    await resetDatabase(prisma);
    await moduleRef
      .get(PlatformSettingsService)
      .setPlatformFeePercentage(10, { role: 'ADMIN' });
    admin = await createAdmin(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => {
    notifications.notifyBusiness.mock.calls.length = 0;
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');
  const shopIn = (status: BusinessStatus) => createBusiness(prisma, { status });
  const statusOf = async (businessId: string) =>
    prisma.businessProfile.findUniqueOrThrow({ where: { id: businessId } });

  // ------------------------------------------------------------------
  describe('the transition table', () => {
    const LEGAL = new Set(
      BUSINESS_STATUS_TRANSITIONS.map((t) => `${t.from}>${t.to}`),
    );

    it('allows PENDING -> APPROVED', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      const result = await moderation.approve(AS_ADMIN(), shop.businessId);

      expect(result.status).toBe(BusinessStatus.APPROVED);
    });

    it('allows PENDING -> REJECTED with a reason', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      const result = await moderation.reject(AS_ADMIN(), shop.businessId, 'No licence.');

      expect(result.status).toBe(BusinessStatus.REJECTED);
      expect(result.statusReason).toBe('No licence.');
    });

    it('allows REJECTED -> APPROVED, the appeal path', async () => {
      const shop = await shopIn(BusinessStatus.REJECTED);

      const result = await moderation.approve(AS_ADMIN(), shop.businessId);

      expect(result.status).toBe(BusinessStatus.APPROVED);
      // The old rejection reason must not survive as an accusation.
      expect(result.statusReason).toBeNull();
    });

    it('allows APPROVED -> SUSPENDED with a reason', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);

      const result = await moderation.suspend(AS_ADMIN(), shop.businessId, 'Fraud probe.');

      expect(result.status).toBe(BusinessStatus.SUSPENDED);
      expect(result.statusReason).toBe('Fraud probe.');
    });

    it('allows SUSPENDED -> APPROVED via reinstate', async () => {
      const shop = await shopIn(BusinessStatus.SUSPENDED);

      const result = await moderation.reinstate(AS_ADMIN(), shop.businessId);

      expect(result.status).toBe(BusinessStatus.APPROVED);
      expect(result.statusReason).toBeNull();
    });

    /**
     * Every pair the table does not list must be refused.
     *
     * PENDING is excluded as a TARGET because no method targets it — there is
     * no un-review, and the absence is asserted against the table itself below
     * rather than by inventing a call that could not be made.
     */
    const REACHABLE = ALL_STATUSES.filter((s) => s !== BusinessStatus.PENDING);
    const ILLEGAL: Array<[BusinessStatus, BusinessStatus]> = ALL_STATUSES.flatMap(
      (from) =>
        REACHABLE.filter((to) => !LEGAL.has(`${from}>${to}`)).map(
          (to) => [from, to] as [BusinessStatus, BusinessStatus],
        ),
    );

    it.each(ILLEGAL)('rejects %s -> %s', async (from, to) => {
      const shop = await shopIn(from);

      const attempt =
        to === BusinessStatus.APPROVED
          ? moderation.approve(AS_ADMIN(), shop.businessId)
          : to === BusinessStatus.REJECTED
            ? moderation.reject(AS_ADMIN(), shop.businessId, 'Because.')
            : moderation.suspend(AS_ADMIN(), shop.businessId, 'Because.');

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      expect((await statusOf(shop.businessId)).status).toBe(from);
    });

    it('has no route back to PENDING - a decision cannot be un-made', () => {
      expect(
        BUSINESS_STATUS_TRANSITIONS.some((t) => t.to === BusinessStatus.PENDING),
      ).toBe(false);
    });

    it('refuses to reinstate anything that is not SUSPENDED', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await expect(
        moderation.reinstate(AS_ADMIN(), shop.businessId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exposes each rule through findBusinessTransition', () => {
      expect(
        findBusinessTransition(BusinessStatus.PENDING, BusinessStatus.REJECTED)
          ?.requiresReason,
      ).toBe(true);
      expect(
        findBusinessTransition(BusinessStatus.PENDING, BusinessStatus.APPROVED)
          ?.requiresReason,
      ).toBe(false);
      expect(
        findBusinessTransition(BusinessStatus.REJECTED, BusinessStatus.SUSPENDED),
      ).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  describe('a reason is required where the business is told something bad', () => {
    it.each(['', '   '])('refuses a rejection with %p as the reason', async (reason) => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await expect(
        moderation.reject(AS_ADMIN(), shop.businessId, reason),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await statusOf(shop.businessId)).status).toBe(BusinessStatus.PENDING);
    });

    it.each(['', '   '])('refuses a suspension with %p as the reason', async (reason) => {
      const shop = await shopIn(BusinessStatus.APPROVED);

      await expect(
        moderation.suspend(AS_ADMIN(), shop.businessId, reason),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await statusOf(shop.businessId)).status).toBe(BusinessStatus.APPROVED);
    });

    it('trims the stored reason', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      const result = await moderation.reject(AS_ADMIN(), shop.businessId, '  No licence.  ');

      expect(result.statusReason).toBe('No licence.');
    });
  });

  // ------------------------------------------------------------------
  describe('the audit stamp', () => {
    it.each([
      ['approve', BusinessStatus.PENDING],
      ['suspend', BusinessStatus.APPROVED],
    ])('records who and when on %s', async (action, from) => {
      const shop = await shopIn(from);

      if (action === 'approve') await moderation.approve(AS_ADMIN(), shop.businessId);
      else await moderation.suspend(AS_ADMIN(), shop.businessId, 'Under review.');

      const row = await statusOf(shop.businessId);
      expect(row.statusChangedById).toBe(admin.userId);
      expect(row.statusChangedAt).not.toBeNull();
    });

    it('moves the timestamp on every subsequent change', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      await moderation.suspend(AS_ADMIN(), shop.businessId, 'First.');
      const first = (await statusOf(shop.businessId)).statusChangedAt!;

      await moderation.reinstate(AS_ADMIN(), shop.businessId);

      const second = (await statusOf(shop.businessId)).statusChangedAt!;
      expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
    });
  });

  // ------------------------------------------------------------------
  describe('notifications', () => {
    const lastType = () => {
      const calls = notifications.notifyBusiness.mock.calls;
      return calls[calls.length - 1]?.[0];
    };

    it('tells members on approval', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await moderation.approve(AS_ADMIN(), shop.businessId);

      expect(lastType().type).toBe(NotificationType.BUSINESS_APPROVED);
      expect(lastType().businessId).toBe(shop.businessId);
    });

    it('tells members on rejection, with the reason', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await moderation.reject(AS_ADMIN(), shop.businessId, 'No licence.');

      expect(lastType().type).toBe(NotificationType.BUSINESS_REJECTED);
      expect(lastType().context.reason).toBe('No licence.');
    });

    it('tells members on suspension, with the reason', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);

      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Fraud probe.');

      expect(lastType().type).toBe(NotificationType.BUSINESS_SUSPENDED);
      expect(lastType().context.reason).toBe('Fraud probe.');
    });

    it('tells members on reinstatement', async () => {
      const shop = await shopIn(BusinessStatus.SUSPENDED);

      await moderation.reinstate(AS_ADMIN(), shop.businessId);

      expect(lastType().type).toBe(NotificationType.BUSINESS_REINSTATED);
    });
  });

  // ------------------------------------------------------------------
  describe('what a non-APPROVED status actually does', () => {
    const NOT_APPROVED = [
      BusinessStatus.PENDING,
      BusinessStatus.REJECTED,
      BusinessStatus.SUSPENDED,
    ];

    it.each(NOT_APPROVED)('a %s business is hidden from availability', async (status) => {
      const shop = await shopIn(status);

      await expect(
        availability.getAvailability(shop.locationId, futureSlot(5, 8), 60),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(NOT_APPROVED)('a %s business is hidden from reviews', async (status) => {
      const shop = await shopIn(status);

      await expect(
        reviews.listForLocation(shop.locationId, undefined, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(NOT_APPROVED)('a %s business cannot be booked with', async (status) => {
      const shop = await shopIn(status);

      // The hole this closes (§42.1): a customer holding a location id could
      // book with a business that was never approved.
      await expect(
        appointments.create(customer.userId, {
          locationId: shop.locationId,
          serviceId: shop.serviceId,
          startTime: futureSlot(5, 8).toISOString(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an APPROVED business can still be booked with', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);

      const created = await appointments.create(customer.userId, {
        locationId: shop.locationId,
        serviceId: shop.serviceId,
        startTime: futureSlot(6, 8).toISOString(),
      });

      expect(created.id).toBeDefined();
    });

    it('approving a PENDING business makes booking work immediately', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);
      await expect(
        appointments.create(customer.userId, {
          locationId: shop.locationId,
          serviceId: shop.serviceId,
          startTime: futureSlot(7, 8).toISOString(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await moderation.approve(AS_ADMIN(), shop.businessId);

      const created = await appointments.create(customer.userId, {
        locationId: shop.locationId,
        serviceId: shop.serviceId,
        startTime: futureSlot(7, 8).toISOString(),
      });
      expect(created.id).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  describe('suspension does not touch existing appointments', () => {
    it('leaves a booked appointment exactly as it was', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      const booked = await createAppointment(prisma, {
        business: shop,
        customerId: customer.userId,
        status: AppointmentStatus.BOOKED,
      });
      const before = await prisma.appointment.findUniqueOrThrow({
        where: { id: booked.id },
      });

      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Under investigation.');

      // Cancelling wholesale would punish customers for the business's conduct.
      // The business must still honour what it already took.
      const after = await prisma.appointment.findUniqueOrThrow({
        where: { id: booked.id },
      });
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(after.status).toBe(AppointmentStatus.BOOKED);
      expect(after.cancelledAt).toBeNull();
    });

    it('cancels nothing across a whole book of appointments', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      for (let i = 0; i < 3; i++) {
        await createAppointment(prisma, {
          business: shop,
          customerId: customer.userId,
          status: AppointmentStatus.BOOKED,
          startsInHours: 48 + i * 24,
        });
      }

      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Under investigation.');

      const cancelled = await prisma.appointment.count({
        where: { location: { businessId: shop.businessId }, status: AppointmentStatus.CANCELLED },
      });
      expect(cancelled).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  describe('suspension pauses payouts, and reinstatement resumes them', () => {
    /** A business with matured, unstamped money waiting. */
    const owed = async (shop: TestBusiness) => {
      await prisma.ledgerEntry.create({
        data: {
          businessId: shop.businessId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountCents: 4500,
          currency: 'USD',
          settlementCurrency: 'USD',
          settlementAmountMinor: 4500,
          bookingExchangeRate: 1,
          availableAt: new Date(Date.now() - DAY),
        },
      });
    };

    it('skips a suspended business and leaves its entries unstamped', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      await owed(shop);
      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Fraud probe.');

      const summary = await payouts.run();

      expect(summary.pausedForSuspension).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.payout.count({ where: { businessId: shop.businessId } }),
      ).toBe(0);
      // Nothing written off — the money waits.
      const entries = await prisma.ledgerEntry.findMany({
        where: { businessId: shop.businessId },
      });
      expect(entries.every((e) => e.payoutId === null)).toBe(true);
      expect(entries.every((e) => e.availableAt !== null)).toBe(true);
    });

    it('pays it on the first run after reinstatement', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      await owed(shop);
      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Fraud probe.');
      await payouts.run();

      await moderation.reinstate(AS_ADMIN(), shop.businessId);
      await payouts.run();

      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      expect(payout).toBeDefined();
      expect(payout.amountCents).toBe(4500);
    });

    it('does not pause an APPROVED business in the same run', async () => {
      const suspended = await shopIn(BusinessStatus.APPROVED);
      const healthy = await shopIn(BusinessStatus.APPROVED);
      await owed(suspended);
      await owed(healthy);
      await moderation.suspend(AS_ADMIN(), suspended.businessId, 'Fraud probe.');

      await payouts.run();

      expect(
        await prisma.payout.count({ where: { businessId: healthy.businessId } }),
      ).toBe(1);
      expect(
        await prisma.payout.count({ where: { businessId: suspended.businessId } }),
      ).toBe(0);
    });

    it('tells the business why its balance is not moving', async () => {
      const shop = await shopIn(BusinessStatus.APPROVED);
      await owed(shop);
      await moderation.suspend(AS_ADMIN(), shop.businessId, 'Fraud probe.');

      const balance = await payouts.balance(AS_ADMIN(), shop.businessId);

      expect(balance.payoutsPaused).toBe(true);
      expect(balance.availableNowCents).toBe(4500);
      expect(balance.note).toMatch(/paused/i);
      expect(balance.note).toMatch(/Fraud probe/);
      // The money is still shown as owed, not zeroed.
      expect(balance.note).toMatch(/nothing has been written off/i);
    });
  });

  // ------------------------------------------------------------------
  describe('admin-only, asserted in the service', () => {
    const NON_ADMINS = ['CUSTOMER', 'BUSINESS'];

    it.each(NON_ADMINS)('refuses a %s listing the queue', async (role) => {
      await expect(moderation.list({ role }, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it.each(NON_ADMINS)('refuses a %s reading one business', async (role) => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await expect(
        moderation.findOne({ role }, shop.businessId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(NON_ADMINS)('refuses a %s approving a business', async (role) => {
      const shop = await shopIn(BusinessStatus.PENDING);

      await expect(
        moderation.approve({ userId: customer.userId, role }, shop.businessId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await statusOf(shop.businessId)).status).toBe(BusinessStatus.PENDING);
    });

    it.each(NON_ADMINS)('refuses a %s suspending a business', async (role) => {
      const shop = await shopIn(BusinessStatus.APPROVED);

      await expect(
        moderation.suspend({ userId: customer.userId, role }, shop.businessId, 'Spite.'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await statusOf(shop.businessId)).status).toBe(BusinessStatus.APPROVED);
    });

    it('404s on a business that does not exist', async () => {
      await expect(
        moderation.approve(AS_ADMIN(), '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('the queue', () => {
    it('filters by status and returns oldest first', async () => {
      await prisma.businessProfile.deleteMany({});
      const first = await shopIn(BusinessStatus.PENDING);
      const second = await shopIn(BusinessStatus.PENDING);
      await shopIn(BusinessStatus.APPROVED);

      const queue = await moderation.list(AS_ADMIN(), {
        status: BusinessStatus.PENDING,
      });

      expect(queue.total).toBe(2);
      // The person who has waited longest is read first.
      expect(queue.businesses.map((b) => b.id)).toEqual([
        first.businessId,
        second.businessId,
      ]);
    });

    it('returns every status when unfiltered', async () => {
      await prisma.businessProfile.deleteMany({});
      await shopIn(BusinessStatus.PENDING);
      await shopIn(BusinessStatus.APPROVED);
      await shopIn(BusinessStatus.SUSPENDED);

      const queue = await moderation.list(AS_ADMIN(), {});

      expect(queue.total).toBe(3);
    });

    it('gives the admin the detail needed to decide', async () => {
      const shop = await shopIn(BusinessStatus.PENDING);

      const detail: any = await moderation.findOne(AS_ADMIN(), shop.businessId);

      expect(detail.locations).toHaveLength(1);
      expect(detail.services).toHaveLength(1);
      expect(detail.members).toHaveLength(1);
      expect(detail.members[0].user.email).toContain('@');
    });
  });
});
