import { BadRequestException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness } from './setup/factories';

/**
 * §265. A business can be more than one kind of place — a barbershop whose
 * other branch is a spa — and is found under every kind it lists. The first
 * is its main kind, mirrored on the profile.
 */
describe('Kinds of place a business is (§265)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let profiles: BusinessProfileService;
  let discovery: DiscoveryService;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessProfileService,
      DiscoveryService,
      FavouritesService,
      { provide: StorageService, useValue: {} },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    profiles = moduleRef.get(BusinessProfileService);
    discovery = moduleRef.get(DiscoveryService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  let n = 0;
  /** A category with one type in it. */
  const kind = async (options: { live?: boolean; categoryLive?: boolean } = {}) => {
    n += 1;
    const category = await prisma.category.create({ data: { name: `Kind ${n} ${Date.now()}`, isLive: options.categoryLive ?? true } });
    const type = await prisma.subcategory.create({ data: { name: `Type ${n}`, categoryId: category.id, isLive: options.live ?? true } });
    return { categoryId: category.id, subcategoryId: type.id };
  };

  const located = async () => {
    const shop = await createBusiness(prisma, { status: BusinessStatus.APPROVED });
    await prisma.location.update({ where: { id: shop.locationId }, data: { latitude: -1.95, longitude: 30.06 } });
    return shop;
  };

  it('keeps every kind in order, the first as the main one on the profile', async () => {
    const shop = await located();
    const barber = await kind();
    const spa = await kind();

    const profile = await profiles.setKinds(shop.businessId, [barber.subcategoryId, spa.subcategoryId]);

    expect(profile.category?.id).toBe(barber.categoryId);
    expect(profile.subcategory?.id).toBe(barber.subcategoryId);
    expect(profile.kinds.map((k) => k.subcategory.id)).toEqual([barber.subcategoryId, spa.subcategoryId]);
  });

  it('is found under each of its kinds, not only its main one', async () => {
    const shop = await located();
    const other = await located();
    const barber = await kind();
    const spa = await kind();
    await profiles.setKinds(shop.businessId, [barber.subcategoryId, spa.subcategoryId]);

    const byCategory = await discovery.search({ categoryId: spa.categoryId });
    const byType = await discovery.search({ subcategoryId: spa.subcategoryId });

    expect(byCategory.locations.map((l) => l.id)).toEqual([shop.locationId]);
    expect(byType.locations.map((l) => l.id)).toEqual([shop.locationId]);
    expect(byCategory.locations.map((l) => l.id)).not.toContain(other.locationId);
    expect(byCategory.locations[0].business.kinds.map((k) => k.category.id)).toEqual([barber.categoryId, spa.categoryId]);
  });

  it('replaces the whole list, so a kind can be dropped and the main one changed', async () => {
    const shop = await located();
    const a = await kind();
    const b = await kind();
    await profiles.setKinds(shop.businessId, [a.subcategoryId, b.subcategoryId]);

    const profile = await profiles.setKinds(shop.businessId, [b.subcategoryId]);

    expect(profile.subcategory?.id).toBe(b.subcategoryId);
    expect(profile.kinds.map((k) => k.subcategory.id)).toEqual([b.subcategoryId]);
    expect((await discovery.search({ categoryId: a.categoryId })).locations).toHaveLength(0);
  });

  it('allows at most four categories', async () => {
    const shop = await located();
    const five = await Promise.all([kind(), kind(), kind(), kind(), kind()]);

    await expect(profiles.setKinds(shop.businessId, five.map((k) => k.subcategoryId))).rejects.toThrow(BadRequestException);
    await expect(profiles.setKinds(shop.businessId, five.slice(0, 4).map((k) => k.subcategoryId))).resolves.toBeDefined();
  });

  it('refuses a newly chosen type that is not offered, but keeps one the business already had', async () => {
    const shop = await located();
    const held = await kind();
    await profiles.setKinds(shop.businessId, [held.subcategoryId]);
    await prisma.subcategory.update({ where: { id: held.subcategoryId }, data: { isLive: false } });
    const retiredCategory = await kind({ categoryLive: false });
    const fresh = await kind();

    await expect(profiles.setKinds(shop.businessId, [retiredCategory.subcategoryId])).rejects.toThrow('not offered any more');
    const profile = await profiles.setKinds(shop.businessId, [held.subcategoryId, fresh.subcategoryId]);
    expect(profile.kinds).toHaveLength(2);
  });

  it('follows a main kind changed through the profile, keeping the others', async () => {
    const shop = await located();
    const a = await kind();
    const b = await kind();
    const c = await kind();
    await profiles.setKinds(shop.businessId, [a.subcategoryId, b.subcategoryId]);

    const profile = await profiles.update(shop.businessId, { categoryId: c.categoryId, subcategoryId: c.subcategoryId });

    expect(profile.kinds.map((k) => k.subcategory.id)).toEqual([c.subcategoryId, b.subcategoryId]);
  });

  it('records the first kind chosen through the profile', async () => {
    const shop = await located();
    await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { categoryId: null, subcategoryId: null } });
    const a = await kind();

    const profile = await profiles.update(shop.businessId, { categoryId: a.categoryId, subcategoryId: a.subcategoryId });

    expect(profile.kinds.map((k) => k.subcategory.id)).toEqual([a.subcategoryId]);
  });
});
