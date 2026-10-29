import { BadRequestException, ConflictException } from '@nestjs/common';
import { BusinessStatus, NotificationType, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { AdminOverviewService } from '../src/analytics/admin-overview.service';
import { StorageService } from '../src/storage/storage.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAdmin, createBusiness } from './setup/factories';
import { DocumentsService } from '../src/business/documents.service';

/**
 * §255. A shop gets ready, sends itself for review, and — after a rejection —
 * fixes things and sends itself back. Approval needs a shop a customer could
 * actually book.
 */
describe('Shop onboarding and review (§255)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let profiles: BusinessProfileService;
  let moderation: BusinessModerationService;
  let overview: AdminOverviewService;
  let notifications: { notify: jest.Mock };
  let admin: { userId: string; email: string };

  const AS_ADMIN = () => ({ userId: admin.userId, role: UserRole.ADMIN });

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessProfileService,
      BusinessModerationService,
      DocumentsService,
      AdminOverviewService,
      // Nothing is uploaded here; the papers view only asks whether it could be (§314).
      { provide: StorageService, useValue: { privateStorageReady: () => true } },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    profiles = moduleRef.get(BusinessProfileService);
    moderation = moduleRef.get(BusinessModerationService);
    overview = moduleRef.get(AdminOverviewService);
    notifications = moduleRef.get(NotificationsService) as never;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    notifications.notify.mockClear();
    admin = await createAdmin(prisma);
  });

  /** What signing up creates: an empty shop, waiting for nothing yet. */
  const freshSignup = () =>
    prisma.businessProfile.create({ data: { countryCode: 'RW' } }).then((b) => b.id);

  /** A shop with everything the wizard asks for, not yet sent. */
  const readyShop = async (): Promise<TestBusiness> => {
    const shop = await createBusiness(prisma, { status: BusinessStatus.PENDING });
    const category = await prisma.category.create({ data: { name: `Beauty ${Date.now()}` } });
    const type = await prisma.subcategory.create({ data: { name: 'Barbershop', categoryId: category.id } });
    const district = await prisma.district.findFirstOrThrow();
    await prisma.businessProfile.update({
      where: { id: shop.businessId },
      data: { phone: '+250788100200', categoryId: category.id, subcategoryId: type.id, submittedAt: null },
    });
    await prisma.location.update({
      where: { id: shop.locationId },
      data: { districtId: district.id, latitude: -1.95, longitude: 30.06 },
    });
    return shop;
  };

  const keysOf = (items: Array<{ key: string; done: boolean; required: boolean }>, done: boolean) =>
    items.filter((i) => i.required && i.done === done).map((i) => i.key);

  it('starts a fresh sign-up with every required item still to do', async () => {
    const id = await freshSignup();
    const view = await profiles.readiness(id);

    expect(keysOf(view.items, false)).toEqual(['name', 'type', 'phone', 'branch', 'hours', 'service']);
    // Papers are optional for a shop that is not a licensed trade (§314).
    expect(view.items.filter((i) => !i.required).map((i) => i.key)).toEqual(['papers', 'logo', 'payout']);
    expect(view.ready).toBe(false);
    expect(view.canSubmit).toBe(false);
    expect(view.submittedAt).toBeNull();
  });

  it('refuses to send an unready shop, naming what is missing', async () => {
    const id = await freshSignup();
    await prisma.businessProfile.update({ where: { id }, data: { name: 'Half Done' } });

    await expect(profiles.submitForReview(id)).rejects.toThrow(/what kind of shop it is, a phone number/);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('counts a branch only once customers can find it: a pin and a district', async () => {
    const shop = await readyShop();
    await prisma.location.update({ where: { id: shop.locationId }, data: { districtId: null } });

    const view = await profiles.readiness(shop.businessId);
    expect(keysOf(view.items, false)).toEqual(['branch']);
  });

  it('sends a ready shop for review and tells every administrator', async () => {
    const shop = await readyShop();
    await createAdmin(prisma);

    const view = await profiles.submitForReview(shop.businessId);

    expect(view.submittedAt).not.toBeNull();
    expect(view.status).toBe(BusinessStatus.PENDING);
    expect(view.canSubmit).toBe(false);
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    const call = notifications.notify.mock.calls[0][0];
    expect(call.type).toBe(NotificationType.BUSINESS_SUBMITTED);
    expect(call.context.reason).toMatch(/ready for review/);

    await expect(profiles.submitForReview(shop.businessId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets a rejected shop fix things and send itself back, keeping what it was told', async () => {
    const shop = await readyShop();
    await profiles.submitForReview(shop.businessId);
    await moderation.reject(AS_ADMIN(), shop.businessId, 'Add a real phone number.');

    const rejected = await profiles.readiness(shop.businessId);
    expect(rejected.status).toBe(BusinessStatus.REJECTED);
    expect(rejected.lastRejectionReason).toBe('Add a real phone number.');
    expect(rejected.canSubmit).toBe(true);

    notifications.notify.mockClear();
    const back = await profiles.submitForReview(shop.businessId);

    expect(back.status).toBe(BusinessStatus.PENDING);
    expect(back.statusReason).toBeNull();
    expect(back.lastRejectionReason).toBe('Add a real phone number.');
    expect(notifications.notify.mock.calls[0][0].context.reason).toMatch(/sent itself back/);
  });

  it('refuses a live shop and a suspended one', async () => {
    const live = await createBusiness(prisma);
    await expect(profiles.submitForReview(live.businessId)).rejects.toThrow(/already live/);

    const suspended = await createBusiness(prisma, { status: BusinessStatus.SUSPENDED });
    await expect(profiles.submitForReview(suspended.businessId)).rejects.toThrow(/support ticket/);
  });

  describe('approval needs a shop a customer could book', () => {
    it('refuses a shop with nothing to book, and says what it needs', async () => {
      const shop = await readyShop();
      await prisma.service.update({ where: { id: shop.serviceId }, data: { isActive: false } });

      await expect(moderation.approve(AS_ADMIN(), shop.businessId)).rejects.toThrow(
        /still needs a service offered at an open branch/,
      );
    });

    it('refuses a shop whose only branch has no opening hours', async () => {
      const shop = await readyShop();
      await prisma.locationHours.updateMany({ where: { locationId: shop.locationId }, data: { isClosed: true } });

      await expect(moderation.approve(AS_ADMIN(), shop.businessId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('approves once it can be booked, even without its phone', async () => {
      const shop = await readyShop();
      await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { phone: null } });

      const result = await moderation.approve(AS_ADMIN(), shop.businessId);
      expect(result.status).toBe(BusinessStatus.APPROVED);
    });

    it('shows the administrator the same checklist the shop sees', async () => {
      const shop = await readyShop();
      const detail = await moderation.findOne(AS_ADMIN(), shop.businessId);

      expect(detail.readiness.ready).toBe(true);
      expect(detail.readiness.goLiveGaps).toEqual([]);
    });
  });

  describe("the administrators' queue", () => {
    it('holds the shops that asked, not the ones still setting up', async () => {
      const asked = await readyShop();
      await profiles.submitForReview(asked.businessId);
      await readyShop();
      await freshSignup();

      const waiting = await moderation.list(AS_ADMIN(), { status: BusinessStatus.PENDING, submitted: 'true' });
      expect(waiting.businesses.map((b) => b.id)).toEqual([asked.businessId]);

      const settingUp = await moderation.list(AS_ADMIN(), { status: BusinessStatus.PENDING, submitted: 'false' });
      expect(settingUp.total).toBe(2);

      const counts = await overview.overview(AS_ADMIN());
      expect(counts.waiting.businesses.count).toBe(1);
    });
  });
});
