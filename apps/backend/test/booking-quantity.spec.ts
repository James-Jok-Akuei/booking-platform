import { QuantityMode } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { normaliseQuantityRule, planQuantity } from '../src/appointments/quantity';
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
 * Booking more than one (§136).
 *
 * "Three" is three PEOPLE for a haircut and three UNITS for passport photos,
 * and the two cost a shop different things: people need places and, past the
 * shop's capacity, time; units need neither. What is protected here is that
 * the money is always the total, and that a group can never be squeezed into
 * places the shop does not have.
 */
describe('Booking a quantity (§136)', () => {
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

  const shop = async (
    mode: QuantityMode,
    options: { capacity?: number; maxQuantity?: number } = {},
  ) => {
    const business = await createBusiness(prisma, {
      capacity: options.capacity ?? 1,
      priceMinor: 7000,
      depositPercentage: 20,
      durationMinutes: 30,
    });
    await prisma.service.update({
      where: { id: business.serviceId },
      data: {
        quantityMode: mode,
        maxQuantity: mode === QuantityMode.SINGLE ? 1 : (options.maxQuantity ?? 5),
      },
    });
    return business;
  };

  const book = async (business: TestBusiness, quantity?: number, at = slot()) =>
    appointments.create((await createCustomer(prisma)).userId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: at.toISOString(),
      ...(quantity !== undefined ? { quantity } : {}),
    });

  const minutes = (a: { startTime: Date | string; endTime: Date | string }) =>
    (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60_000;

  const row = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } });

  describe('the plan', () => {
    it('serves people side by side while there are places, then in rounds', () => {
      const plan = (people: number, capacity: number) =>
        planQuantity(QuantityMode.PEOPLE, people, capacity, 30);

      expect(plan(3, 4)).toEqual({ durationMinutes: 30, capacityUnits: 3 });
      expect(plan(3, 2)).toEqual({ durationMinutes: 60, capacityUnits: 2 });
      expect(plan(3, 1)).toEqual({ durationMinutes: 90, capacityUnits: 1 });
      expect(plan(4, 2)).toEqual({ durationMinutes: 60, capacityUnits: 2 });
    });

    it('gives units one place and the ordinary length, however many', () => {
      expect(planQuantity(QuantityMode.UNITS, 5, 4, 30)).toEqual({
        durationMinutes: 30,
        capacityUnits: 1,
      });
    });

    it('keeps the two service columns in agreement', () => {
      expect(normaliseQuantityRule(QuantityMode.SINGLE, 9)).toEqual({
        quantityMode: QuantityMode.SINGLE,
        maxQuantity: 1,
      });
      expect(() => normaliseQuantityRule(QuantityMode.PEOPLE, 1)).toThrow(/between 2 and 20/);
      expect(() => normaliseQuantityRule(QuantityMode.UNITS, undefined)).toThrow();
    });
  });

  describe('the money', () => {
    it('charges the total, and takes the deposit on the total', async () => {
      const business = await shop(QuantityMode.UNITS);

      const created = await book(business, 3);

      expect(created.quantity).toBe(3);
      expect(created.unitPriceMinor).toBe(7000);
      expect(created.servicePriceMinor).toBe(21000);
      // 20% of 21,000 — and the split still adds up to it exactly.
      expect(created.depositAmountMinor).toBe(4200);
      expect(created.platformFeeAmountMinor + created.businessAmountMinor).toBe(4200);
    });

    it('leaves a booking without a quantity exactly as it was', async () => {
      const business = await shop(QuantityMode.PEOPLE, { capacity: 3 });

      const created = await book(business);

      expect(created.quantity).toBe(1);
      expect(created.servicePriceMinor).toBe(7000);
      expect(minutes(created)).toBe(30);
      expect((await row(created.id)).capacityUnits).toBe(1);
    });
  });

  describe('what the service allows', () => {
    it('refuses more than one of a one-at-a-time service', async () => {
      const business = await shop(QuantityMode.SINGLE);
      await expect(book(business, 2)).rejects.toThrow(/one at a time/);
    });

    it('refuses more than the service maximum, and says the maximum', async () => {
      const business = await shop(QuantityMode.UNITS, { maxQuantity: 4 });
      await expect(book(business, 5)).rejects.toThrow(/at most 4/);
    });
  });

  describe('people take places', () => {
    it('three people in a four-chair shop take three chairs for one sitting', async () => {
      const business = await shop(QuantityMode.PEOPLE, { capacity: 4 });

      const group = await book(business, 3);
      expect(minutes(group)).toBe(30);
      expect((await row(group.id)).capacityUnits).toBe(3);

      // One chair is left at that time: one more person fits, two do not.
      await expect(book(business, 2)).rejects.toThrow(/That time is not available/);
      await expect(book(business, 1)).resolves.toBeDefined();
      await expect(book(business, 1)).rejects.toThrow(/That time is not available/);
    });

    it('three people in a one-chair shop are served back to back', async () => {
      const business = await shop(QuantityMode.PEOPLE, { capacity: 1 });

      const group = await book(business, 3);

      expect(minutes(group)).toBe(90);
      expect((await row(group.id)).capacityUnits).toBe(1);
      // 10:00–11:30 is theirs: 11:00 is taken, 11:30 is free.
      const at = (hourUtc: number, minute = 0) => {
        const d = slot();
        d.setUTCHours(hourUtc, minute, 0, 0);
        return d;
      };
      await expect(book(business, 1, at(9))).rejects.toThrow(/That time is not available/);
      await expect(book(business, 1, at(9, 30))).resolves.toBeDefined();
    });

    it('units never take a second place', async () => {
      const business = await shop(QuantityMode.UNITS, { capacity: 2 });

      const photos = await book(business, 5);
      expect((await row(photos.id)).capacityUnits).toBe(1);
      expect(minutes(photos)).toBe(30);

      await expect(book(business, 1)).resolves.toBeDefined();
    });
  });

  describe('availability asked for a service and a quantity', () => {
    const day = () => {
      const d = slot();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };

    it('offers only the times the whole group fits, and says how long it takes', async () => {
      const business = await shop(QuantityMode.PEOPLE, { capacity: 2 });
      // One chair is busy 10:00–10:30.
      await book(business, 1);

      const forOne = await availability.getAvailabilityForService(
        business.locationId, day(), business.serviceId, 1,
      );
      const forTwo = await availability.getAvailabilityForService(
        business.locationId, day(), business.serviceId, 2,
      );
      const forThree = await availability.getAvailabilityForService(
        business.locationId, day(), business.serviceId, 3,
      );

      expect(forOne.slots).toContain('10:00');
      // Two need both chairs, so 10:00 is gone for them and 10:30 is not.
      expect(forTwo.slots).not.toContain('10:00');
      expect(forTwo.slots).toContain('10:30');
      expect(forTwo.durationMinutes).toBe(30);
      // Three across two chairs is two rounds.
      expect(forThree.durationMinutes).toBe(60);
      expect(forThree.slots).not.toContain('09:45');
    });

    it('agrees with booking: every offered time can be booked, for that quantity', async () => {
      const business = await shop(QuantityMode.PEOPLE, { capacity: 2 });
      await book(business, 1);

      const offered = await availability.getAvailabilityForService(
        business.locationId, day(), business.serviceId, 2,
      );
      const first = offered.slots[0];
      const [h, m] = first.split(':').map(Number);
      const at = slot();
      // Local time is UTC+2.
      at.setUTCHours(h - 2, m, 0, 0);

      await expect(book(business, 2, at)).resolves.toBeDefined();
    });

    it('refuses a quantity the service does not allow, and a service from another shop', async () => {
      const business = await shop(QuantityMode.UNITS, { maxQuantity: 3 });
      const other = await shop(QuantityMode.UNITS);

      await expect(
        availability.getAvailabilityForService(business.locationId, day(), business.serviceId, 4),
      ).rejects.toThrow(/at most 3/);
      await expect(
        availability.getAvailabilityForService(business.locationId, day(), other.serviceId, 1),
      ).rejects.toThrow(/Service not found/);
    });
  });
});
