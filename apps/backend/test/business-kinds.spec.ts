import { BadRequestException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness, createAdmin } from './setup/factories';
import { AdminCategoriesController } from '../src/categories/admin-categories.controller';
import { TaxonomyNamesService } from '../src/categories/taxonomy-names.service';
import { NotificationsService } from '../src/notifications/notifications.service';

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
  let notifications: { notify: jest.Mock };

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
    notifications = moduleRef.get(NotificationsService) as never;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    notifications.notify.mockClear();
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

  // ---------------------------------------------------------------------
  describe('writing in a kind under "Other" (§267)', () => {
    /** A category with a named type and its "Other". */
    const withOther = async () => {
      n += 1;
      const category = await prisma.category.create({ data: { name: `Beauty ${n} ${Date.now()}` } });
      const named = await prisma.subcategory.create({ data: { name: 'Nails', categoryId: category.id } });
      const other = await prisma.subcategory.create({ data: { name: 'Other', categoryId: category.id } });
      return { categoryId: category.id, named: named.id, other: other.id };
    };

    it('keeps what the shop wrote, tidied, and shows it with the kind', async () => {
      const shop = await located();
      const c = await withOther();

      const profile = await profiles.setKinds(shop.businessId, [c.other], [{ subcategoryId: c.other, label: '  Henna   artist ' }]);

      expect(profile.kinds[0].otherLabel).toBe('Henna artist');
      const found = await discovery.search({ categoryId: c.categoryId });
      expect(found.locations[0].business.kinds[0].otherLabel).toBe('Henna artist');
    });

    it('refuses a write-in for a type that already has a name', async () => {
      const shop = await located();
      const c = await withOther();

      await expect(
        profiles.setKinds(shop.businessId, [c.named], [{ subcategoryId: c.named, label: 'Gel only' }]),
      ).rejects.toThrow('already named');
    });

    it('is found by what it wrote, and by the name of its type', async () => {
      const shop = await located();
      await located();
      const c = await withOther();
      await profiles.setKinds(shop.businessId, [c.other, c.named], [{ subcategoryId: c.other, label: 'Henna artist' }]);

      expect((await discovery.search({ q: 'henna' })).locations.map((l) => l.id)).toEqual([shop.locationId]);
      expect((await discovery.search({ q: 'nails' })).locations.map((l) => l.id)).toEqual([shop.locationId]);
    });

    it('tells administrators when a LIVE shop writes in or changes one, not a shop still setting up', async () => {
      await createAdmin(prisma);
      const live = await located();
      const pending = await createBusiness(prisma, { status: BusinessStatus.PENDING });
      const c = await withOther();

      await profiles.setKinds(pending.businessId, [c.other], [{ subcategoryId: c.other, label: 'Henna artist' }]);
      expect(notifications.notify).not.toHaveBeenCalled();

      await profiles.setKinds(live.businessId, [c.other], [{ subcategoryId: c.other, label: 'Henna artist' }]);
      await profiles.setKinds(live.businessId, [c.other], [{ subcategoryId: c.other, label: 'Henna artist' }]);
      await profiles.setKinds(live.businessId, [c.other], [{ subcategoryId: c.other, label: 'Henna and mehndi' }]);
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });

    it('gathers write-ins for the console, case aside, and makes one a type with its shops moved in', async () => {
      const a = await located();
      const b = await located();
      const c = await withOther();
      await profiles.setKinds(a.businessId, [c.other], [{ subcategoryId: c.other, label: 'Henna artist' }]);
      await profiles.setKinds(b.businessId, [c.named, c.other], [{ subcategoryId: c.other, label: 'henna ARTIST' }]);
      const admin = new AdminCategoriesController(prisma, new TaxonomyNamesService(prisma));

      const writeIns = await admin.writeIns();
      expect(writeIns).toHaveLength(1);
      expect(writeIns[0].count).toBe(2);

      const promoted = await admin.promoteWriteIn(c.categoryId, { label: 'Henna Artist', name: 'Henna' });
      expect(promoted.moved).toBe(2);

      const aNow = await profiles.findOwn(a.businessId);
      const bNow = await profiles.findOwn(b.businessId);
      expect(aNow.subcategory?.name).toBe('Henna');
      expect(aNow.kinds.map((k) => [k.subcategory.name, k.otherLabel])).toEqual([['Henna', null]]);
      expect(bNow.kinds.map((k) => k.subcategory.name)).toEqual(['Nails', 'Henna']);
      expect(await admin.writeIns()).toHaveLength(0);
    });
  });
});
