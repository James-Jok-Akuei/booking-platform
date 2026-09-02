import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { DiscoverySort } from '../src/discovery/dto/discover-locations.dto';
import { isOpenAt } from '../src/discovery/open-now';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/** Juba, roughly. The centre every distance test measures from. */
const JUBA = { lat: 4.85, lng: 31.58 };

/**
 * One degree of latitude on a sphere of radius 6371 km:
 *   6371 × π / 180 = 111.1949... km
 * Hand-computed so the haversine in SQL is checked against arithmetic done
 * outside it, not against itself.
 */
const KM_PER_DEGREE_LAT = 111.19;

describe('Discovery (§43)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let discovery: DiscoveryService;
  let settings: PlatformSettingsService;

  beforeAll(async () => {
    moduleRef = await createTestModule([DiscoveryService]);
    prisma = moduleRef.get(PrismaService);
    discovery = moduleRef.get(DiscoveryService);
    settings = moduleRef.get(PlatformSettingsService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await prisma.locationScheduleException.deleteMany({});
    await prisma.locationHours.deleteMany({});
    await prisma.location.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await prisma.platformSetting.deleteMany({});
  });

  /** A business with one located branch. */
  const shop = async (options: {
    status?: BusinessStatus;
    lat?: number | null;
    lng?: number | null;
    priceCents?: number;
    name?: string;
    locationName?: string;
  } = {}) => {
    const business = await createBusiness(prisma, {
      status: options.status ?? BusinessStatus.APPROVED,
      priceCents: options.priceCents ?? 4500,
    });
    await prisma.businessProfile.update({
      where: { id: business.businessId },
      data: { name: options.name ?? 'Test Salon' },
    });
    await prisma.location.update({
      where: { id: business.locationId },
      data: {
        name: options.locationName ?? 'Main Branch',
        latitude: options.lat === undefined ? JUBA.lat : options.lat,
        longitude: options.lng === undefined ? JUBA.lng : options.lng,
      },
    });
    return business;
  };

  const setRate = () => settings.setExchangeRate(650, 'SSP', { role: 'ADMIN' });

  const ids = (result: { locations: Array<{ id: string }> }) =>
    result.locations.map((l) => l.id);

  // ------------------------------------------------------------------
  describe('only publicly bookable businesses appear', () => {
    const HIDDEN = [
      BusinessStatus.PENDING,
      BusinessStatus.REJECTED,
      BusinessStatus.SUSPENDED,
    ];

    it.each(HIDDEN)('a %s business is absent from search', async (status) => {
      const hidden = await shop({ status });
      const visible = await shop();

      const result = await discovery.search({});

      expect(ids(result)).toEqual([visible.locationId]);
      expect(ids(result)).not.toContain(hidden.locationId);
    });

    it.each(HIDDEN)('a %s business 404s on detail', async (status) => {
      const hidden = await shop({ status });

      await expect(discovery.findOne(hidden.locationId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('an approved business is reachable on both', async () => {
      const open = await shop();

      const search = await discovery.search({});
      const detail = await discovery.findOne(open.locationId);

      expect(ids(search)).toContain(open.locationId);
      expect(detail.id).toBe(open.locationId);
    });

    it('404s on a location that does not exist', async () => {
      await expect(
        discovery.findOne('00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('filters', () => {
    it('q matches the business name', async () => {
      const match = await shop({ name: 'Nile Barbers' });
      await shop({ name: 'Konyo Spa' });

      const result = await discovery.search({ q: 'nile' });

      expect(ids(result)).toEqual([match.locationId]);
    });

    it('q matches the location name', async () => {
      const match = await shop({ locationName: 'Hai Cinema Branch' });
      await shop({ locationName: 'Munuki Branch' });

      const result = await discovery.search({ q: 'cinema' });

      expect(ids(result)).toEqual([match.locationId]);
    });

    it('q matches a service name', async () => {
      const match = await shop();
      await shop();
      await prisma.service.updateMany({
        where: { businessId: match.businessId },
        data: { name: 'Beard trim' },
      });

      const result = await discovery.search({ q: 'beard' });

      expect(ids(result)).toEqual([match.locationId]);
    });

    it('q is case-insensitive', async () => {
      const match = await shop({ name: 'Nile Barbers' });

      expect(ids(await discovery.search({ q: 'NILE' }))).toEqual([match.locationId]);
      expect(ids(await discovery.search({ q: 'nIlE' }))).toEqual([match.locationId]);
    });

    it('filters by category', async () => {
      const category = await prisma.category.create({ data: { name: `Cat ${Date.now()}` } });
      const match = await shop();
      await shop();
      await prisma.businessProfile.update({
        where: { id: match.businessId },
        data: { categoryId: category.id },
      });

      const result = await discovery.search({ categoryId: category.id });

      expect(ids(result)).toEqual([match.locationId]);
    });

    it('filters by minRating', async () => {
      const good = await shop();
      const poor = await shop();
      await prisma.location.update({
        where: { id: good.locationId },
        data: { ratingAvg: 4.5, ratingCount: 10 },
      });
      await prisma.location.update({
        where: { id: poor.locationId },
        data: { ratingAvg: 2.0, ratingCount: 4 },
      });

      const result = await discovery.search({ minRating: 4 });

      expect(ids(result)).toEqual([good.locationId]);
    });

    it('filters by maxPriceCents against the cheapest service', async () => {
      const cheap = await shop({ priceCents: 2000 });
      await shop({ priceCents: 9000 });

      const result = await discovery.search({ maxPriceCents: 5000 });

      expect(ids(result)).toEqual([cheap.locationId]);
    });

    it('combines two filters', async () => {
      const target = await shop({ name: 'Nile Barbers', priceCents: 2000 });
      await shop({ name: 'Nile Spa', priceCents: 9000 });
      await shop({ name: 'Konyo Barbers', priceCents: 2000 });

      const result = await discovery.search({ q: 'nile', maxPriceCents: 5000 });

      expect(ids(result)).toEqual([target.locationId]);
    });

    it('sorts by rating, unrated last', async () => {
      const best = await shop();
      const mid = await shop();
      const unrated = await shop();
      await prisma.location.update({
        where: { id: best.locationId },
        data: { ratingAvg: 4.9, ratingCount: 20 },
      });
      await prisma.location.update({
        where: { id: mid.locationId },
        data: { ratingAvg: 3.1, ratingCount: 5 },
      });

      const result = await discovery.search({ sort: DiscoverySort.RATING });

      expect(ids(result)).toEqual([best.locationId, mid.locationId, unrated.locationId]);
    });
  });

  // ------------------------------------------------------------------
  describe('distance', () => {
    /** Three branches on the same meridian, 0 / 0.1° / 1.0° north of Juba. */
    const threeInALine = async () => {
      const here = await shop({ lat: JUBA.lat, lng: JUBA.lng, locationName: 'Here' });
      const near = await shop({
        lat: JUBA.lat + 0.1,
        lng: JUBA.lng,
        locationName: 'Near',
      });
      const far = await shop({ lat: JUBA.lat + 1.0, lng: JUBA.lng, locationName: 'Far' });
      return { here, near, far };
    };

    it('computes a distance that matches hand arithmetic', async () => {
      const { near } = await threeInALine();

      const result = await discovery.search({
        lat: JUBA.lat,
        lng: JUBA.lng,
        radiusKm: 50,
        sort: DiscoverySort.DISTANCE,
      });

      const nearRow = result.locations.find((l) => l.id === near.locationId)!;
      // 0.1° of latitude = 11.119 km. Not merely "greater than zero".
      expect(nearRow.distanceKm).toBeCloseTo(KM_PER_DEGREE_LAT * 0.1, 1);
      expect(nearRow.distanceKm).toBeGreaterThan(11.0);
      expect(nearRow.distanceKm).toBeLessThan(11.3);
    });

    it('reports zero distance for the exact centre', async () => {
      const { here } = await threeInALine();

      const result = await discovery.search({
        lat: JUBA.lat,
        lng: JUBA.lng,
        radiusKm: 50,
        sort: DiscoverySort.DISTANCE,
      });

      const row = result.locations.find((l) => l.id === here.locationId)!;
      expect(row.distanceKm).toBe(0);
    });

    it('orders nearest first', async () => {
      const { here, near } = await threeInALine();

      const result = await discovery.search({
        lat: JUBA.lat,
        lng: JUBA.lng,
        radiusKm: 500,
        sort: DiscoverySort.DISTANCE,
      });

      expect(ids(result).slice(0, 2)).toEqual([here.locationId, near.locationId]);
    });

    it('radiusKm excludes the far one', async () => {
      const { here, near, far } = await threeInALine();

      // 20 km takes in 0 and 11.12, and leaves out 111.19.
      const result = await discovery.search({
        lat: JUBA.lat,
        lng: JUBA.lng,
        radiusKm: 20,
        sort: DiscoverySort.DISTANCE,
      });

      expect(ids(result).sort()).toEqual([here.locationId, near.locationId].sort());
      expect(ids(result)).not.toContain(far.locationId);
    });

    it('a wider radius takes the far one back in', async () => {
      const { far } = await threeInALine();

      const result = await discovery.search({
        lat: JUBA.lat,
        lng: JUBA.lng,
        radiusKm: 200,
        sort: DiscoverySort.DISTANCE,
      });

      const row = result.locations.find((l) => l.id === far.locationId)!;
      expect(row.distanceKm).toBeCloseTo(KM_PER_DEGREE_LAT, 0);
    });

    it('omits distanceKm entirely when no centre was given', async () => {
      await threeInALine();

      const result = await discovery.search({});

      expect(result.locations.every((l) => !('distanceKm' in l))).toBe(true);
    });

    it('requires all three of lat, lng and radiusKm', async () => {
      await expect(discovery.search({ lat: JUBA.lat })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        discovery.search({ lat: JUBA.lat, lng: JUBA.lng }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses sort=distance without a centre', async () => {
      await expect(
        discovery.search({ sort: DiscoverySort.DISTANCE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('a location without coordinates', () => {
      it('is absent from a distance search', async () => {
        const located = await shop({ lat: JUBA.lat, lng: JUBA.lng });
        const unlocated = await shop({ lat: null, lng: null });

        const result = await discovery.search({
          lat: JUBA.lat,
          lng: JUBA.lng,
          radiusKm: 50,
        });

        // A distance to an unknown point cannot be computed, and must not be
        // faked. Absent is the honest answer.
        expect(ids(result)).toEqual([located.locationId]);
        expect(ids(result)).not.toContain(unlocated.locationId);
      });

      it('is present in an ordinary browse', async () => {
        const unlocated = await shop({ lat: null, lng: null });

        const result = await discovery.search({});

        expect(ids(result)).toContain(unlocated.locationId);
        expect(result.locations[0].latitude).toBeNull();
      });
    });
  });

  // ------------------------------------------------------------------
  describe('fromPriceCents', () => {
    it('is the cheapest ACTIVE service', async () => {
      const business = await shop({ priceCents: 9000 });
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Cheaper',
          priceCents: 2500,
          durationMinutes: 30,
          depositPercentage: 20,
        },
      });

      const result = await discovery.search({});

      expect(result.locations[0].fromPriceCents).toBe(2500);
    });

    it('ignores a soft-deleted cheaper service', async () => {
      const business = await shop({ priceCents: 9000 });
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Retired bargain',
          priceCents: 100,
          durationMinutes: 30,
          depositPercentage: 20,
          isActive: false,
        },
      });

      const result = await discovery.search({});

      // A retired service is not bookable, so it must not set the headline.
      expect(result.locations[0].fromPriceCents).toBe(9000);
    });

    it('is null when a business has no active services at all', async () => {
      const business = await shop();
      await prisma.service.updateMany({
        where: { businessId: business.businessId },
        data: { isActive: false },
      });

      const result = await discovery.search({});

      expect(result.locations[0].fromPriceCents).toBeNull();
      expect(result.locations[0]).not.toHaveProperty('approxSettlement');
    });

    it('is shared across two branches of one business', async () => {
      const business = await shop({ priceCents: 3000 });
      await prisma.location.create({
        data: {
          businessId: business.businessId,
          name: 'Second Branch',
          address: 'Elsewhere',
          latitude: JUBA.lat,
          longitude: JUBA.lng,
        },
      });

      const result = await discovery.search({});

      // Services belong to the business and are shared across its locations
      // (§10.2), so both branches genuinely have the same cheapest price.
      expect(result.locations).toHaveLength(2);
      expect(result.locations.every((l) => l.fromPriceCents === 3000)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  describe('approxSettlement', () => {
    it('is attached to the headline price', async () => {
      await setRate();
      await shop({ priceCents: 4500 });

      const result = await discovery.search({});

      const settlement = (result.locations[0] as any).approxSettlement.fromPriceCents;
      // $45.00 × 650 = 29 250 SSP.
      expect(settlement.currency).toBe('SSP');
      expect(settlement.amountMinor).toBe(2_925_000);
      expect(settlement.approximate).toBe(true);
    });

    it('is absent entirely when no rate is configured', async () => {
      await shop();

      const result = await discovery.search({});

      expect(result.locations[0]).not.toHaveProperty('approxSettlement');
      expect(result.locations[0].fromPriceCents).toBe(4500);
    });

    it('reads the rate exactly ONCE for a whole page', async () => {
      await setRate();
      for (let i = 0; i < 5; i++) await shop();
      const spy = jest.spyOn(settings, 'getExchangeRateForDisplay');

      const result = await discovery.search({});

      expect(result.locations).toHaveLength(5);
      // A page whose rows converted at different rates would be indefensible.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('converts every row at the same rate', async () => {
      await setRate();
      for (let i = 0; i < 3; i++) await shop();

      const result = await discovery.search({});

      const rates = new Set(
        result.locations.map((l: any) => l.approxSettlement.fromPriceCents.exchangeRate),
      );
      expect(rates.size).toBe(1);
    });

    it('is attached to every service on the detail response', async () => {
      await setRate();
      const business = await shop({ priceCents: 4500 });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.services[0].approxSettlement.priceCents.amountMinor).toBe(2_925_000);
    });
  });

  // ------------------------------------------------------------------
  describe('openNow', () => {
    /**
     * The service reads the real clock, so these drive the answer through
     * `isOpenAt` with an explicit minute instead of trying to freeze time.
     * The boundary convention is what is actually under test.
     */
    const NINE_TO_FIVE = { openTime: '09:00', closeTime: '17:00', isClosed: false };

    it('is open during the day', () => {
      expect(isOpenAt(NINE_TO_FIVE, 12 * 60)).toBe(true);
    });

    it('is OPEN at exactly the opening minute', () => {
      expect(isOpenAt(NINE_TO_FIVE, 9 * 60)).toBe(true);
    });

    it('is CLOSED at exactly the closing minute', () => {
      // Half-open [open, close), matching every other interval in the codebase.
      // At 17:00 the shop is shutting; saying "open" sends someone to a locked
      // door.
      expect(isOpenAt(NINE_TO_FIVE, 17 * 60)).toBe(false);
    });

    it('is closed one minute before opening and open one before closing', () => {
      expect(isOpenAt(NINE_TO_FIVE, 9 * 60 - 1)).toBe(false);
      expect(isOpenAt(NINE_TO_FIVE, 17 * 60 - 1)).toBe(true);
    });

    it('is closed on a day the template calls closed', () => {
      expect(isOpenAt({ ...NINE_TO_FIVE, isClosed: true }, 12 * 60)).toBe(false);
    });

    it('is closed when there are no hours for the day at all', () => {
      expect(isOpenAt(null, 12 * 60)).toBe(false);
    });

    it('treats malformed or inverted hours as closed rather than throwing', () => {
      expect(isOpenAt({ openTime: 'nonsense', closeTime: '17:00', isClosed: false }, 600)).toBe(
        false,
      );
      expect(isOpenAt({ openTime: '20:00', closeTime: '02:00', isClosed: false }, 1_300)).toBe(
        false,
      );
    });

    it('reports openNow on every search result', async () => {
      await shop();

      const result = await discovery.search({});

      expect(typeof result.locations[0].openNow).toBe('boolean');
    });

    it('reports a location closed today as closed', async () => {
      const business = await shop();
      // Closed every day of the week, so whatever today is, it is closed.
      for (let day = 0; day < 7; day++) {
        await prisma.locationHours.upsert({
          where: {
            locationId_dayOfWeek: { locationId: business.locationId, dayOfWeek: day },
          },
          update: { openTime: '09:00', closeTime: '17:00', isClosed: true },
          create: {
            locationId: business.locationId,
            dayOfWeek: day,
            openTime: '09:00',
            closeTime: '17:00',
            isClosed: true,
          },
        });
      }

      const result = await discovery.search({});

      expect(result.locations[0].openNow).toBe(false);
    });

    it("a closing exception for today overrides an open template", async () => {
      const business = await shop();
      for (let day = 0; day < 7; day++) {
        await prisma.locationHours.upsert({
          where: {
            locationId_dayOfWeek: { locationId: business.locationId, dayOfWeek: day },
          },
          update: { openTime: '00:00', closeTime: '23:59', isClosed: false },
          create: {
            locationId: business.locationId,
            dayOfWeek: day,
            openTime: '00:00',
            closeTime: '23:59',
            isClosed: false,
          },
        });
      }
      const openAllHours = await discovery.search({});
      expect(openAllHours.locations[0].openNow).toBe(true);

      const detail: any = await discovery.findOne(business.locationId);
      await prisma.locationScheduleException.create({
        data: {
          locationId: business.locationId,
          date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          isClosed: true,
          reason: 'Public holiday',
        },
      });

      // The exception outranks the template, exactly as availability resolves
      // it (§13.1).
      const afterException = await discovery.search({});
      expect(detail.openNow).toBe(true);
      expect(afterException.locations[0].openNow).toBe(false);
    });

    it('filters to open locations when openNow is requested', async () => {
      const open = await shop({ locationName: 'Always open' });
      const shut = await shop({ locationName: 'Always shut' });
      for (let day = 0; day < 7; day++) {
        await prisma.locationHours.upsert({
          where: { locationId_dayOfWeek: { locationId: open.locationId, dayOfWeek: day } },
          update: { openTime: '00:00', closeTime: '23:59', isClosed: false },
          create: {
            locationId: open.locationId,
            dayOfWeek: day,
            openTime: '00:00',
            closeTime: '23:59',
            isClosed: false,
          },
        });
        await prisma.locationHours.upsert({
          where: { locationId_dayOfWeek: { locationId: shut.locationId, dayOfWeek: day } },
          update: { openTime: '09:00', closeTime: '17:00', isClosed: true },
          create: {
            locationId: shut.locationId,
            dayOfWeek: day,
            openTime: '09:00',
            closeTime: '17:00',
            isClosed: true,
          },
        });
      }

      const result = await discovery.search({ openNow: true });

      expect(ids(result)).toEqual([open.locationId]);
    });
  });

  // ------------------------------------------------------------------
  describe('the detail response', () => {
    it('carries everything needed to decide, and no reviews', async () => {
      await setRate();
      const business = await shop();
      await prisma.locationHours.upsert({
        where: { locationId_dayOfWeek: { locationId: business.locationId, dayOfWeek: 1 } },
        update: { openTime: '09:00', closeTime: '17:00', isClosed: false },
        create: {
          locationId: business.locationId,
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '17:00',
          isClosed: false,
        },
      });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.business.name).toBe('Test Salon');
      expect(detail.services.length).toBeGreaterThanOrEqual(1);
      expect(detail.hours.length).toBeGreaterThanOrEqual(1);
      expect(detail.rating).toEqual({ average: null, count: 0 });
      expect(detail).toHaveProperty('gallery');
      expect(detail).toHaveProperty('upcomingExceptions');
      expect(detail.timeZone).toBe('Africa/Juba');
      // GET /locations/:id/reviews already exists, is paginated, and has its own
      // exposure rules. Duplicating them here would mean two places to keep right.
      expect(detail).not.toHaveProperty('reviews');
    });

    it('lists only ACTIVE services', async () => {
      const business = await shop();
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Retired',
          priceCents: 100,
          durationMinutes: 30,
          depositPercentage: 20,
          isActive: false,
        },
      });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.services.every((s: any) => s.name !== 'Retired')).toBe(true);
    });

    it('lists only upcoming schedule exceptions', async () => {
      const business = await shop();
      const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      await prisma.locationScheduleException.createMany({
        data: [
          {
            locationId: business.locationId,
            date: new Date(`${yesterday}T00:00:00.000Z`),
            isClosed: true,
            reason: 'Past',
          },
          {
            locationId: business.locationId,
            date: new Date(`${tomorrow}T00:00:00.000Z`),
            isClosed: true,
            reason: 'Future',
          },
        ],
      });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.upcomingExceptions).toHaveLength(1);
      expect(detail.upcomingExceptions[0].reason).toBe('Future');
    });
  });

  // ------------------------------------------------------------------
  describe('pagination and query budget', () => {
    it('follows the offset/limit convention used everywhere else', async () => {
      for (let i = 0; i < 5; i++) await shop({ locationName: `Branch ${i}` });

      const page = await discovery.search({ limit: 2, offset: 2 });

      expect(page.total).toBe(5);
      expect(page.limit).toBe(2);
      expect(page.offset).toBe(2);
      expect(page.locations).toHaveLength(2);
    });

    it('issues NO per-row queries for a 20-result page', async () => {
      await setRate();
      for (let i = 0; i < 20; i++) await shop({ locationName: `Branch ${i}` });

      const cheapest = jest.spyOn(prisma.service, 'groupBy');
      const hours = jest.spyOn(prisma.locationHours, 'findMany');
      const exceptions = jest.spyOn(prisma.locationScheduleException, 'findMany');
      const rate = jest.spyOn(settings, 'getExchangeRateForDisplay');

      const result = await discovery.search({ limit: 20 });

      expect(result.locations).toHaveLength(20);
      // One each, for the whole page — not one per row.
      expect(cheapest).toHaveBeenCalledTimes(1);
      expect(hours).toHaveBeenCalledTimes(1);
      expect(exceptions).toHaveBeenCalledTimes(1);
      expect(rate).toHaveBeenCalledTimes(1);
    });

    it('costs the same number of lookups for 1 row as for 20', async () => {
      await setRate();
      await shop();

      const cheapest = jest.spyOn(prisma.service, 'groupBy');
      const hours = jest.spyOn(prisma.locationHours, 'findMany');

      await discovery.search({});

      expect(cheapest).toHaveBeenCalledTimes(1);
      expect(hours).toHaveBeenCalledTimes(1);
    });
  });
});
