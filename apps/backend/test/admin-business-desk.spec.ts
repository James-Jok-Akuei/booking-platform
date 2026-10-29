import { TestingModule } from '@nestjs/testing';
import { BusinessStatus, UserRole } from '@prisma/client';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { asUser, createAdmin, createBusiness } from './setup/factories';
import { DocumentsService } from '../src/business/documents.service';

/**
 * The approval desk (§244): finding a business by a word, and the detail a
 * reviewer decides on — the pin, the district, photos, the payout number.
 */
describe('The approval desk (§244)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let moderation: BusinessModerationService;
  let admin: ReturnType<typeof asUser>;

  beforeAll(async () => {
    moduleRef = await createTestModule([BusinessModerationService, DocumentsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    moderation = moduleRef.get(BusinessModerationService);
    await resetDatabase(prisma);
    const a = await createAdmin(prisma);
    admin = asUser(a.userId, UserRole.ADMIN);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  it('finds a business by part of its name, any case, or its phone', async () => {
    const barber = await createBusiness(prisma, { status: BusinessStatus.PENDING });
    await prisma.businessProfile.update({ where: { id: barber.businessId }, data: { name: 'Kimironko Barbers', phone: '+250788111222' } });
    await createBusiness(prisma, { status: BusinessStatus.PENDING });

    const byName = await moderation.list(admin, { q: 'kimironko' });
    expect(byName.businesses.map((b) => b.id)).toEqual([barber.businessId]);
    expect(byName.total).toBe(1);

    const byPhone = await moderation.list(admin, { q: '111222' });
    expect(byPhone.businesses.map((b) => b.id)).toEqual([barber.businessId]);

    // Combined with a status, and nothing found is an empty page, not an error.
    expect((await moderation.list(admin, { q: 'kimironko', status: BusinessStatus.APPROVED })).total).toBe(0);
  });

  it('finds a business by a member’s email', async () => {
    const shop = await createBusiness(prisma);
    const found = await moderation.list(admin, { q: shop.email.toUpperCase() });
    expect(found.businesses.map((b) => b.id)).toContain(shop.businessId);
  });

  it('gives a reviewer the pin, the district, the photos and the payout number', async () => {
    const shop = await createBusiness(prisma, { payoutDestination: 'UNVERIFIED' });
    await prisma.location.update({ where: { id: shop.locationId }, data: { latitude: -1.95, longitude: 30.09 } });
    await prisma.locationMedia.create({ data: { locationId: shop.locationId, url: 'https://example.com/a.jpg' } });

    const detail = await moderation.findOne(admin, shop.businessId);
    const branch = detail.locations[0];
    expect(branch).toMatchObject({ latitude: -1.95, longitude: 30.09, isActive: true });
    expect(branch.media.map((m) => m.url)).toEqual(['https://example.com/a.jpg']);
    expect(detail.payoutDestinations).toHaveLength(1);
    expect(detail.payoutDestinations[0].status).toBe('UNVERIFIED');
    expect(detail.services[0]).toHaveProperty('images');
  });
});
