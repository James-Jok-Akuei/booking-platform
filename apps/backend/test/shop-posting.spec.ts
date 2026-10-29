import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BusinessStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { AdminOverviewService } from '../src/analytics/admin-overview.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAdmin, createBusiness } from './setup/factories';
import { DocumentsService } from '../src/business/documents.service';

/**
 * §268. Approval says a shop MAY be listed; the shop posts itself when it is
 * ready, so a seller is never surprised by a first booking.
 */
describe('A shop posts itself for customers (§268)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let profiles: BusinessProfileService;
  let moderation: BusinessModerationService;
  let overview: AdminOverviewService;
  let discovery: DiscoveryService;
  let admin: { userId: string; email: string };

  const AS_ADMIN = () => ({ userId: admin.userId, role: UserRole.ADMIN });

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessProfileService,
      BusinessModerationService,
      DocumentsService,
      AdminOverviewService,
      DiscoveryService,
      FavouritesService,
      { provide: StorageService, useValue: {} },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    profiles = moduleRef.get(BusinessProfileService);
    moderation = moduleRef.get(BusinessModerationService);
    overview = moduleRef.get(AdminOverviewService);
    discovery = moduleRef.get(DiscoveryService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
  });

  /** A complete shop that has asked to be reviewed, with a pin so search can find it. */
  const asked = async (): Promise<TestBusiness> => {
    const shop = await createBusiness(prisma, { status: BusinessStatus.PENDING });
    await prisma.location.update({ where: { id: shop.locationId }, data: { latitude: -1.95, longitude: 30.06 } });
    return shop;
  };

  /** Approved by an administrator, and nothing more. */
  const approved = async () => {
    const shop = await asked();
    await moderation.approve(AS_ADMIN(), shop.businessId);
    return shop;
  };

  const inSearch = async (shop: TestBusiness) =>
    (await discovery.search({})).locations.some((l) => l.id === shop.locationId);

  it('keeps an approved shop out of the app until it posts itself', async () => {
    const shop = await approved();

    expect(await inSearch(shop)).toBe(false);
    await expect(discovery.findOne(shop.locationId)).rejects.toThrow(NotFoundException);
    const readiness = await profiles.readiness(shop.businessId);
    expect(readiness.publishedAt).toBeNull();
    expect(readiness.canPublish).toBe(true);
    expect((await overview.overview(AS_ADMIN())).totals.liveBusinesses).toBe(0);
  });

  it('puts it in the app once it posts', async () => {
    const shop = await approved();

    const readiness = await profiles.publish(shop.businessId);

    expect(readiness.publishedAt).not.toBeNull();
    expect(readiness.canPublish).toBe(false);
    expect(await inSearch(shop)).toBe(true);
    await expect(discovery.findOne(shop.locationId)).resolves.toBeDefined();
    expect((await overview.overview(AS_ADMIN())).totals.liveBusinesses).toBe(1);
  });

  it('refuses before approval, when suspended, and a second time', async () => {
    const waiting = await asked();
    await expect(profiles.publish(waiting.businessId)).rejects.toThrow(/not been approved/);

    const suspended = await createBusiness(prisma, { status: BusinessStatus.SUSPENDED });
    await expect(profiles.publish(suspended.businessId)).rejects.toThrow(BadRequestException);

    const shop = await approved();
    await profiles.publish(shop.businessId);
    await expect(profiles.publish(shop.businessId)).rejects.toThrow(ConflictException);
  });

  it('refuses a shop that lost what approval needed, rather than post an empty listing', async () => {
    const shop = await approved();
    await prisma.service.update({ where: { id: shop.serviceId }, data: { isActive: false } });

    await expect(profiles.publish(shop.businessId)).rejects.toThrow(/cannot be posted yet: it still needs/);
    expect((await profiles.readiness(shop.businessId)).canPublish).toBe(false);
  });

  it('lifts a pause set before posting — posting means show it', async () => {
    const shop = await approved();
    await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { pausedAt: new Date() } });

    await profiles.publish(shop.businessId);

    expect(await inSearch(shop)).toBe(true);
  });

  it('brings a reinstated shop back as it was, without posting again', async () => {
    const shop = await approved();
    await profiles.publish(shop.businessId);
    await moderation.suspend(AS_ADMIN(), shop.businessId, 'Checking a complaint.');
    expect(await inSearch(shop)).toBe(false);

    await moderation.reinstate(AS_ADMIN(), shop.businessId);

    expect(await inSearch(shop)).toBe(true);
  });
});
