import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { BusinessDocumentKind as K, MobileMoneyProvider, Prisma, UserRole } from '@prisma/client';
import { AdminCountriesService } from '../src/countries/admin-countries.service';
import { CountriesService } from '../src/countries/countries.service';
import { CountryGuard } from '../src/countries/country-guard.service';
import { countryChecks } from '../src/countries/country-readiness';
import { isLocalTime, localTime } from '../src/countries/local-time';
import { PACKS } from '../src/countries/packs';
import { RWANDA } from '../src/countries/packs/rwanda';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { requiredPapers } from '../src/business/document-rules';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { DisbursementProviderRegistry } from '../src/payments/disbursement-provider.registry';
import { INTERNAL_CURRENCY } from '../src/payments/currency';
import { inferOperator } from '../src/payments/operator-routing';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness, createCustomer } from './setup/factories';

/**
 * Countries (§315). Rwanda is the one real country; "Testland" (XT, a code
 * ISO keeps for private use) is an imaginary second one, added for the
 * length of this file — with the platform's own money, Nairobi's clock (an
 * hour ahead of Kigali) and its own calling code — to prove that two
 * countries stay apart: their shops, their clocks, their phone numbers,
 * their fees and their papers.
 */
const XT = 'XT';
const TESTLAND_PACK = {
  code: XT,
  callingCode: '999',
  mapBox: '36,-2,38,0',
  mobileDigits: 9,
  operatorPrefixes: { '70': MobileMoneyProvider.MTN_MOMO },
  papers: { rules: [], registration: [], kinds: [K.OTHER] },
};
const AS_ADMIN = { userId: 'admin', email: 'admin@example.com', role: UserRole.ADMIN } as const;

