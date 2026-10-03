import { jest } from '@jest/globals';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { ServicesService } from '../src/business/services.service';
// Creating a service requires the Seller Agreement to be accepted (§126).
import { LegalService } from '../src/legal/legal.service';
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
      LegalService,
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

  describe('pausing a service at ONE branch (§74)', () => {
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

      const result = await services.setOfferedAtLocation(
        business.userId,
        service.id,
        first,
        false,
      );

      expect(result.offeredAtCount).toBe(1);
      expect(result.service.isActive).toBe(true);
      const paused = result.service.locations.find((o) => o.locationId === first)!;
      expect(paused.isOffered).toBe(false);
    });

    /**
     * The whole reason §73's deletion was wrong: a pause must not cost the
     * price. Resuming is one call, not a re-entry of what the work costs.
     */
    it('KEEPS the price while paused, and restores it on resume', async () => {
      const [only] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1234, 'Seasonal', [only]);

      await services.setOfferedAtLocation(business.userId, service.id, only, false);
      const resumed = await services.setOfferedAtLocation(
        business.userId,
        service.id,
        only,
        true,
      );

      const offer = resumed.service.locations.find((o) => o.locationId === only)!;
      expect(offer.priceMinor).toBe(1234);
      expect(offer.isOffered).toBe(true);
    });

    it('a paused branch stops setting its headline price', async () => {
      await addBranches(business, 1);
      const [first] = await locationIdsOf(business.businessId);
      const cheap = await newService(business, 900, 'Cheap');

      await services.setOfferedAtLocation(business.userId, cheap.id, first, false);

      const row = await prisma.location.findUniqueOrThrow({ where: { id: first } });
      // 4500 is the factory service, still on sale here.
      expect(row.fromPriceMinor).toBe(4500);
    });

    it('and sets it again when resumed', async () => {
      await addBranches(business, 1);
      const [first] = await locationIdsOf(business.businessId);
      const cheap = await newService(business, 900, 'Cheap');
      await services.setOfferedAtLocation(business.userId, cheap.id, first, false);

      await services.setOfferedAtLocation(business.userId, cheap.id, first, true);

      const row = await prisma.location.findUniqueOrThrow({ where: { id: first } });
      expect(row.fromPriceMinor).toBe(900);
    });

    /**
     * §73 auto-retired here, because deletion made "paused everywhere" awkward
     * to undo. A toggle removes that reason: the state is recoverable, visible,
     * and what the seller asked for.
     */
    it('pausing the last branch does NOT retire the service', async () => {
      const [only] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1200, 'Only here', [only]);

      const result = await services.setOfferedAtLocation(
        business.userId,
        service.id,
        only,
        false,
      );

      expect(result.service.isActive).toBe(true);
      expect(result.offeredAtCount).toBe(0);
      expect(result.message).toMatch(/last one/i);
      const row = await prisma.location.findUniqueOrThrow({ where: { id: only } });
      expect(row.fromPriceMinor).toBe(4500);
    });

    it('editing a service pauses the branches left out, never deletes them', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await services.create(business.userId, {
        name: 'Both branches',
        durationMinutes: 30,
        depositPercentage: 20,
        offers: [
          { locationId: first, priceMinor: 1000 },
          { locationId: second, priceMinor: 2000 },
        ],
      });

      await services.update(business.userId, service.id, {
        offers: [{ locationId: first, priceMinor: 1000 }],
      });

      const after = await prisma.serviceLocation.findMany({
        where: { serviceId: service.id },
      });
      expect(after).toHaveLength(2);
      const dropped = after.find((o) => o.locationId === second)!;
      expect(dropped.isOffered).toBe(false);
      // The price it was being sold at is still there to resume with.
      expect(dropped.priceMinor).toBe(2000);
    });

    it('404s on a branch with no price for that service', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1000, 'One branch', [first]);

      await expect(
        services.setOfferedAtLocation(business.userId, service.id, second, false),
      ).rejects.toThrow(/no price at that branch/);
    });

    it("404s on another business's service", async () => {
      const [mine] = await locationIdsOf(business.businessId);
      const theirs = await prisma.service.findFirstOrThrow({
        where: { businessId: other.businessId },
      });

      await expect(
        services.setOfferedAtLocation(business.userId, theirs.id, mine, false),
      ).rejects.toThrow();
    });
  });

  describe('turning a service off everywhere (§76)', () => {
    it('pauses every branch and keeps every price', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await services.create(business.userId, {
        name: 'Both branches',
        durationMinutes: 30,
        depositPercentage: 20,
        offers: [
          { locationId: first, priceMinor: 1000 },
          { locationId: second, priceMinor: 2000 },
        ],
      });

      const result = await services.setOfferedEverywhere(
        business.userId,
        service.id,
        false,
      );

      expect(result.offeredAtCount).toBe(0);
      // The service itself is untouched: "everywhere" is a statement about
      // branches, not a retirement (§76).
      expect(result.service.isActive).toBe(true);
      expect(result.service.locations.map((o) => o.priceMinor).sort()).toEqual([
        1000, 2000,
      ]);
    });

    /**
     * The incoherence this fixes: a service could be off sale while every
     * branch still reported itself on, so the screen offered to stop something
     * already stopped.
     */
    it('leaves no branch claiming to be on sale', async () => {
      const [only] = await locationIdsOf(business.businessId);
      const service = await newService(business, 1200, 'Everywhere off', [only]);

      await services.setOfferedEverywhere(business.userId, service.id, false);

      const offers = await prisma.serviceLocation.findMany({
        where: { serviceId: service.id },
      });
      expect(offers.every((o) => !o.isOffered)).toBe(true);
    });

    it('puts it back at every branch, at the prices it had', async () => {
      await addBranches(business, 1);
      const [first, second] = await locationIdsOf(business.businessId);
      const service = await services.create(business.userId, {
        name: 'Returning',
        durationMinutes: 30,
        depositPercentage: 20,
        offers: [
          { locationId: first, priceMinor: 1100 },
          { locationId: second, priceMinor: 2200 },
        ],
      });
      await services.setOfferedEverywhere(business.userId, service.id, false);

      const result = await services.setOfferedEverywhere(
        business.userId,
        service.id,
        true,
      );

      expect(result.offeredAtCount).toBe(2);
      const byLocation = new Map(
        result.service.locations.map((o) => [o.locationId, o.priceMinor]),
      );
      expect(byLocation.get(first)).toBe(1100);
      expect(byLocation.get(second)).toBe(2200);
    });

    it('clears every branch headline, then restores it', async () => {
      const [only] = await locationIdsOf(business.businessId);
      const service = await prisma.service.findFirstOrThrow({
        where: { businessId: business.businessId },
      });

      await services.setOfferedEverywhere(business.userId, service.id, false);
      let row = await prisma.location.findUniqueOrThrow({ where: { id: only } });
      expect(row.fromPriceMinor).toBeNull();

      await services.setOfferedEverywhere(business.userId, service.id, true);
      row = await prisma.location.findUniqueOrThrow({ where: { id: only } });
      expect(row.fromPriceMinor).toBe(4500);
    });

    it("404s on another business's service", async () => {
      const theirs = await prisma.service.findFirstOrThrow({
        where: { businessId: other.businessId },
      });

      await expect(
        services.setOfferedEverywhere(business.userId, theirs.id, false),
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
