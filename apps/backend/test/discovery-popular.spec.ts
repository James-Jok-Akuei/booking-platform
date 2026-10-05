import { AppointmentStatus, BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { DiscoverySort } from '../src/discovery/dto/discover-locations.dto';
import { byPopularity, popularityScore } from '../src/discovery/popularity';
import { FavouritesService } from '../src/favourites/favourites.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Popularity, and services as a list of their own (§135).
 *
 * Two things are worth protecting. The ranking is bookings WEIGHTED by rating,
 * so "busiest" and "most popular" are deliberately not the same list. And the
 * service search obeys every rule the place search does — a paused shop's
 * services must be as absent as the shop is.
 */
describe('Popularity and the service search (§135)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let discovery: DiscoveryService;
  let customerId: string;

  const shop = async (name: string, options: { priceMinor?: number; rating?: number } = {}) => {
    const business = await createBusiness(prisma, {
      status: BusinessStatus.APPROVED,
      priceMinor: options.priceMinor ?? 5000,
    });
    await prisma.businessProfile.update({ where: { id: business.businessId }, data: { name } });
    await prisma.location.update({
      where: { id: business.locationId },
      data: {
        name: `${name} Branch`,
        ...(options.rating !== undefined ? { ratingAvg: options.rating, ratingCount: 4 } : {}),
      },
    });
    await prisma.service.update({ where: { id: business.serviceId }, data: { name: `${name} cut` } });
    return business;
  };

  const book = async (business: TestBusiness, count: number, status: AppointmentStatus) => {
    for (let i = 0; i < count; i += 1) {
      hours += 3;
      await createAppointment(prisma, { business, customerId, status, startsInHours: hours });
    }
  };
  let hours = 24;

  beforeAll(async () => {
    moduleRef = await createTestModule([DiscoveryService, FavouritesService]);
    prisma = moduleRef.get(PrismaService);
    discovery = moduleRef.get(DiscoveryService);
    await resetDatabase(prisma);
    customerId = (await createCustomer(prisma)).userId;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.appointment.deleteMany({});
    await prisma.location.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.businessProfile.deleteMany({});
  });

  describe('the score', () => {
    it('is bookings weighted by rating, so busy is not the same as popular', () => {
      // Eleven bookings at 2.5 stars lose to ten at 4.8.
      expect(popularityScore(10, 4.8)).toBeGreaterThan(popularityScore(11, 2.5));
    });

    it('treats an unrated place as middling, not as zero', () => {
      expect(popularityScore(10, null)).toBeGreaterThan(popularityScore(10, 3));
      expect(popularityScore(10, null)).toBeLessThan(popularityScore(10, 4));
    });

    it('breaks a tie by rating, then by name, so the order is stable', () => {
      const rows = [
        { bookings: 0, ratingAvg: null, ratingCount: 0, name: 'Zed' },
        { bookings: 0, ratingAvg: null, ratingCount: 0, name: 'Abe' },
        { bookings: 0, ratingAvg: 4, ratingCount: 2, name: 'Mid' },
      ];
      expect([...rows].sort(byPopularity).map((r) => r.name)).toEqual(['Mid', 'Abe', 'Zed']);
    });
  });

  describe('places, sort=popular', () => {
    it('puts the most-booked first and says how many', async () => {
      const quiet = await shop('Quiet');
      const busy = await shop('Busy');
      await book(busy, 3, AppointmentStatus.COMPLETED);
      await book(quiet, 1, AppointmentStatus.BOOKED);

      const page = await discovery.search({ sort: DiscoverySort.POPULAR });

      expect(page.locations.map((l) => l.id)).toEqual([busy.locationId, quiet.locationId]);
      expect(page.locations.map((l) => l.bookingCount)).toEqual([3, 1]);
    });

    it('does not count bookings that were held, cancelled or missed', async () => {
      const real = await shop('Real');
      const noise = await shop('Noise');
      await book(real, 1, AppointmentStatus.COMPLETED);
      // Five rows, none of which is somebody actually coming.
      await book(noise, 2, AppointmentStatus.PENDING_PAYMENT);
      await book(noise, 2, AppointmentStatus.CANCELLED);
      await book(noise, 1, AppointmentStatus.NO_SHOW);

      const page = await discovery.search({ sort: DiscoverySort.POPULAR });

      expect(page.locations[0].id).toBe(real.locationId);
      expect(page.locations.find((l) => l.id === noise.locationId)?.bookingCount).toBe(0);
    });

    it('lets a better-rated place outrank a slightly busier one', async () => {
      const loved = await shop('Loved', { rating: 4.9 });
      const tolerated = await shop('Tolerated', { rating: 2.0 });
      await book(loved, 4, AppointmentStatus.COMPLETED);
      await book(tolerated, 5, AppointmentStatus.COMPLETED);

      const page = await discovery.search({ sort: DiscoverySort.POPULAR });

      expect(page.locations[0].id).toBe(loved.locationId);
    });

    it('pages across the whole ranking, not within a page', async () => {
      const a = await shop('A');
      const b = await shop('B');
      const c = await shop('C');
      await book(c, 3, AppointmentStatus.COMPLETED);
      await book(b, 2, AppointmentStatus.COMPLETED);
      await book(a, 1, AppointmentStatus.COMPLETED);

      const first = await discovery.search({ sort: DiscoverySort.POPULAR, limit: 2 });
      const second = await discovery.search({ sort: DiscoverySort.POPULAR, limit: 2, offset: 2 });

      expect(first.total).toBe(3);
      expect(first.locations.map((l) => l.id)).toEqual([c.locationId, b.locationId]);
      expect(second.locations.map((l) => l.id)).toEqual([a.locationId]);
    });

    it('carries the count on every other sort too', async () => {
      const one = await shop('One');
      await book(one, 2, AppointmentStatus.COMPLETED);

      const page = await discovery.search({ sort: DiscoverySort.RATING });

      expect(page.locations[0].bookingCount).toBe(2);
    });
  });

  describe('services', () => {
    it('lists a service at a branch, most-booked first by default', async () => {
      const quiet = await shop('Quiet');
      const busy = await shop('Busy');
      await book(busy, 2, AppointmentStatus.COMPLETED);

      const page = await discovery.searchServices({});

      expect(page.total).toBe(2);
      expect(page.services.map((s) => s.name)).toEqual(['Busy cut', 'Quiet cut']);
      expect(page.services[0]).toMatchObject({
        id: busy.serviceId,
        bookingCount: 2,
        priceMinor: 5000,
        location: { id: busy.locationId, name: 'Busy Branch' },
        business: { name: 'Busy' },
      });
      expect(page.services[1].location.id).toBe(quiet.locationId);
    });

    it('hides the services of a shop the place search hides', async () => {
      const open = await shop('Open');
      const paused = await shop('Paused');
      const pending = await shop('Pending');
      await prisma.businessProfile.update({
        where: { id: paused.businessId },
        data: { pausedAt: new Date() },
      });
      await prisma.businessProfile.update({
        where: { id: pending.businessId },
        data: { status: BusinessStatus.PENDING },
      });

      const page = await discovery.searchServices({});

      // The rule is not restated in the service search; it comes from the same
      // `buildWhere`. This is what proves that.
      expect(page.services.map((s) => s.location.id)).toEqual([open.locationId]);
    });

    it('hides a retired service and one switched off at the branch', async () => {
      const kept = await shop('Kept');
      const retired = await shop('Retired');
      const off = await shop('Off');
      await prisma.service.update({ where: { id: retired.serviceId }, data: { isActive: false } });
      await prisma.serviceLocation.updateMany({
        where: { serviceId: off.serviceId },
        data: { isOffered: false },
      });

      const page = await discovery.searchServices({});

      expect(page.services.map((s) => s.id)).toEqual([kept.serviceId]);
    });

    it('searches by the name of the SERVICE, and of its shop', async () => {
      await shop('Nails');
      const barber = await shop('Barber');
      await prisma.service.update({
        where: { id: barber.serviceId },
        data: { name: 'Hot-towel shave' },
      });

      const byService = await discovery.searchServices({ q: 'towel' });
      const byShop = await discovery.searchServices({ q: 'nails' });

      expect(byService.services.map((s) => s.name)).toEqual(['Hot-towel shave']);
      expect(byShop.services.map((s) => s.business.name)).toEqual(['Nails']);
    });

    it("caps the service's own price, and sorts by it", async () => {
      await shop('Dear', { priceMinor: 9000 });
      await shop('Cheap', { priceMinor: 2000 });
      await shop('Middle', { priceMinor: 5000 });

      const cheapest = await discovery.searchServices({ sort: DiscoverySort.PRICE });
      const capped = await discovery.searchServices({ maxPriceMinor: 5000 });

      expect(cheapest.services.map((s) => s.priceMinor)).toEqual([2000, 5000, 9000]);
      expect(capped.services.map((s) => s.priceMinor).sort()).toEqual([2000, 5000]);
    });

    it('carries the cover photo, or null', async () => {
      const withPhoto = await shop('Photo');
      await shop('Plain');
      await prisma.serviceMedia.createMany({
        data: [
          { serviceId: withPhoto.serviceId, url: 'https://x.test/second.jpg', displayOrder: 1 },
          { serviceId: withPhoto.serviceId, url: 'https://x.test/cover.jpg', displayOrder: 0 },
        ],
      });

      const page = await discovery.searchServices({});
      const byName = Object.fromEntries(page.services.map((s) => [s.business.name, s.imageUrl]));

      expect(byName).toEqual({ Photo: 'https://x.test/cover.jpg', Plain: null });
    });

    it('pages, and reports the total across pages', async () => {
      await shop('A');
      await shop('B');
      await shop('C');

      const first = await discovery.searchServices({ limit: 2 });
      const second = await discovery.searchServices({ limit: 2, offset: 2 });

      expect(first.total).toBe(3);
      expect(first.services).toHaveLength(2);
      expect(second.services).toHaveLength(1);
    });
  });
});