describe('Countries (§315)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let countries: CountriesService;
  let admin: AdminCountriesService;
  let settings: PlatformSettingsService;
  let discovery: DiscoveryService;
  let availability: AvailabilityService;
  let appointments: AppointmentsService;
  let payouts: PayoutDestinationsService;
  let testlandDistrictId: string;

  /** A day both shops are open, far enough ahead to book. */
  const openDate = () => {
    const date = new Date(Date.now() + 10 * 86_400_000);
    return date.toISOString().slice(0, 10);
  };

  /** Puts a factory shop in Testland, its branch in Testland's district. */
  const inTestland = async (shop: TestBusiness) => {
    await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { countryCode: XT } });
    await prisma.location.update({ where: { id: shop.locationId }, data: { districtId: testlandDistrictId } });
    return shop;
  };

  const setTestland = async (data: Prisma.CountryUpdateInput) => {
    await prisma.country.update({ where: { code: XT }, data });
    countries.forget();
  };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AdminCountriesService,
      CountryGuard,
      DiscoveryService,
      FavouritesService,
      AvailabilityService,
      AppointmentsService,
      PayoutDestinationsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    countries = moduleRef.get(CountriesService);
    admin = moduleRef.get(AdminCountriesService);
    settings = moduleRef.get(PlatformSettingsService);
    discovery = moduleRef.get(DiscoveryService);
    availability = moduleRef.get(AvailabilityService);
    appointments = moduleRef.get(AppointmentsService);
    payouts = moduleRef.get(PayoutDestinationsService);
    await resetDatabase(prisma);

    PACKS[XT] = TESTLAND_PACK;
    await prisma.country.create({
      data: {
        code: XT,
        name: 'Testland',
        callingCode: '999',
        currency: INTERNAL_CURRENCY,
        timeZone: 'Africa/Nairobi',
        locales: ['en'],
        networks: [MobileMoneyProvider.MTN_MOMO],
        phoneExample: '+999 700 123 456',
      },
    });
    const province = await prisma.province.create({ data: { code: 'CENTRAL', name: 'Central', countryCode: XT } });
    testlandDistrictId = (await prisma.district.create({ data: { code: 'CAPITAL', name: 'Capital', provinceId: province.id } })).id;
    countries.forget();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.district.deleteMany({ where: { province: { countryCode: XT } } });
    await prisma.province.deleteMany({ where: { countryCode: XT } });
    await prisma.country.delete({ where: { code: XT } });
    await prisma.country.update({ where: { code: 'RW' }, data: { platformFeePercentage: null } });
    delete PACKS[XT];
    await moduleRef.close();
  });

  describe('Rwanda, as the reference data has it', () => {
    it('is the one default country, live, on Kigali time and in francs', async () => {
      const rw = await countries.defaultCountry();
      expect(rw).toMatchObject({
        code: 'RW',
        callingCode: '250',
        currency: 'RWF',
        timeZone: 'Africa/Kigali',
        isLive: true,
        isDefault: true,
        networks: [MobileMoneyProvider.MTN_MOMO, MobileMoneyProvider.AIRTEL_MONEY],
      });
      expect(rw.locales).toEqual(['en', 'rw', 'fr']);
      expect(await prisma.province.count({ where: { countryCode: 'RW' } })).toBe(5);
    });

    it('passes every check, and the boot guard starts', async () => {
      const places = await prisma.district.count({ where: { isLive: true, province: { countryCode: 'RW' } } });
      expect(countryChecks(await countries.get('RW'), places).filter((c) => !c.ok)).toEqual([]);
      await expect(moduleRef.get(CountryGuard).onModuleInit()).resolves.toBeUndefined();
    });

    it('allows only one default country', async () => {
      await expect(prisma.country.update({ where: { code: XT }, data: { isDefault: true } })).rejects.toThrow();
    });

    it('knows its numbers: 250, nine digits, MTN on 78/79 and Airtel on 72/73', async () => {
      const rw = await countries.get('RW');
      expect(countries.isMobileIn(rw, '250788123456')).toBe(true);
      expect(countries.isMobileIn(rw, '+250 788 123 456')).toBe(true);
      expect(countries.isMobileIn(rw, '25078812345')).toBe(false);
      expect(countries.isMobileIn(rw, '256770000000')).toBe(false);
      expect(countries.inferNetwork(rw, '250788123456')).toBe(MobileMoneyProvider.MTN_MOMO);
      expect(countries.inferNetwork(rw, '250730000000')).toBe(MobileMoneyProvider.AIRTEL_MONEY);
      expect(countries.inferNetwork(rw, '250250123456')).toBeNull();
      // The same prefixes, read without a country, from the pack.
      expect(inferOperator('250721000000')).toBe(MobileMoneyProvider.AIRTEL_MONEY);
    });
  });

  describe('switching a country on', () => {
    it('refuses while a check fails, and says which', async () => {
      await setTestland({ currency: 'KES' });
      const checks = countryChecks(await countries.get(XT), 1);
      expect(checks.find((c) => c.key === 'currency')).toMatchObject({ ok: false });
      await expect(admin.update(AS_ADMIN, XT, { isLive: true })).rejects.toThrow(/cannot be switched on yet: Its money is KES/);
      await setTestland({ currency: INTERNAL_CURRENCY });
    });

    it('refuses a country the code has no pack for', async () => {
      delete PACKS[XT];
      await expect(admin.update(AS_ADMIN, XT, { isLive: true })).rejects.toThrow(/No country pack/);
      PACKS[XT] = TESTLAND_PACK;
    });

    it('switches a ready country on, and never the default off', async () => {
      const view = await admin.update(AS_ADMIN, XT, { isLive: true });
      expect(view).toMatchObject({ code: XT, isLive: true, places: 1 });
      expect(view.liveSince).not.toBeNull();
      expect((await countries.live()).map((c) => c.code)).toEqual(['RW', XT]);
      await expect(admin.update(AS_ADMIN, 'RW', { isLive: false })).rejects.toThrow(/default country/);
    });

    it('will not switch a country off while its shops are live', async () => {
      const shop = await inTestland(await createBusiness(prisma));
      await expect(admin.update(AS_ADMIN, XT, { isLive: false })).rejects.toThrow(/1 shop is live in Testland/);
      await prisma.businessProfile.delete({ where: { id: shop.businessId } });
    });

    it('treats a request for a country that is not live as the default one', async () => {
      expect((await countries.resolve('KE')).code).toBe('RW');
      expect((await countries.resolve(undefined)).code).toBe('RW');
      expect((await countries.resolve('xt')).code).toBe(XT);
    });
  });

  describe('with two live countries', () => {
    let rwanda: TestBusiness;
    let testland: TestBusiness;

    beforeAll(async () => {
      await setTestland({ isLive: true });
      await resetDatabase(prisma);
      rwanda = await createBusiness(prisma);
      testland = await inTestland(await createBusiness(prisma));
      await prisma.businessProfile.update({ where: { id: testland.businessId }, data: { name: 'Testland Salon' } });
      await prisma.businessProfile.update({ where: { id: rwanda.businessId }, data: { name: 'Kigali Salon' } });
    });

    it("shows a customer only their country's shops, and opens a shop by its link anywhere", async () => {
      const ids = async (country?: string) => (await discovery.search({ limit: 20, offset: 0 }, undefined, country)).locations.map((l) => l.id);
      expect(await ids()).toEqual([rwanda.locationId]);
      expect(await ids('RW')).toEqual([rwanda.locationId]);
      expect(await ids(XT)).toEqual([testland.locationId]);
      const services = await discovery.searchServices({ limit: 20, offset: 0 }, undefined, XT);
      expect(services.services.map((s) => s.location.id)).toEqual([testland.locationId]);
      // By its own link, from anywhere, on its own clock.
      expect((await discovery.findOne(testland.locationId)).timeZone).toBe('Africa/Nairobi');
      expect((await discovery.findOne(rwanda.locationId)).timeZone).toBe('Africa/Kigali');
    });

    it("keeps each shop's slots on its own clock, and reads a booked time on it", async () => {
      const date = openDate();
      const day = new Date(`${date}T00:00:00Z`);
      const there = await availability.getAvailability(testland.locationId, day, 60);
      expect(there.timeZone).toBe('Africa/Nairobi');
      expect(there.slots[0]).toBe('09:00');

      const customerId = (await createCustomer(prisma)).userId;
      const inNairobi = await appointments.create(customerId, { locationId: testland.locationId, serviceId: testland.serviceId, startTime: `${date}T10:00:00` });
      const inKigali = await appointments.create(customerId, { locationId: rwanda.locationId, serviceId: rwanda.serviceId, startTime: `${date}T10:00:00` });
      // 10:00 in Nairobi is 07:00 UTC; 10:00 in Kigali, 08:00.
      expect(inNairobi.startTime.toISOString()).toBe(`${date}T07:00:00.000Z`);
      expect(inKigali.startTime.toISOString()).toBe(`${date}T08:00:00.000Z`);
    });

    it("takes a payout number in the shop's own country only", async () => {
      await expect(payouts.submit(testland.userId, { msisdn: '+250788123456' })).rejects.toThrow(/Testland mobile number/);
      await expect(payouts.submit(testland.userId, { msisdn: '+99970012345' })).rejects.toThrow(BadRequestException);
      const kept = await payouts.submit(testland.userId, { msisdn: '+999700123456' });
      expect(kept.provider).toBe(MobileMoneyProvider.MTN_MOMO);
      await expect(payouts.submit(rwanda.userId, { msisdn: '+999700123456' })).rejects.toThrow(/Rwanda mobile number/);
      // A network the country does not have.
      await expect(
        payouts.submit(testland.userId, { msisdn: '+999700123456', provider: MobileMoneyProvider.AIRTEL_MONEY }),
      ).rejects.toThrow(/not a mobile money network in Testland/);
      // An Airtel number in Rwanda is recorded as Airtel's, not the column's default.
      const airtel = await payouts.submit(rwanda.userId, { msisdn: '+250730123456' });
      expect(airtel.provider).toBe(MobileMoneyProvider.AIRTEL_MONEY);
    });

    it('charges each country its own fee, and keeps a fee below every deposit there', async () => {
      const platform = await settings.getPlatformFeePercentage();
      await settings.setCountryFee(XT, 5, AS_ADMIN);
      expect((await settings.getPlatformFeePercentage(XT)).toFixed(2)).toBe('5.00');
      expect((await settings.getPlatformFeePercentage('RW')).toFixed(2)).toBe(platform.toFixed(2));
      // Testland's service takes a 20% deposit: its fee cannot rise past it.
      await expect(settings.setCountryFee(XT, 25, AS_ADMIN)).rejects.toThrow(/active service/);
      // Booked at Testland's fee.
      const customerId = (await createCustomer(prisma)).userId;
      const booked = await appointments.create(customerId, {
        locationId: testland.locationId,
        serviceId: testland.serviceId,
        startTime: `${openDate()}T12:00:00`,
      });
      expect(booked.platformFeePercentage?.toFixed(2)).toBe('5.00');
      // Back to the platform's.
      await settings.setCountryFee(XT, null, AS_ADMIN);
      expect((await settings.getPlatformFeePercentage(XT)).toFixed(2)).toBe(platform.toFixed(2));
    });

    it("asks a shop for its own country's papers", () => {
      const clinic = [{ category: { name: 'Health & Medical' }, subcategory: { name: 'Dental' } }];
      expect(requiredPapers('RW', clinic).map((r) => r.key)).toEqual(['health']);
      expect(requiredPapers(XT, clinic)).toEqual([]);
      expect(RWANDA.papers.registration).toContain(K.RDB_CERTIFICATE);
    });

    it("puts a person in their shop's country, or their home district's", async () => {
      expect((await countries.ofUser(testland.userId)).code).toBe(XT);
      expect((await countries.ofUser(rwanda.userId)).code).toBe('RW');
      const customer = await createCustomer(prisma);
      expect((await countries.ofUser(customer.userId)).code).toBe('RW');
      await prisma.user.update({ where: { id: customer.userId }, data: { homeDistrictId: testlandDistrictId } });
      expect((await countries.ofUser(customer.userId)).code).toBe(XT);
    });

    it("lets a branch pick only its own country's districts", async () => {
      const rwDistrict = await prisma.district.findFirstOrThrow({ where: { province: { countryCode: 'RW' } } });
      expect(await countries.ofLocation(testland.locationId)).toMatchObject({ code: XT });
      await expect(countries.ofLocation('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
      expect(rwDistrict.id).not.toBe(testlandDistrictId);
    });
  });

  describe('payment connections', () => {
    const provider = (country: string | null) => ({ key: MobileMoneyProvider.MTN_MOMO, country, isConfigured: () => true }) as never;
    const rwanda = { code: 'RW', name: 'Rwanda', isDefault: true };
    const testland = { code: XT, name: 'Testland', isDefault: false };

    it('serves the default country when a connection names none', () => {
      const registry = new DisbursementProviderRegistry([provider(null)]);
      expect(registry.available(rwanda)).toEqual([MobileMoneyProvider.MTN_MOMO]);
      expect(registry.available(testland)).toEqual([]);
      expect(() => registry.require(MobileMoneyProvider.MTN_MOMO, testland)).toThrow(ServiceUnavailableException);
      expect(() => registry.require(MobileMoneyProvider.MTN_MOMO, testland)).toThrow(/for Testland/);
    });

    it('serves only the country a connection names', () => {
      const registry = new DisbursementProviderRegistry([provider(XT)]);
      expect(registry.isAvailable(MobileMoneyProvider.MTN_MOMO, testland)).toBe(true);
      expect(registry.isAvailable(MobileMoneyProvider.MTN_MOMO, rwanda)).toBe(false);
    });
  });

  describe('local hours', () => {
    it('is nine on a Friday in Nairobi an hour before Kigali', () => {
      // Friday 30 October 2026, 06:00 UTC.
      const at = new Date('2026-10-30T06:00:00Z');
      expect(isLocalTime(at, 'Africa/Nairobi', { weekday: 5, hour: 9 })).toBe(true);
      expect(isLocalTime(at, 'Africa/Kigali', { weekday: 5, hour: 9 })).toBe(false);
      expect(isLocalTime(new Date('2026-10-30T07:00:00Z'), 'Africa/Kigali', { weekday: 5, hour: 9 })).toBe(true);
      expect(localTime(new Date('2026-10-30T22:30:00Z'), 'Africa/Kigali')).toEqual({ date: '2026-10-31', weekday: 6, hour: 0 });
    });
  });
});
