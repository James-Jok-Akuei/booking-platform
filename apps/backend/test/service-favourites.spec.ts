import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { FavouritesService } from '../src/favourites/favourites.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness, createCustomer } from './setup/factories';

/**
 * Saved services (§158).
 *
 * What is protected: a saved service is the service AT a branch; a service
 * that is only paused stays on the list and says so; a service that is gone
 * for good leaves the list cleanly and the customer is told once.
 */
describe('Saved services (§158)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let favourites: FavouritesService;
  let discovery: DiscoveryService;
  let shop: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      FavouritesService,
      DiscoveryService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    favourites = moduleRef.get(FavouritesService);
    discovery = moduleRef.get(DiscoveryService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.serviceFavourite.deleteMany({});
    shop = await createBusiness(prisma, { status: BusinessStatus.APPROVED });
    customer = await createCustomer(prisma);
  });

  const save = () => favourites.addService(customer.userId, shop.serviceId, shop.locationId);

  it('saves a service at a branch, lists it as the card the home screen shows, and removes it', async () => {
    expect(await save()).toEqual({ serviceId: shop.serviceId, locationId: shop.locationId, saved: true });
    // Twice is once.
    await save();

    const page = await favourites.listServices(customer.userId);
    expect(page.total).toBe(1);
    expect(page.removed).toBe(0);
    expect(page.services[0]).toMatchObject({
      id: shop.serviceId,
      location: { id: shop.locationId },
      saved: true,
      bookable: true,
    });
    expect(page.services[0].priceMinor).toBeGreaterThan(0);

    await favourites.removeService(customer.userId, shop.serviceId, shop.locationId);
    expect((await favourites.listServices(customer.userId)).total).toBe(0);
  });

  it('refuses a service the customer could not book', async () => {
    await prisma.service.update({ where: { id: shop.serviceId }, data: { isActive: false } });
    await expect(save()).rejects.toThrow(/not found/);
  });

  it('keeps a paused service and says it is not bookable', async () => {
    await save();
    await prisma.serviceLocation.update({
      where: { serviceId_locationId: { serviceId: shop.serviceId, locationId: shop.locationId } },
      data: { isOffered: false },
    });

    const page = await favourites.listServices(customer.userId);
    expect(page.total).toBe(1);
    expect(page.services[0].bookable).toBe(false);
  });

  it('drops a retired service cleanly, and says so once', async () => {
    await save();
    await prisma.service.update({ where: { id: shop.serviceId }, data: { isActive: false } });

    const first = await favourites.listServices(customer.userId);
    expect(first.total).toBe(0);
    expect(first.removed).toBe(1);

    const second = await favourites.listServices(customer.userId);
    expect(second.removed).toBe(0);
    expect(await prisma.serviceFavourite.count({ where: { customerId: customer.userId } })).toBe(0);
  });

  it('marks the saved one on the home search and on the shop page, for its owner only', async () => {
    await save();

    const mine = await discovery.searchServices({}, customer.userId);
    const card = mine.services.find((s) => s.id === shop.serviceId && s.location.id === shop.locationId);
    expect(card?.saved).toBe(true);

    const other = await createCustomer(prisma);
    const theirs = await discovery.searchServices({}, other.userId);
    expect(theirs.services.find((s) => s.id === shop.serviceId)?.saved).toBe(false);

    const anonymous = await discovery.searchServices({});
    expect(anonymous.services.find((s) => s.id === shop.serviceId)).not.toHaveProperty('saved');

    const page = await discovery.findOne(shop.locationId, customer.userId);
    expect(page.services.find((s) => s.id === shop.serviceId)?.saved).toBe(true);
  });
});
