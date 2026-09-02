import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { PaymentsScheduler } from '../src/appointments/payments.scheduler';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createBusiness,
  createCustomer,
  futureSlot,
} from './setup/factories';

/**
 * Capacity is what stops a one-chair salon taking two customers at once, and
 * what lets a four-chair one take four (§16.4). The subtle half is which
 * statuses consume a unit: PENDING_PAYMENT does, or unpaid holds could all be
 * paid at once and overbook the location.
 */
describe('Location capacity (§16.4)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let scheduler: PaymentsScheduler;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      PaymentsScheduler,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    scheduler = moduleRef.get(PaymentsScheduler);
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  /** 10:00 local (08:00Z) a week out — inside 09:00-17:00 opening hours. */
  const slot = () => futureSlot(7, 8).toISOString();

  const book = (business: TestBusiness, customerId: string, startTime: string) =>
    appointments.create(customerId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime,
    });

  describe('a location with capacity N takes exactly N overlapping bookings', () => {
    it('capacity 1 accepts the first booking and rejects the second', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();

      const first = await book(business, (await createCustomer(prisma)).userId, at);
      expect(first.status).toBe(AppointmentStatus.PENDING_PAYMENT);

      await expect(
        book(business, (await createCustomer(prisma)).userId, at),
      ).rejects.toThrow(/That time is not available/);
    });

    it('capacity 3 accepts exactly three, and rejects the fourth', async () => {
      const business = await createBusiness(prisma, { capacity: 3 });
      const at = slot();

      for (let i = 0; i < 3; i++) {
        const customer = await createCustomer(prisma);
        const created = await book(business, customer.userId, at);
        expect(created.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      }

      await expect(
        book(business, (await createCustomer(prisma)).userId, at),
      ).rejects.toThrow(/That time is not available/);

      const held = await prisma.appointment.count({
        where: { locationId: business.locationId, startTime: new Date(at) },
      });
      expect(held).toBe(3);
    });

    it('raising capacity reopens the slot without touching existing bookings', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      await book(business, (await createCustomer(prisma)).userId, at);

      await expect(
        book(business, (await createCustomer(prisma)).userId, at),
      ).rejects.toThrow();

      await prisma.location.update({
        where: { id: business.locationId },
        data: { capacity: 2 },
      });

      const second = await book(business, (await createCustomer(prisma)).userId, at);
      expect(second.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it('a non-overlapping time is unaffected by a full slot', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      await book(business, (await createCustomer(prisma)).userId, futureSlot(8, 8).toISOString());

      // 60-minute service: 08:00Z ends 09:00Z, so 09:00Z touches without
      // overlapping — half-open intervals, no buffer (§12.3).
      const adjacent = await book(
        business,
        (await createCustomer(prisma)).userId,
        futureSlot(8, 9).toISOString(),
      );
      expect(adjacent.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });
  });

  describe('which statuses consume a unit of capacity', () => {
    it('PENDING_PAYMENT consumes capacity — an unpaid hold blocks the slot', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      const held = await book(business, (await createCustomer(prisma)).userId, at);

      expect(held.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      await expect(
        book(business, (await createCustomer(prisma)).userId, at),
      ).rejects.toThrow(/That time is not available/);
    });

    it('CANCELLED frees its unit', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      const first = await book(business, (await createCustomer(prisma)).userId, at);

      await prisma.appointment.update({
        where: { id: first.id },
        data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
      });

      const replacement = await book(business, (await createCustomer(prisma)).userId, at);
      expect(replacement.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it('NO_SHOW frees its unit', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      const first = await book(business, (await createCustomer(prisma)).userId, at);

      await prisma.appointment.update({
        where: { id: first.id },
        data: { status: AppointmentStatus.NO_SHOW, noShowAt: new Date() },
      });

      const replacement = await book(business, (await createCustomer(prisma)).userId, at);
      expect(replacement.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it('BOOKED still consumes capacity', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      const first = await book(business, (await createCustomer(prisma)).userId, at);

      await prisma.appointment.update({
        where: { id: first.id },
        data: { status: AppointmentStatus.BOOKED },
      });

      await expect(
        book(business, (await createCustomer(prisma)).userId, at),
      ).rejects.toThrow(/That time is not available/);
    });
  });

  describe('the expiry sweep frees capacity (§17.4)', () => {
    it('records SYSTEM_EXPIRY with no acting user (§33)', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const abandoned = await book(business, (await createCustomer(prisma)).userId, slot());
      await prisma.appointment.update({
        where: { id: abandoned.id },
        data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      await scheduler.expirePendingPayments();

      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: abandoned.id },
      });
      expect(stored.status).toBe(AppointmentStatus.CANCELLED);
      // Nobody called this off — a hold lapsed. Attributing it to a party would
      // make the refund policy charge someone for a booking that was never paid
      // for in the first place.
      expect(stored.cancelledBy).toBe(CancelledBy.SYSTEM_EXPIRY);
      expect(stored.cancelledByUserId).toBeNull();
      expect(stored.cancellationReason).toBeNull();
      expect(stored.depositPaidAt).toBeNull();
    });

    it('cancels an unpaid hold past its window and reopens the slot', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const at = slot();
      const abandoned = await book(business, (await createCustomer(prisma)).userId, at);

      // Age it past the 5-minute PENDING_PAYMENT window.
      await prisma.appointment.update({
        where: { id: abandoned.id },
        data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const result = await scheduler.expirePendingPayments();
      expect(result.cancelled).toBeGreaterThanOrEqual(1);

      const after = await prisma.appointment.findUniqueOrThrow({
        where: { id: abandoned.id },
      });
      expect(after.status).toBe(AppointmentStatus.CANCELLED);
      expect(after.cancelledAt).not.toBeNull();

      // The freed unit is immediately usable.
      const replacement = await book(business, (await createCustomer(prisma)).userId, at);
      expect(replacement.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it('leaves a hold inside its window alone', async () => {
      const business = await createBusiness(prisma, { capacity: 1 });
      const fresh = await book(
        business,
        (await createCustomer(prisma)).userId,
        futureSlot(9, 8).toISOString(),
      );

      await scheduler.expirePendingPayments();

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(after.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });
  });
});
