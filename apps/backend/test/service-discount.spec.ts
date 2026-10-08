import { BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { discountedPrice, liveDiscount, priceFor, ymd } from '../src/business/discount';
import { CreateServiceDto } from '../src/business/dto/create-service.dto';
import { LocationsService } from '../src/business/locations.service';
import { ServicesService } from '../src/business/services.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { LegalService } from '../src/legal/legal.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness, createCustomer, futureSlot } from './setup/factories';

/**
 * Sales on services (§186). What matters: the customer pays the price they
 * were shown, the deposit and the platform fee are shares of THAT price and
 * still add up, the booking keeps a record of the sale it was made under, a
 * sale stops on its last day, and a seller cannot set one that makes no sense.
 */
describe('Sales on services (§186)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let services: ServicesService;
  let discovery: DiscoveryService;
  let favourites: FavouritesService;
  let appointments: AppointmentsService;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ServicesService,
      LegalService,
      LocationsService,
      BusinessAccessService,
      DiscoveryService,
      FavouritesService,
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    services = moduleRef.get(ServicesService);
    discovery = moduleRef.get(DiscoveryService);
    favourites = moduleRef.get(FavouritesService);
    appointments = moduleRef.get(AppointmentsService);
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const day = (offsetDays: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return ymd(d);
  };

  const shop = async (sale?: { percent: number; endsOn?: string | null }) => {
    const business = await createBusiness(prisma, {
      status: BusinessStatus.APPROVED,
      priceMinor: 7000,
      depositPercentage: 20,
      durationMinutes: 30,
    });
    if (sale) {
      await prisma.service.update({
        where: { id: business.serviceId },
        data: {
          discountPercent: sale.percent,
          discountEndsOn: sale.endsOn ? new Date(`${sale.endsOn}T00:00:00Z`) : null,
        },
      });
    }
    return business;
  };

  const book = async (business: TestBusiness, quantity?: number) =>
    appointments.create((await createCustomer(prisma)).userId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: futureSlot(7, 8).toISOString(),
      ...(quantity !== undefined ? { quantity } : {}),
    });

  describe('the arithmetic', () => {
    it('takes the percentage off one unit, rounding half up to a whole unit', () => {
      expect(discountedPrice(7000, 20)).toBe(5600);
      expect(discountedPrice(30000, 15)).toBe(25500);
      expect(discountedPrice(999, 50)).toBe(500); // 499.5 rounds up
      expect(discountedPrice(1, 90)).toBe(0);
    });

    it('is on through its last day, and off the day after', () => {
      const today = new Date('2026-10-08T00:00:00Z');
      const on = (endsOn: string | null) =>
        liveDiscount({ discountPercent: 20, discountEndsOn: endsOn ? new Date(`${endsOn}T00:00:00Z`) : null }, today);
      expect(on(null)).toEqual({ percent: 20, endsOn: null });
      expect(on('2026-10-08')).toEqual({ percent: 20, endsOn: '2026-10-08' });
      expect(on('2026-10-07')).toBeNull();
      expect(liveDiscount({ discountPercent: null, discountEndsOn: null }, today)).toBeNull();
      expect(priceFor(7000, null)).toEqual({ priceMinor: 7000, discount: null });
    });
  });

  describe('booking', () => {
    it('charges the sale price, takes deposit and fee from it, and records the sale', async () => {
      const business = await shop({ percent: 20 });
      const booked = await book(business);
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });

      expect(row.unitPriceMinor).toBe(5600);
      expect(row.servicePriceMinor).toBe(5600);
      expect(row.depositAmountMinor).toBe(1120); // 20% of 5,600
      expect(row.platformFeeAmountMinor).toBe(560); // 10% of 5,600
      expect(row.platformFeeAmountMinor + row.businessAmountMinor).toBe(row.depositAmountMinor);
      expect(row.discountPercent).toBe(20);
      expect(row.listPriceMinor).toBe(7000);
    });

    it('multiplies the sale price, so three cost three times the price on the card', async () => {
      const business = await shop({ percent: 15 });
      // Three people need three places (§189).
      await prisma.location.update({
        where: { id: business.locationId },
        data: { capacity: 5 },
      });
      const booked = await book(business, 3);
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });

      expect(row.unitPriceMinor).toBe(5950);
      expect(row.servicePriceMinor).toBe(17850);
      expect(row.listPriceMinor).toBe(21000);
    });

    it('charges the full price once the last day has passed, and records no sale', async () => {
      const business = await shop({ percent: 20, endsOn: day(-2) });
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: (await book(business)).id } });

      expect(row.servicePriceMinor).toBe(7000);
      expect(row.discountPercent).toBeNull();
      expect(row.listPriceMinor).toBeNull();
    });

    it('keeps the price a booking was made at when the sale changes afterwards', async () => {
      const business = await shop({ percent: 30 });
      const booked = await book(business);
      await services.update(business.userId, business.serviceId, { discountPercent: null });
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });

      expect(row.servicePriceMinor).toBe(4900);
      expect(row.discountPercent).toBe(30);
    });
  });

  describe('what customers see', () => {
    it('shows the sale price and the sale, in search, on the shop and in saved services', async () => {
      const business = await shop({ percent: 25, endsOn: day(3) });

      const found = await discovery.searchServices({});
      const listed = found.services.find((s) => s.id === business.serviceId)!;
      expect(listed.priceMinor).toBe(5250);
      expect(listed.discount).toEqual({ percent: 25, endsOn: day(3), listPriceMinor: 7000 });

      const shopfront: any = await discovery.findOne(business.locationId);
      const onShop = shopfront.services.find((s: any) => s.id === business.serviceId);
      expect(onShop.priceMinor).toBe(5250);
      expect(onShop.discount.percent).toBe(25);
      // The stored columns stay on the server.
      expect(onShop).not.toHaveProperty('discountPercent');
      expect(onShop).not.toHaveProperty('discountEndsOn');

      const customer = await createCustomer(prisma);
      await favourites.addService(customer.userId, business.serviceId, business.locationId);
      const saved = await favourites.listServices(customer.userId);
      expect(saved.services[0].priceMinor).toBe(5250);
      expect(saved.services[0].discount?.listPriceMinor).toBe(7000);
    });

    it('lists only what is on sale when asked, biggest sale first, and sorts by the price paid', async () => {
      await resetDatabase(prisma);
      await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
      const small = await shop({ percent: 10 });
      const big = await shop({ percent: 60 });
      const none = await shop();
      const ended = await shop({ percent: 50, endsOn: day(-1) });

      const sales = await discovery.searchServices({ onSale: true });
      expect(sales.services.map((s) => s.id)).toEqual([big.serviceId, small.serviceId]);

      const cheapest = await discovery.searchServices({ sort: 'price' as never });
      // 7,000 at 60% off is 2,800: cheaper than every full price.
      expect(cheapest.services[0].id).toBe(big.serviceId);
      expect(cheapest.services.find((s) => s.id === none.serviceId)!.discount).toBeNull();
      expect(cheapest.services.find((s) => s.id === ended.serviceId)!.priceMinor).toBe(7000);
    });
  });

  describe('setting a sale', () => {
    const base = { name: 'Haircut', durationMinutes: 30, depositPercentage: 20, offers: [] };

    it('allows 1 to 90 percent, whole numbers only', async () => {
      const errors = async (discountPercent: unknown) =>
        (await validate(plainToInstance(CreateServiceDto, { ...base, discountPercent }))).filter(
          (e) => e.property === 'discountPercent',
        ).length;
      expect(await errors(0)).toBe(1);
      expect(await errors(91)).toBe(1);
      expect(await errors(12.5)).toBe(1);
      expect(await errors(1)).toBe(0);
      expect(await errors(90)).toBe(0);
      expect(await errors(null)).toBe(0);
    });

    it('refuses a last day in the past, or a last day with no percentage', async () => {
      const business = await shop();
      await expect(
        services.update(business.userId, business.serviceId, { discountPercent: 20, discountEndsOn: day(-1) }),
      ).rejects.toThrow(/cannot be in the past/);
      await expect(
        services.update(business.userId, business.serviceId, { discountEndsOn: day(5) }),
      ).rejects.toThrow(/needs a percentage/);
    });

    it('saves a sale, keeps a stored past last day when it is sent back unchanged, and ends it with null', async () => {
      const business = await shop();
      const set = await services.update(business.userId, business.serviceId, {
        discountPercent: 20,
        discountEndsOn: day(4),
      });
      expect(set.discountPercent).toBe(20);
      expect(ymd(set.discountEndsOn!)).toBe(day(4));

      // The sale ended last week; editing the name sends the old day back.
      await prisma.service.update({
        where: { id: business.serviceId },
        data: { discountEndsOn: new Date(`${day(-7)}T00:00:00Z`) },
      });
      await expect(
        services.update(business.userId, business.serviceId, {
          name: 'Classic haircut',
          discountPercent: 20,
          discountEndsOn: day(-7),
        }),
      ).resolves.toBeDefined();

      const ended = await services.update(business.userId, business.serviceId, { discountPercent: null });
      expect(ended.discountPercent).toBeNull();
      expect(ended.discountEndsOn).toBeNull();
    });
  });
});
