import { BusinessStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { FavouritesService } from '../src/favourites/favourites.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness, createCustomer } from './setup/factories';

/**
 * Saving a place to come back to (§120).
 *
 * Deliberately NOT a cart, which is what this started as: nothing here is
 * reserved, priced or paid for. A slot is held by booking it, and holding one by
 * putting it in a basket would take it away from somebody who was ready to book.
 */
describe('Saved places (§120)', () => {
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
    await prisma.favourite.deleteMany({});
    shop = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  it('saving twice is the same as saving once', async () => {
    await favourites.add(customer.userId, shop.locationId);
    await favourites.add(customer.userId, shop.locationId);

    // The unique index is what makes this true under a double tap; a
    // read-then-write would let both requests through.
    const { total } = await favourites.list(customer.userId);
    expect(total).toBe(1);
  });

  it('removing one that was never saved is not an error', async () => {
    // The end state is what was asked for either way, and a client that lost a
    // response should be able to repeat itself.
    await expect(
      favourites.remove(customer.userId, shop.locationId),
    ).resolves.toEqual({ locationId: shop.locationId, saved: false });
  });

  it('refuses to save a branch that is not public', async () => {
    const hidden = await createBusiness(prisma, { status: BusinessStatus.PENDING });

    // 404, not 403: a business that is not public does not exist to a customer,
    // and saying "that one is pending" leaks a moderation state.
    await expect(
      favourites.add(customer.userId, hidden.locationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a saved place that stops being bookable, and says so', async () => {
    await favourites.add(customer.userId, shop.locationId);
    await prisma.businessProfile.update({
      where: { id: shop.businessId },
      data: { pausedAt: new Date() },
    });

    const { favourites: rows } = await favourites.list(customer.userId);

    // Hidden, a customer would conclude the app lost their barber. Marked, the
    // answer is useful and it comes back on its own when the shop reopens.
    expect(rows).toHaveLength(1);
    expect(rows[0].bookable).toBe(false);
  });

  it('is nobody else’s list', async () => {
    const stranger = await createCustomer(prisma);
    await favourites.add(customer.userId, shop.locationId);

    expect((await favourites.list(stranger.userId)).total).toBe(0);
  });

  describe('on a search result', () => {
    it('says saved or not for whoever is asking', async () => {
      await favourites.add(customer.userId, shop.locationId);

      const mine = await discovery.search({}, customer.userId);
      expect(mine.locations.find((l) => l.id === shop.locationId)).toHaveProperty(
        'saved',
        true,
      );

      const theirs = await discovery.search(
        {},
        (await createCustomer(prisma)).userId,
      );
      expect(theirs.locations.find((l) => l.id === shop.locationId)).toHaveProperty(
        'saved',
        false,
      );
    });

    it('says nothing at all when nobody is signed in', async () => {
      await favourites.add(customer.userId, shop.locationId);

      const anonymous = await discovery.search({});

      // Absent, not false: there is no answer to "have you saved this" without a
      // "you", and false would render an empty heart that cannot be filled.
      expect(anonymous.locations[0]).not.toHaveProperty('saved');
    });

    it('marks the shop page too', async () => {
      await favourites.add(customer.userId, shop.locationId);

      const page = await discovery.findOne(shop.locationId, customer.userId);
      expect(page).toHaveProperty('saved', true);
      expect(await discovery.findOne(shop.locationId)).not.toHaveProperty('saved');
    });
  });
});
