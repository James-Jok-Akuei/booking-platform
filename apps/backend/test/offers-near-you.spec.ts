import { jest } from '@jest/globals';
import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { MailService } from '../src/mail/mail.service';
import { OffersService, formatMoney } from '../src/offers/offers.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoutingService, straightLineKm } from '../src/routing/routing.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness, createCustomer } from './setup/factories';

/**
 * Emails about services near a customer (§140).
 *
 * The thing protected here is who is written to. Marketing email to somebody
 * who did not ask is the mistake that cannot be taken back, so most of these
 * are about the people who must NOT receive one.
 */
describe('Offers near you (§140)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let offers: OffersService;
  const sendOffersDigest = jest.fn<MailService['sendOffersDigest']>();

  let gasabo: { id: string; provinceId: string };
  let musanze: { id: string; provinceId: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      OffersService,
      DiscoveryService,
      FavouritesService,
      { provide: MailService, useValue: { sendOffersDigest } },
      // Road distances answered as the straight line, the way the real one
      // answers when the routing service is down — no network in tests.
      {
        provide: RoutingService,
        useValue: {
          fromPoint: async (from: { lat: number; lng: number }, to: Array<{ lat: number; lng: number }>) =>
            to.map((t) => ({ distanceKm: Math.round(straightLineKm(from, t) * 100) / 100, by: 'road' as const })),
        },
      },
    ]);
    prisma = moduleRef.get(PrismaService);
    offers = moduleRef.get(OffersService);
    await resetDatabase(prisma);
    gasabo = await prisma.district.findFirstOrThrow({ where: { name: 'Gasabo' } });
    musanze = await prisma.district.findFirstOrThrow({ where: { name: 'Musanze' } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    sendOffersDigest.mockReset();
    sendOffersDigest.mockResolvedValue(undefined);
    await prisma.appointment.deleteMany({});
    await prisma.location.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  /** An approved shop with one service, in a district. */
  const shopIn = async (districtId: string, name: string) => {
    const business = await createBusiness(prisma, { status: BusinessStatus.APPROVED });
    await prisma.location.update({ where: { id: business.locationId }, data: { districtId } });
    await prisma.service.update({ where: { id: business.serviceId }, data: { name } });
    return business;
  };

  const customerIn = async (districtId: string | null, optIn = true) => {
    const customer = await createCustomer(prisma);
    if (districtId) {
      await offers.update(customer.userId, { optedIn: optIn, districtId });
    }
    return customer;
  };

  const sentTo = () => sendOffersDigest.mock.calls.map(([email]) => email);

  describe('the choice', () => {
    it('is off for everyone until they turn it on', async () => {
      const customer = await createCustomer(prisma);
      expect(await offers.preference(customer.userId)).toEqual({
        optedIn: false,
        optedInAt: null,
        district: null,
        spot: null,
      });
    });

    it('cannot be turned on without a district', async () => {
      const customer = await createCustomer(prisma);
      await expect(offers.update(customer.userId, { optedIn: true })).rejects.toThrow(
        /Choose your district or use your exact location first/,
      );
    });

    it('records when they agreed, and keeps the district when they leave', async () => {
      const customer = await createCustomer(prisma);

      const on = await offers.update(customer.userId, { optedIn: true, districtId: gasabo.id });
      expect(on.optedIn).toBe(true);
      expect(on.optedInAt).not.toBeNull();
      expect(on.district?.name).toBe('Gasabo');

      const off = await offers.update(customer.userId, { optedIn: false });
      expect(off.optedIn).toBe(false);
      expect(off.optedInAt).toBeNull();
      // So coming back is one tap, not a form.
      expect(off.district?.name).toBe('Gasabo');
    });

    it('refuses a district that is not on the list', async () => {
      const customer = await createCustomer(prisma);
      const retired = await prisma.district.findFirst({ where: { isLive: false } });
      if (!retired) return;
      await expect(
        offers.update(customer.userId, { optedIn: true, districtId: retired.id }),
      ).rejects.toThrow(/from the list/);
    });
  });

  describe('who is written to', () => {
    it('writes to someone who asked, about their own district', async () => {
      await shopIn(gasabo.id, 'Gasabo cut');
      await shopIn(gasabo.id, 'Gasabo shave');
      await shopIn(gasabo.id, 'Gasabo braid');
      await shopIn(musanze.id, 'Musanze cut');
      const customer = await customerIn(gasabo.id);

      const result = await offers.sendDue();

      expect(result).toEqual({ sent: 1, skipped: 0 });
      expect(sentTo()).toEqual([customer.email]);
      const digest = sendOffersDigest.mock.calls[0][1];
      expect(digest.place).toBe('Gasabo');
      expect(digest.services.map((s) => s.name).sort()).toEqual([
        'Gasabo braid',
        'Gasabo cut',
        'Gasabo shave',
      ]);
      expect(digest.unsubscribeUrl).toMatch(/\/offers\/unsubscribe\/.+/);
    });

    it('never writes to someone who did not ask', async () => {
      await shopIn(gasabo.id, 'A');
      await shopIn(gasabo.id, 'B');
      await shopIn(gasabo.id, 'C');
      await createCustomer(prisma); // never touched the setting
      await customerIn(gasabo.id, false); // chose a district, said no

      expect(await offers.sendDue()).toEqual({ sent: 0, skipped: 0 });
      expect(sendOffersDigest).not.toHaveBeenCalled();
    });

    it('never writes to someone who opted out again', async () => {
      await shopIn(gasabo.id, 'A');
      const customer = await customerIn(gasabo.id);
      await offers.update(customer.userId, { optedIn: false });

      await offers.sendDue();
      expect(sendOffersDigest).not.toHaveBeenCalled();
    });

    it('never writes to a closed account', async () => {
      await shopIn(gasabo.id, 'A');
      const customer = await customerIn(gasabo.id);
      await prisma.user.update({ where: { id: customer.userId }, data: { closedAt: new Date() } });

      await offers.sendDue();
      expect(sendOffersDigest).not.toHaveBeenCalled();
    });

    it('does not write twice in a week, and does again after it', async () => {
      await shopIn(gasabo.id, 'A');
      await customerIn(gasabo.id);
      const monday = new Date('2026-10-05T07:00:00Z');

      await offers.sendDue(monday);
      await offers.sendDue(new Date(monday.getTime() + 2 * 86_400_000));
      expect(sendOffersDigest).toHaveBeenCalledTimes(1);

      await offers.sendDue(new Date(monday.getTime() + 7 * 86_400_000));
      expect(sendOffersDigest).toHaveBeenCalledTimes(2);
    });

    it('sends nothing where there is nothing to show, and tries again next time', async () => {
      const customer = await customerIn(musanze.id);

      expect(await offers.sendDue()).toEqual({ sent: 0, skipped: 1 });
      expect(sendOffersDigest).not.toHaveBeenCalled();

      // A shop opens there; nobody was marked as already written to.
      await shopIn(musanze.id, 'First in Musanze');
      await offers.sendDue();
      expect(sentTo()).toEqual([customer.email]);
    });

    it('looks at the whole province when the district has too few', async () => {
      const kicukiro = await prisma.district.findFirstOrThrow({ where: { name: 'Kicukiro' } });
      await shopIn(gasabo.id, 'Gasabo one');
      await shopIn(kicukiro.id, 'Kicukiro one');
      await customerIn(gasabo.id);

      await offers.sendDue();

      const digest = sendOffersDigest.mock.calls[0][1];
      expect(digest.place).toBe('Kigali');
      expect(digest.services.map((s) => s.name).sort()).toEqual(['Gasabo one', 'Kicukiro one']);
    });

    it('never shows a shop the public search hides', async () => {
      await shopIn(gasabo.id, 'Open');
      const hidden = await shopIn(gasabo.id, 'Suspended');
      await prisma.businessProfile.update({
        where: { id: hidden.businessId },
        data: { status: BusinessStatus.SUSPENDED },
      });
      await customerIn(gasabo.id);

      await offers.sendDue();
      expect(sendOffersDigest.mock.calls[0][1].services.map((s) => s.name)).toEqual(['Open']);
    });

    it('a failed send is not counted as sent, so it is tried again', async () => {
      await shopIn(gasabo.id, 'A');
      const customer = await customerIn(gasabo.id);
      sendOffersDigest.mockRejectedValueOnce(new Error('smtp down'));

      expect(await offers.sendDue()).toEqual({ sent: 0, skipped: 1 });
      expect(await offers.sendDue()).toEqual({ sent: 1, skipped: 0 });
      expect(sentTo()).toEqual([customer.email, customer.email]);
    });
  });

  describe('an exact spot (§169)', () => {
    // Kimironko, and two shops: one a short drive away, one in Musanze.
    const kimironko = { latitude: -1.9497, longitude: 30.1259 };
    const pinned = async (districtId: string, name: string, lat: number, lng: number) => {
      const business = await shopIn(districtId, name);
      await prisma.location.update({
        where: { id: business.locationId },
        data: { latitude: lat, longitude: lng },
      });
      return business;
    };

    it('can be turned on with a spot alone, and the spot is shown back', async () => {
      const customer = await createCustomer(prisma);
      const on = await offers.update(customer.userId, {
        optedIn: true,
        spot: { ...kimironko, label: 'KG 11 Ave, Kimironko' },
      });
      expect(on.optedIn).toBe(true);
      expect(on.district).toBeNull();
      expect(on.spot).toEqual({ ...kimironko, label: 'KG 11 Ave, Kimironko' });

      const cleared = await offers.update(customer.userId, { optedIn: false, spot: null });
      expect(cleared.spot).toBeNull();
    });

    it('picks what is near the spot, with how far, and leaves out what is far', async () => {
      await pinned(gasabo.id, 'Round the corner', -1.9480, 30.1270);
      await pinned(gasabo.id, 'Down the road', -1.9550, 30.1100);
      await pinned(gasabo.id, 'Across Remera', -1.9590, 30.1050);
      await pinned(musanze.id, 'Far away in Musanze', -1.4990, 29.6340);
      const customer = await createCustomer(prisma);
      await offers.update(customer.userId, { optedIn: true, spot: { ...kimironko, label: 'Kimironko' } });

      await offers.sendDue();

      const digest = sendOffersDigest.mock.calls[0][1];
      expect(digest.nearSpot).toBe(true);
      expect(digest.place).toBe('Kimironko');
      expect(digest.services.map((s) => s.name)).not.toContain('Far away in Musanze');
      expect(digest.services).toHaveLength(3);
      for (const service of digest.services) expect(service.away).toMatch(/(m|km) by road$/);
    });

    it('falls back to the district when nothing is near the spot', async () => {
      await shopIn(musanze.id, 'A');
      await shopIn(musanze.id, 'B');
      await shopIn(musanze.id, 'C');
      const customer = await createCustomer(prisma);
      await offers.update(customer.userId, {
        optedIn: true,
        districtId: musanze.id,
        spot: { ...kimironko },
      });

      await offers.sendDue();

      const digest = sendOffersDigest.mock.calls[0][1];
      expect(digest.place).toBe('Musanze');
      expect(digest.nearSpot).toBe(false);
    });
  });

  describe('unsubscribing from the email', () => {
    it('turns it off with the link alone', async () => {
      await shopIn(gasabo.id, 'A');
      const customer = await customerIn(gasabo.id);
      await offers.sendDue();
      const token = sendOffersDigest.mock.calls[0][1].unsubscribeUrl.split('/').pop()!;

      await offers.unsubscribe(token);

      expect((await offers.preference(customer.userId)).optedIn).toBe(false);
      sendOffersDigest.mockClear();
      await offers.sendDue(new Date(Date.now() + 8 * 86_400_000));
      expect(sendOffersDigest).not.toHaveBeenCalled();
    });

    it('an unknown or empty token changes nobody', async () => {
      const customer = await customerIn(gasabo.id);
      await offers.unsubscribe('not-a-token');
      await offers.unsubscribe('');
      expect((await offers.preference(customer.userId)).optedIn).toBe(true);
    });

    it('an old link stops working once they opt in again', async () => {
      const customer = await customerIn(gasabo.id);
      const old = (await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } }))
        .offersToken!;
      await offers.update(customer.userId, { optedIn: false });
      await offers.update(customer.userId, { optedIn: true });

      await offers.unsubscribe(old);
      expect((await offers.preference(customer.userId)).optedIn).toBe(true);
    });
  });

  it('writes money the way a person reads it', () => {
    expect(formatMoney(7000, 'RWF')).toBe('RWF 7,000');
    expect(formatMoney(1250, 'USD')).toBe('USD 12.50');
  });
});
