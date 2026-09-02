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
 * Location.fromPriceCents is a denormalised aggregate (§44), and the only way
 * it can be wrong is if a write path forgets to maintain it. Every test here
 * drives a REAL service or location write and then reads the column back.
 */
describe('Denormalised fromPriceCents (§44)', () => {
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
      priceCents: 4500,
    });
    other = await createBusiness(prisma, {
      status: BusinessStatus.APPROVED,
      priceCents: 8000,
    });
  });

  /** Every location of a business, with its denormalised price. */
  const pricesOf = async (businessId: string) =>
    (
      await prisma.location.findMany({
        where: { businessId },
        orderBy: { name: 'asc' },
        select: { fromPriceCents: true },
      })
    ).map((l) => l.fromPriceCents);

  /** Adds a second and third branch, so "all locations" means something. */
  const addBranches = async (target: TestBusiness, count = 2) => {
    for (let i = 0; i < count; i++) {
      await prisma.location.create({
        data: {
          businessId: target.businessId,
          name: `Branch ${i}`,
          address: 'Somewhere in Juba',
          latitude: 4.85,
          longitude: 31.58,
          fromPriceCents: 4500,
        },
      });
    }
  };

  const newService = (target: TestBusiness, priceCents: number, name = 'Extra') =>
    services.create(target.userId, {
      name,
      priceCents,
      durationMinutes: 30,
      depositPercentage: 20,
    });

  it('the factory leaves a correct starting value', async () => {
    expect(await pricesOf(business.businessId)).toEqual([4500]);
  });

  describe('a service write updates EVERY location of that business', () => {
    it('creating a cheaper service lowers all of them', async () => {
      await addBranches(business);

      await newService(business, 1200);

      // Services are business-scoped, so all three branches move together.
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

      await services.update(business.userId, cheap.id, { priceCents: 800 });

      expect(await pricesOf(business.businessId)).toEqual([800, 800, 800]);
    });

    it('repricing upwards hands the headline to the next cheapest', async () => {
      await addBranches(business);
      const cheap = await newService(business, 1200);

      await services.update(business.userId, cheap.id, { priceCents: 6000 });

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

  describe('a new location inherits the existing catalogue', () => {
    it('opens with the business cheapest price already set', async () => {
      await newService(business, 1500);

      const created = await locations.create(business.userId, {
        name: 'Brand new branch',
        address: 'Ministries Road',
        latitude: 4.85,
        longitude: 31.58,
      });

      // Not a blank that fills in when someone next edits a service.
      const row = await prisma.location.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.fromPriceCents).toBe(1500);
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
      expect(row.fromPriceCents).toBeNull();
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
