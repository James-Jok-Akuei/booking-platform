import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { assertQuantityAllowed } from '../src/appointments/quantity';
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
 * Booking for several people (§136), by the branch's places alone (§189).
 *
 * A branch serves so many people at once. A booking for three takes three of
 * those places, all together, for the service's own length; whatever is left
 * at that time is there for everyone else, and a time with none left is
 * booked. Nothing on the service limits how many. What is protected here is
 * that the money is always the total, that a group never gets more places than
 * the branch has, and that what availability offers is what booking accepts.
 */
describe('Booking for several people (§136, §189)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let availability: AvailabilityService;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    availability = moduleRef.get(AvailabilityService);
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  /** 10:00 local (08:00Z) a week out — inside 09:00-17:00 opening hours. */
  const slot = () => futureSlot(7, 8);

  /** A local wall-clock time on the same day as `slot()`. Local is UTC+2. */
  const at = (hour: number, minute = 0) => {
    const d = slot();
    d.setUTCHours(hour - 2, minute, 0, 0);
    return d;
  };

  /** The same day, as the calendar date availability takes. */
  const day = () => {
    const d = slot();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };

  const shop = (places: number, durationMinutes = 30) =>
    createBusiness(prisma, {
      capacity: places,
      priceMinor: 7000,
      depositPercentage: 20,
      durationMinutes,
    });

  const book = async (business: TestBusiness, quantity?: number, when = slot()) =>
    appointments.create((await createCustomer(prisma)).userId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: when.toISOString(),
      ...(quantity !== undefined ? { quantity } : {}),
    });

  const minutes = (a: { startTime: Date | string; endTime: Date | string }) =>
    (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60_000;

  const row = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } });

  const timesFor = (business: TestBusiness, quantity: number) =>
    availability.getAvailabilityForService(
      business.locationId,
      day(),
      business.serviceId,
      quantity,
    );

  const placesAt = async (business: TestBusiness, time: string) =>
    (await timesFor(business, 1)).times.find((t) => t.time === time)?.placesLeft;

  describe('the rule', () => {
    it('allows as many as the branch serves at once, and no more', () => {
      expect(() => assertQuantityAllowed(5, 5)).not.toThrow();
      expect(() => assertQuantityAllowed(6, 5)).toThrow(/at most 5 people at once/);
      expect(() => assertQuantityAllowed(2, 1)).toThrow(/one person at a time/);
      expect(() => assertQuantityAllowed(0, 5)).toThrow(/1 or more/);
      expect(() => assertQuantityAllowed(1.5, 5)).toThrow(/whole number/);
    });
  });

  describe('the money', () => {
    it('charges the total, and takes the deposit on the total', async () => {
      const business = await shop(3);

      const created = await book(business, 3);

      expect(created.quantity).toBe(3);
      expect(created.unitPriceMinor).toBe(7000);
      expect(created.servicePriceMinor).toBe(21000);
      // 20% of 21,000 — and the split still adds up to it exactly.
      expect(created.depositAmountMinor).toBe(4200);
      expect(created.platformFeeAmountMinor + created.businessAmountMinor).toBe(4200);
    });

    it('leaves a booking without a quantity exactly as it was', async () => {
      const business = await shop(3);

      const created = await book(business);

      expect(created.quantity).toBe(1);
      expect(created.servicePriceMinor).toBe(7000);
      expect(minutes(created)).toBe(30);
      expect((await row(created.id)).capacityUnits).toBe(1);
    });
  });

  describe('people take places', () => {
    it('five places, three booked: two left, then none, then the time is booked', async () => {
      const business = await shop(5);

      const group = await book(business, 3);
      // Side by side, for the service's own length — never in rounds.
      expect(minutes(group)).toBe(30);
      expect((await row(group.id)).capacityUnits).toBe(3);
      expect(await placesAt(business, '10:00')).toBe(2);

      // Three more do not fit in the two that are left.
      await expect(book(business, 3)).rejects.toThrow(/That time is not available/);

      await book(business, 2);
      expect(await placesAt(business, '10:00')).toBe(0);
      await expect(book(business, 1)).rejects.toThrow(/That time is not available/);

      // The next free time is untouched by a full one.
      expect(await placesAt(business, '10:30')).toBe(5);
    });

    it('refuses a group bigger than the branch, whatever time is asked for', async () => {
      await expect(book(await shop(1), 2)).rejects.toThrow(/one person at a time/);
      await expect(book(await shop(4), 5)).rejects.toThrow(/at most 4 people at once/);
    });

    it('counts the busiest moment, not every booking that touches the time', async () => {
      // An hour-long service, two places. One person 10:00–11:00, another
      // 11:00–12:00. A booking 10:30–11:30 overlaps both, but never more than
      // one of them at a time, so one place is free all the way through.
      const business = await shop(2, 60);
      await book(business, 1, at(10));
      await book(business, 1, at(11));

      expect(await placesAt(business, '10:30')).toBe(1);
      await expect(book(business, 1, at(10, 30))).resolves.toBeDefined();
      expect(await placesAt(business, '10:30')).toBe(0);
    });
  });

  describe('availability asked for a service and how many people', () => {
    it('lists every open time with its places left, and offers only those with room', async () => {
      const business = await shop(2);
      // One place is taken 10:00–10:30.
      await book(business, 1);

      const forOne = await timesFor(business, 1);
      const forTwo = await timesFor(business, 2);

      expect(forOne.slots).toContain('10:00');
      // Two need both places, so 10:00 is not offered to them…
      expect(forTwo.slots).not.toContain('10:00');
      expect(forTwo.slots).toContain('10:30');
      // …but it is still listed, with the one place it has left.
      expect(forTwo.times).toContainEqual({ time: '10:00', placesLeft: 1 });
      expect(forTwo.times).toContainEqual({ time: '10:30', placesLeft: 2 });
      // The length is the service's own, however many come.
      expect(forTwo.durationMinutes).toBe(30);
    });

    it('agrees with booking: every offered time can be booked, for that many', async () => {
      const business = await shop(2);
      await book(business, 1);

      const offered = await timesFor(business, 2);
      const [h, m] = offered.slots[0].split(':').map(Number);

      await expect(book(business, 2, at(h, m))).resolves.toBeDefined();
    });

    it('refuses more people than the branch serves, and a service from another shop', async () => {
      const business = await shop(3);
      const other = await shop(3);

      await expect(timesFor(business, 4)).rejects.toThrow(/at most 3 people at once/);
      await expect(
        availability.getAvailabilityForService(business.locationId, day(), other.serviceId, 1),
      ).rejects.toThrow(/Service not found/);
    });
  });
});
