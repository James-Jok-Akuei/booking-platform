import { jest } from '@jest/globals';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { ServicesService } from '../src/business/services.service';
import { LocationsService } from '../src/business/locations.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/**
 * Location.fromPriceMinor is a denormalised aggregate (§44), and the only way
 * it can be wrong is if a write path forgets to maintain it. Every test here
 * drives a REAL service or location write and then reads the column back.
 */
describe('Denormalised fromPriceMinor (§44)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let services: ServicesService;
  let locations: LocationsService;

  let business: TestBusiness;
  let other: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ServicesService,
      LocationsService,
      BusinessAccessService,
    ]);
    prisma = moduleRef.get(PrismaService);
    services = moduleRef.get(ServicesService);
    locations = moduleRef.get(LocationsService);
    await resetDatabase(prisma);
    await moduleRef
      .get(PlatformSettingsService)
      .setPlatformFeePercentage(10, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.location.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    business = await createBusiness(prisma, {
      status: BusinessStatus.APPROVED,
      priceMinor: 4500,
    });
    other = await createBusiness(prisma, {
      status: BusinessStatus.APPROVED,
      priceMinor: 8000,
    });
  });

  /** Every location of a business, with its denormalised price. */
  const pricesOf = async (businessId: string) =>
    (
      await prisma.location.findMany({
        where: { businessId },
        orderBy: { name: 'asc' },
        select: { fromPriceMinor: true },
      })
    ).map((l) => l.fromPriceMinor);

  const locationIdsOf = async (businessId: string) =>
    (await prisma.location.findMany({ where: { businessId }, select: { id: true } })).map(
      (l) => l.id,
    );

  /**
   * Adds a second and third branch offering the SAME menu at the same prices.
   *
   * Since §72 a branch offers only what it is given, so a bare new location
   * would have no price at all — true, and not what these tests are about. They
   * are about the aggregate moving when a service write happens, which needs
   * every branch to be selling the thing being written. Divergent prices get
   * their own section below.
   */
  const addBranches = async (target: TestBusiness, count = 2) => {
    const existing = await prisma.serviceLocation.findMany({
      where: { service: { businessId: target.businessId } },
      select: { serviceId: true, priceMinor: true },
    });

    for (let i = 0; i < count; i++) {
      await prisma.location.create({
        data: {
          businessId: target.businessId,
          name: `Branch ${i}`,
          address: 'Somewhere in Juba',
          latitude: 4.85,
          longitude: 31.58,
          fromPriceMinor: 4500,
        },
      });
    }

    const branches = await prisma.location.findMany({
      where: { businessId: target.businessId },
      select: { id: true },
    });
    const offered = new Set(
      (
        await prisma.serviceLocation.findMany({
          where: { service: { businessId: target.businessId } },
          select: { serviceId: true, locationId: true },
        })
      ).map((row) => `${row.serviceId}:${row.locationId}`),
    );
    await prisma.serviceLocation.createMany({
      data: branches.flatMap((branch) =>
        existing
          .filter((offer) => !offered.has(`${offer.serviceId}:${branch.id}`))
          .map((offer) => ({
            serviceId: offer.serviceId,
            locationId: branch.id,
            priceMinor: offer.priceMinor,
          })),
      ),
    });
  };

  /**
   * A service offered at every current branch, at one price.
   *
   * `offers` is the §72 shape. Defaulting to every branch keeps these tests
   * about the aggregate rather than about which branches were picked — the
   * picking has its own section.
   */
  const newService = async (
    target: TestBusiness,
    priceMinor: number,
    name = 'Extra',
    locationIds?: string[],
  ) =>
    services.create(target.userId, {
      name,
      durationMinutes: 30,
      depositPercentage: 20,
      offers: (locationIds ?? (await locationIdsOf(target.businessId))).map((id) => ({
        locationId: id,
        priceMinor,
      })),
    });

  it('the factory leaves a correct starting value', async () => {
    expect(await pricesOf(business.businessId)).toEqual([4500]);
  });

  describe('a service write updates EVERY location of that business', () => {
    it('creating a cheaper service lowers all of them', async () => {
      await addBranches(business);

      await newService(business, 1200);

      // Offered at all three branches, so all three move together.
      expect(await pricesOf(business.businessId)).toEqual([1200, 1200, 1200]);
    });

    it('creating a dearer service leaves them alone', async () => {
      await addBranches(business);

      await newService(business, 9900);

      expect(await pricesOf(business.businessId)).toEqual([4500, 4500, 4500]);
    });

    it('repricing the cheapest service moves all of them', async () => {
      await addBranches(business);
      const cheap = await newService(business, 1200);

      await services.update(business.userId, cheap.id, {
        offers: (await locationIdsOf(business.businessId)).map((id) => ({
          locationId: id,
          priceMinor: 800,
        })),
      });

      expect(await pricesOf(business.businessId)).toEqual([800, 800, 800]);
    });

    it('repricing upwards hands the headline to the next cheapest', async () => {
      await addBranches(business);
      const cheap = await newService(business, 1200);

      await services.update(business.userId, cheap.id, {
        offers: (await locationIdsOf(business.businessId)).map((id) => ({
          locationId: id,
          priceMinor: 6000,
        })),
      });

      // 4500 was always there; it becomes the headline again.
      expect(await pricesOf(business.businessId)).toEqual([4500, 4500, 4500]);
    });

    it('soft-deleting the cheapest service raises all of them', async () => {
      await addBranches(business);
      const cheap = await newService(business, 1200);

      await services.deactivate(business.userId, cheap.id);

      expect(await pricesOf(business.businessId)).toEqual([4500, 4500, 4500]);
    });

    it('reactivating it lowers them again', async () => {
      await addBranches(business);
      const cheap = await newService(business, 1200);
      await services.deactivate(business.userId, cheap.id);

      // An update that only flips isActive changes the cheapest price without
      // touching a price field — which is why the recompute is unconditional.
      await services.update(business.userId, cheap.id, { isActive: true });

      expect(await pricesOf(business.businessId)).toEqual([1200, 1200, 1200]);
    });

    it('goes null when the last active service is retired', async () => {
      const only = await prisma.service.findFirstOrThrow({
        where: { businessId: business.businessId },
      });

      await services.deactivate(business.userId, only.id);

      expect(await pricesOf(business.businessId)).toEqual([null]);
    });

    it('comes back from null when a service is added again', async () => {
      const only = await prisma.service.findFirstOrThrow({
        where: { businessId: business.businessId },
      });
      await services.deactivate(business.userId, only.id);

      await newService(business, 3300);

      expect(await pricesOf(business.businessId)).toEqual([3300]);
    });
  });

  describe('two branches of one chain can charge differently (§72)', () => {
    it('each branch shows its own cheapest price', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);

      await services.create(business.userId, {
        name: 'City prices',
        durationMinutes: 30,
        depositPercentage: 20,
        offers: [
          { locationId: first, priceMinor: 9000 },
          { locationId: second, priceMinor: 3000 },
        ],
      });

      const rows = await prisma.location.findMany({
        where: { businessId: business.businessId },
        select: { id: true, fromPriceMinor: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r.fromPriceMinor]));

      // 4500 is the factory service, offered at both branches by addBranches.
      expect(byId.get(first)).toBe(4500);
      expect(byId.get(second)).toBe(3000);
    });

    it('a service offered at one branch leaves the other alone', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);

      await newService(business, 100, 'Only here', [second]);

      const rows = await prisma.location.findMany({
        where: { businessId: business.businessId },
        select: { id: true, fromPriceMinor: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r.fromPriceMinor]));

      expect(byId.get(first)).toBe(4500);
      expect(byId.get(second)).toBe(100);
    });
  });

  describe('withdrawing a service from ONE branch (§73)', () => {
    it('leaves it on sale everywhere else, at their prices', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await services.create(business.userId, {
        name: 'Two prices',
        durationMinutes: 30,
        depositPercentage: 20,
        offers: [
          { locationId: first, priceMinor: 1000 },
          { locationId: second, priceMinor: 2000 },
        ],
      });

      const result = await services.removeFromLocation(
        business.userId,
        service.id,
        first,
      );

      expect(result.retired).toBe(false);
      expect(result.service.isActive).toBe(true);
      expect(result.service.locations).toHaveLength(1);
      expect(result.service.locations[0].locationId).toBe(second);
    });

    it('moves that branch back to its next cheapest', async () => {
      await addBranches(business, 1);
      const [first] = await locationIdsOf(business.businessId);
      const cheap = await newService(business, 900, 'Cheap');

      await services.removeFromLocation(business.userId, cheap.id, first);

      const row = await prisma.location.findUniqueOrThrow({ where: { id: first } });
      // 4500 is the factory service, still offered here.
      expect(row.fromPriceMinor).toBe(4500);
    });

    /**
     * A service active but sold nowhere is bookable by nobody while still
     * claiming to be on offer. Reaching that state from the obvious action
     * would make "active" mean two different things (§73).
     */
    it('retires the service outright when it was the last branch', async () => {
      const [only] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1200, 'Only here', [only]);

      const result = await services.removeFromLocation(
        business.userId,
        service.id,
        only,
      );

      expect(result.retired).toBe(true);
      expect(result.service.isActive).toBe(false);
      expect(result.service.locations).toHaveLength(0);
      expect(result.message).toMatch(/only branch/i);
    });

    it('404s on a branch that was not offering it', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1000, 'One branch', [first]);

      await expect(
        services.removeFromLocation(business.userId, service.id, second),
      ).rejects.toThrow(/not offered at that branch/);
    });

    it("404s on another business's service", async () => {
      const [mine] = await locationIdsOf(business.businessId);
      const theirs = await prisma.service.findFirstOrThrow({
        where: { businessId: other.businessId },
      });

      await expect(
        services.removeFromLocation(business.userId, theirs.id, mine),
      ).rejects.toThrow();
    });
  });

  describe('another business is never touched', () => {
    it('creating a service leaves the other business alone', async () => {
      await newService(business, 100);

      expect(await pricesOf(other.businessId)).toEqual([8000]);
    });

    it('retiring every service leaves the other business alone', async () => {
      const only = await prisma.service.findFirstOrThrow({
        where: { businessId: business.businessId },
      });

      await services.deactivate(business.userId, only.id);

      expect(await pricesOf(business.businessId)).toEqual([null]);
      expect(await pricesOf(other.businessId)).toEqual([8000]);
    });

    it('a cheaper service at one business does not undercut the other', async () => {
      await newService(business, 50);
      await newService(other, 7000);

      expect(await pricesOf(business.businessId)).toEqual([50]);
      expect(await pricesOf(other.businessId)).toEqual([7000]);
    });
  });

  describe('a new location opens offering nothing', () => {
    /**
     * Reversed by §72, deliberately.
     *
     * A new branch used to inherit the business's cheapest price, because every
     * location offered every service. Now a branch offers only what it is
     * given, so a brand-new one has nothing to sell and `fromPriceMinor` is
     * null until somebody says what it does.
     *
     * Null is the honest answer. The alternative — showing the chain's cheapest
     * price on a branch that cannot take a booking for it — is a listing
     * advertising a price nobody can book at, which is the thing §44 exists to
     * prevent.
     */
    it('opens with null, even when the business sells plenty', async () => {
      await newService(business, 1500);

      const created = await locations.create(business.userId, {
        name: 'Brand new branch',
        address: 'Ministries Road',
        latitude: 4.85,
        longitude: 31.58,
      });

      const row = await prisma.location.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.fromPriceMinor).toBeNull();
    });

    it('gets a price as soon as a service is offered there', async () => {
      const created = await locations.create(business.userId, {
        name: 'Second branch',
        address: 'Ministries Road',
        latitude: 4.85,
        longitude: 31.58,
      });

      await newService(business, 1500, 'Branch-only special', [created.id]);

      const row = await prisma.location.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.fromPriceMinor).toBe(1500);
    });

    it('opens with null when the business has no active services', async () => {
      const only = await prisma.service.findFirstOrThrow({
        where: { businessId: business.businessId },
      });
      await services.deactivate(business.userId, only.id);

      const created = await locations.create(business.userId, {
        name: 'Empty catalogue branch',
        address: 'Ministries Road',
        latitude: 4.85,
        longitude: 31.58,
      });

      const row = await prisma.location.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.fromPriceMinor).toBeNull();
    });
  });

  describe('it is one statement, not a loop', () => {
    it('costs the same whether the business has one branch or six', async () => {
      await addBranches(business, 5);
      const spy = jest.spyOn(prisma.location, 'updateMany');

      await newService(business, 1000);

      // The recompute is a single raw UPDATE covering every location, so no
      // per-location Prisma write is issued at all.
      expect(spy).toHaveBeenCalledTimes(0);
      expect(await pricesOf(business.businessId)).toEqual([
        1000, 1000, 1000, 1000, 1000, 1000,
      ]);
    });
  });
});
