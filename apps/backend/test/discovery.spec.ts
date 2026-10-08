import { INTERNAL_CURRENCY } from '../src/payments/currency';
import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
// Discovery marks each result saved-or-not since §120, so it needs this.
import { FavouritesService } from '../src/favourites/favourites.service';
import { DiscoverySort } from '../src/discovery/dto/discover-locations.dto';
import { isOpenAt } from '../src/discovery/open-now';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';
import { recalculateFromPrice } from '../src/business/from-price';

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
    moduleRef = await createTestModule([DiscoveryService, FavouritesService]);
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
    // Clear only the exchange rate, not the whole settings row: deleting the
    // row makes the platform-fee read log a genuine alarm on every test, and a
    // suite that cries wolf teaches everyone to ignore that log.
    await prisma.platformSetting.updateMany({
      data: {
        exchangeRateUsdToProviderCurrency: null,
        exchangeRateUpdatedAt: null,
      },
    });
  });

  /** A business with one located branch. */
  const shop = async (options: {
    status?: BusinessStatus;
    lat?: number | null;
    lng?: number | null;
    priceMinor?: number;
    name?: string;
    locationName?: string;
  } = {}) => {
    const business = await createBusiness(prisma, {
      status: options.status ?? BusinessStatus.APPROVED,
      priceMinor: options.priceMinor ?? 4500,
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

  /** Today in Africa/Juba, as a UTC-midnight Date — the @db.Date convention. */
  const platformToday = () =>
    new Date(
      `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())}T00:00:00.000Z`,
    );

  /** Direct prisma writes bypass the write paths that maintain the column. */
  const reprice = (businessId: string) => recalculateFromPrice(prisma, businessId);

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

    it('filters by maxPriceMinor against the cheapest service', async () => {
      const cheap = await shop({ priceMinor: 2000 });
      await shop({ priceMinor: 9000 });

      const result = await discovery.search({ maxPriceMinor: 5000 });

      expect(ids(result)).toEqual([cheap.locationId]);
    });

    it('combines two filters', async () => {
      const target = await shop({ name: 'Nile Barbers', priceMinor: 2000 });
      await shop({ name: 'Nile Spa', priceMinor: 9000 });
      await shop({ name: 'Konyo Barbers', priceMinor: 2000 });

      const result = await discovery.search({ q: 'nile', maxPriceMinor: 5000 });

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

    it('sorts by newest, most recently listed first', async () => {
      const oldest = await shop();
      const middle = await shop();
      const newest = await shop();
      // Written explicitly: three rows created inside the same millisecond would
      // otherwise fall back to the name tie-break and test nothing.
      await prisma.location.update({
        where: { id: oldest.locationId },
        data: { createdAt: new Date('2026-01-01T00:00:00Z') },
      });
      await prisma.location.update({
        where: { id: middle.locationId },
        data: { createdAt: new Date('2026-06-01T00:00:00Z') },
      });
      await prisma.location.update({
        where: { id: newest.locationId },
        data: { createdAt: new Date('2026-09-01T00:00:00Z') },
      });

      const result = await discovery.search({ sort: DiscoverySort.NEWEST });

      expect(ids(result)).toEqual([
        newest.locationId,
        middle.locationId,
        oldest.locationId,
      ]);
    });

    it('newest follows when the shop was LISTED, not when it was last edited', async () => {
      const older = await shop();
      const newer = await shop();
      await prisma.location.update({
        where: { id: older.locationId },
        data: { createdAt: new Date('2026-01-01T00:00:00Z') },
      });
      await prisma.location.update({
        where: { id: newer.locationId },
        data: { createdAt: new Date('2026-09-01T00:00:00Z') },
      });

      // The older shop edits its opening hours today. That must not promote it:
      // on `updatedAt` the list would reshuffle every time anyone saved anything.
      await prisma.location.update({
        where: { id: older.locationId },
        data: { name: 'Renamed today' },
      });

      const result = await discovery.search({ sort: DiscoverySort.NEWEST });

      expect(ids(result)).toEqual([newer.locationId, older.locationId]);
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

    it('needs lat and lng together — a radius is optional (§107)', async () => {
      // Half a coordinate is not a place.
      await expect(discovery.search({ lat: JUBA.lat })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // And a radius has to be a radius around something.
      await expect(discovery.search({ radiusKm: 5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      // ~~All three were once required.~~ Superseded in §107: a position
      // without a radius is valid and means "order by distance, exclude
      // nothing". Requiring the radius forced every proximity search to also
      // be a filter.
      await expect(
        discovery.search({ lat: JUBA.lat, lng: JUBA.lng }),
      ).resolves.toBeDefined();
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
  describe('fromPriceMinor', () => {
    it('is the cheapest ACTIVE service', async () => {
      const business = await shop({ priceMinor: 9000 });
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Cheaper',
          // Offered at this business's branch, at that branch's price (§72).
          locations: { create: [{ locationId: business.locationId, priceMinor: 2500 }] },
          currency: INTERNAL_CURRENCY,
          durationMinutes: 30,
          depositPercentage: 20,
        },
      });
      await reprice(business.businessId);

      const result = await discovery.search({});

      expect(result.locations[0].fromPriceMinor).toBe(2500);
    });

    it('ignores a soft-deleted cheaper service', async () => {
      const business = await shop({ priceMinor: 9000 });
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Retired bargain',
          // Offered at this business's branch, at that branch's price (§72).
          locations: { create: [{ locationId: business.locationId, priceMinor: 100 }] },
          currency: INTERNAL_CURRENCY,
          durationMinutes: 30,
          depositPercentage: 20,
          isActive: false,
        },
      });
      await reprice(business.businessId);

      const result = await discovery.search({});

      // A retired service is not bookable, so it must not set the headline.
      expect(result.locations[0].fromPriceMinor).toBe(9000);
    });

    it('is null when a business has no active services at all', async () => {
      const business = await shop();
      await prisma.service.updateMany({
        where: { businessId: business.businessId },
        data: { isActive: false },
      });
      await reprice(business.businessId);

      const result = await discovery.search({});

      expect(result.locations[0].fromPriceMinor).toBeNull();
      expect(result.locations[0]).not.toHaveProperty('approxSettlement');
    });

    /**
     * Reversed by §72. A second branch offers nothing until it is told to, so
     * its headline price is null rather than inherited from the chain.
     */
    it('is NOT shared with a branch that offers nothing', async () => {
      const business = await shop({ priceMinor: 3000 });
      await prisma.location.create({
        data: {
          businessId: business.businessId,
          name: 'Second Branch',
          address: 'Elsewhere',
          latitude: JUBA.lat,
          longitude: JUBA.lng,
        },
      });
      await reprice(business.businessId);

      const result = await discovery.search({});

      expect(result.locations).toHaveLength(2);
      // The original branch keeps its price; the new one has nothing to sell.
      // Compared as a set: the default sort stringifies, which puts null after
      // a number and makes the assertion depend on JavaScript trivia.
      const prices = result.locations.map((l) => l.fromPriceMinor);
      expect(prices).toContain(3000);
      expect(prices).toContain(null);
    });

    it('shows each branch its own price when they differ (§72)', async () => {
      const business = await shop({ priceMinor: 3000 });
      const second = await prisma.location.create({
        data: {
          businessId: business.businessId,
          name: 'Second Branch',
          address: 'Elsewhere',
          latitude: JUBA.lat,
          longitude: JUBA.lng,
        },
      });
      await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Dearer in town',
          currency: INTERNAL_CURRENCY,
          durationMinutes: 30,
          depositPercentage: 20,
          locations: { create: [{ locationId: second.id, priceMinor: 7000 }] },
        },
      });
      await reprice(business.businessId);

      const result = await discovery.search({});

      const prices = result.locations.map((l) => l.fromPriceMinor).sort((a, b) => a! - b!);
      expect(prices).toEqual([3000, 7000]);
    });
  });

  // ------------------------------------------------------------------
  describe('approxSettlement', () => {
    it('is attached to the headline price', async () => {
      await setRate();
      await shop({ priceMinor: 4500 });

      const result = await discovery.search({});

      const settlement = (result.locations[0] as any).approxSettlement.fromPriceMinor;
      // $45.00 × 650 = 29 250 SSP.
      expect(settlement.currency).toBe('SSP');
      expect(settlement.amountMinor).toBe(292_500_000);
      expect(settlement.approximate).toBe(true);
    });

    it('is absent entirely when no rate is configured', async () => {
      await shop();

      const result = await discovery.search({});

      expect(result.locations[0]).not.toHaveProperty('approxSettlement');
      expect(result.locations[0].fromPriceMinor).toBe(4500);
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
        result.locations.map((l: any) => l.approxSettlement.fromPriceMinor.exchangeRate),
      );
      expect(rates.size).toBe(1);
    });

    it('is attached to every service on the detail response', async () => {
      await setRate();
      const business = await shop({ priceMinor: 4500 });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.services[0].approxSettlement.priceMinor.amountMinor).toBe(292_500_000);
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

    /** Open or shut every day of the week, so "today" cannot matter. */
    const alwaysOpen = (locationId: string) => setEveryDay(locationId, false);
    const alwaysShut = (locationId: string) => setEveryDay(locationId, true);

    async function setEveryDay(locationId: string, isClosed: boolean) {
      for (let day = 0; day < 7; day++) {
        await prisma.locationHours.upsert({
          where: { locationId_dayOfWeek: { locationId, dayOfWeek: day } },
          update: { openTime: '00:00', closeTime: '23:59', isClosed },
          create: {
            locationId,
            dayOfWeek: day,
            openTime: '00:00',
            closeTime: '23:59',
            isClosed,
          },
        });
      }
    }

    describe('as a filter, it has to be in the query (§114.2)', () => {
      it('total counts the OPEN ones, not every one', async () => {
        const open = await shop();
        const shut = await shop();
        await alwaysOpen(open.locationId);
        await alwaysShut(shut.locationId);

        const result = await discovery.search({ openNow: true });

        // The bug: `total` was the unfiltered count, so this said 2 while
        // returning 1 — and a client paginating on it asked for a page that
        // does not exist.
        expect(ids(result)).toEqual([open.locationId]);
        expect(result.total).toBe(1);
      });

      it('fills a page, rather than filtering rows out of one', async () => {
        // Three shut ones first by name, so an unfiltered page of 2 would hold
        // only closed branches and come back EMPTY after a post-filter.
        for (const name of ['AAA 1', 'AAA 2', 'AAA 3']) {
          const s = await shop({ locationName: name });
          await alwaysShut(s.locationId);
        }
        const first = await shop({ locationName: 'ZZZ open 1' });
        const second = await shop({ locationName: 'ZZZ open 2' });
        await alwaysOpen(first.locationId);
        await alwaysOpen(second.locationId);

        const page = await discovery.search({ openNow: true, limit: 2 });

        expect(page.total).toBe(2);
        expect(page.locations).toHaveLength(2);
        expect(ids(page).sort()).toEqual([first.locationId, second.locationId].sort());
      });

      it('offset counts open branches, not rows the filter would remove', async () => {
        // Deliberately ordered so a post-filter cannot look right by accident.
        // The default sort is by name, so this is: open, open, shut, shut, open.
        const made: string[] = [];
        for (const name of ['A open', 'B open', 'C shut', 'D shut', 'E open']) {
          const s = await shop({ locationName: name });
          const open = name.endsWith('open');
          await (open ? alwaysOpen(s.locationId) : alwaysShut(s.locationId));
          if (open) made.push(s.locationId);
        }

        const one = await discovery.search({ openNow: true, limit: 2, offset: 0 });
        const two = await discovery.search({ openNow: true, limit: 2, offset: 2 });

        // This is the assertion that catches the old behaviour. Filtering AFTER
        // take/skip, offset 2 lands on "C shut" and "D shut" and returns NOTHING
        // — while "E open" exists and is now unreachable at any offset.
        expect(ids(two)).toHaveLength(1);
        expect([...ids(one), ...ids(two)].sort()).toEqual([...made].sort());
      });

      it('says nothing is open rather than returning closed ones', async () => {
        const shut = await shop();
        await alwaysShut(shut.locationId);

        const result = await discovery.search({ openNow: true });

        expect(result.total).toBe(0);
        expect(result.locations).toEqual([]);
      });
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
          // The platform timezone's today, not UTC's. Near midnight UTC the two
          // are different days, and an exception filed against the wrong one
          // silently does nothing.
          date: platformToday(),
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
      expect(detail.timeZone).toBe('Africa/Kigali');
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
          // Offered at this business's branch, at that branch's price (§72).
          locations: { create: [{ locationId: business.locationId, priceMinor: 100 }] },
          currency: INTERNAL_CURRENCY,
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
      // A calendar day, as the business API sends it — not UTC midnight (§208).
      expect(detail.upcomingExceptions[0].date).toBe(tomorrow);
    });
  });

  // ------------------------------------------------------------------
  describe('sort=price orders across pages (§44)', () => {
    it('puts the cheapest on page one, not merely first within a page', async () => {
      // More locations than a page holds, with the cheapest created LAST so it
      // could only reach page one by being ordered in SQL.
      for (let i = 0; i < 25; i++) {
        await shop({ priceMinor: 9000 + i, locationName: `Dear ${i}` });
      }
      const bargain = await shop({ priceMinor: 100, locationName: 'Bargain' });

      const page = await discovery.search({ sort: DiscoverySort.PRICE, limit: 5 });

      expect(page.total).toBe(26);
      expect(ids(page)[0]).toBe(bargain.locationId);
      expect(page.locations[0].fromPriceMinor).toBe(100);
    });

    it('orders ascending and pages coherently', async () => {
      const prices = [500, 1500, 2500, 3500];
      for (const priceMinor of prices) {
        await shop({ priceMinor, locationName: `At ${priceMinor}` });
      }

      const first = await discovery.search({ sort: DiscoverySort.PRICE, limit: 2 });
      const second = await discovery.search({
        sort: DiscoverySort.PRICE,
        limit: 2,
        offset: 2,
      });

      expect(first.locations.map((l) => l.fromPriceMinor)).toEqual([500, 1500]);
      expect(second.locations.map((l) => l.fromPriceMinor)).toEqual([2500, 3500]);
    });

    it('sorts a business with no active services LAST, not out', async () => {
      const priced = await shop({ priceMinor: 4500 });
      const empty = await shop();
      await prisma.service.updateMany({
        where: { businessId: empty.businessId },
        data: { isActive: false },
      });
      await reprice(empty.businessId);

      const page = await discovery.search({ sort: DiscoverySort.PRICE });

      // A business with no services yet is not free, and is not "no results".
      expect(ids(page)).toEqual([priced.locationId, empty.locationId]);
      expect(page.locations[1].fromPriceMinor).toBeNull();
    });

    it('a business with no active services still appears in ordinary browse', async () => {
      const empty = await shop();
      await prisma.service.updateMany({
        where: { businessId: empty.businessId },
        data: { isActive: false },
      });
      await reprice(empty.businessId);

      const page = await discovery.search({});

      expect(ids(page)).toContain(empty.locationId);
    });

    it('filter and sort agree on the same number', async () => {
      for (const priceMinor of [1000, 4000, 7000, 12000]) {
        await shop({ priceMinor, locationName: `At ${priceMinor}` });
      }

      const page = await discovery.search({
        maxPriceMinor: 5000,
        sort: DiscoverySort.PRICE,
      });

      // Every row the filter let through is at or below the cap, by the same
      // column the ordering used.
      expect(page.locations).toHaveLength(2);
      expect(
        page.locations.every((l) => l.fromPriceMinor !== null && l.fromPriceMinor <= 5000),
      ).toBe(true);
      // And `total` agrees, because the filter is in the query now.
      expect(page.total).toBe(2);
    });

    it('maxPriceMinor excludes a business with no active services', async () => {
      const empty = await shop();
      await prisma.service.updateMany({
        where: { businessId: empty.businessId },
        data: { isActive: false },
      });
      await reprice(empty.businessId);

      const page = await discovery.search({ maxPriceMinor: 100_000 });

      // There is no price at or below the cap because there is no price at all.
      expect(ids(page)).not.toContain(empty.locationId);
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
      // ZERO since §44: the cheapest price is a column now, not a query.
      expect(cheapest).toHaveBeenCalledTimes(0);
      // One each, for the whole page — not one per row.
      expect(hours).toHaveBeenCalledTimes(1);
      expect(exceptions).toHaveBeenCalledTimes(1);
      expect(rate).toHaveBeenCalledTimes(1);
      expect(result.locations.every((l) => l.fromPriceMinor === 4500)).toBe(true);
    });

    it('costs the same number of lookups for 1 row as for 20', async () => {
      await setRate();
      await shop();

      const cheapest = jest.spyOn(prisma.service, 'groupBy');
      const hours = jest.spyOn(prisma.locationHours, 'findMany');

      await discovery.search({});

      expect(cheapest).toHaveBeenCalledTimes(0);
      expect(hours).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // LAST in the file on purpose: these create extra shops, and several tests
  // above assert on the FULL set of locations the database holds. Declared
  // earlier, they silently broke five of them.
  describe('service photos (§132)', () => {
    /**
     * The cross-module link, which is where §109 happened: the business can
     * upload a photo and the row exists, and the customer still sees nothing
     * because the customer-facing SELECT never asked for it.
     */
    it('reaches the shopfront, cover first', async () => {
      const business = await shop({});

      // Inserted out of order on purpose: the ordering must come from
      // displayOrder, not from insertion order or from the id.
      await prisma.serviceMedia.createMany({
        data: [
          { serviceId: business.serviceId, url: 'https://x.test/third.jpg', displayOrder: 2 },
          { serviceId: business.serviceId, url: 'https://x.test/first.jpg', displayOrder: 0 },
          { serviceId: business.serviceId, url: 'https://x.test/second.jpg', displayOrder: 1 },
        ],
      });

      const detail: any = await discovery.findOne(business.locationId);

      expect(detail.services[0].images.map((i: any) => i.url)).toEqual([
        'https://x.test/first.jpg',
        'https://x.test/second.jpg',
        'https://x.test/third.jpg',
      ]);
    });

    it('is an empty list when nothing is uploaded, not missing', async () => {
      const business = await shop({});

      const detail: any = await discovery.findOne(business.locationId);

      // A service with no photos is normal. The key must still be there, or a
      // client reading `images.length` crashes on the common case.
      expect(detail.services[0].images).toEqual([]);
    });

    it("carries photos of one service only, never another service's", async () => {
      const business = await shop({});
      const second = await prisma.service.create({
        data: {
          businessId: business.businessId,
          name: 'Beard trim',
          durationMinutes: 15,
          currency: 'RWF',
          locations: {
            create: { locationId: business.locationId, priceMinor: 2000 },
          },
        },
        select: { id: true },
      });
      await prisma.serviceMedia.create({
        data: { serviceId: second.id, url: 'https://x.test/beard.jpg' },
      });

      const detail: any = await discovery.findOne(business.locationId);
      const byName = Object.fromEntries(
        detail.services.map((svc: any) => [svc.name, svc.images.map((i: any) => i.url)]),
      );

      expect(byName['Beard trim']).toEqual(['https://x.test/beard.jpg']);
      expect(byName['Test Service'] ?? []).toEqual([]);
    });
  });


});
