import { Prisma } from '@prisma/client';
import { computeAppointmentAmounts } from '../src/appointments/appointment-pricing';
import { convertUsdCentsToProviderCents } from '../src/payments/currency';
import { ServicesService } from '../src/business/services.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestingModule } from '@nestjs/testing';
import { BusinessAccessService } from '../src/business/business-access.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness, createCustomer, futureSlot } from './setup/factories';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';

const D = (v: string | number) => new Prisma.Decimal(v);

/**
 * The deposit split is the one calculation where a silent error costs real
 * money and nobody notices for months. These assert the invariant directly
 * rather than through the booking flow, so a failure points at the arithmetic.
 */
describe('Money invariant: platformFee + business === deposit', () => {
  describe('computeAppointmentAmounts (pure)', () => {
    const cases: Array<[string, number, string, string]> = [
      ['typical: $45.00 service, 20% deposit, 10% fee', 4500, '20.00', '10.00'],
      ['AT THE FLOOR: deposit % equals fee %', 4500, '10.00', '10.00'],
      ['deposit far above the fee', 4500, '50.00', '10.00'],
      ['larger service price', 12000, '25.00', '10.00'],
      ['awkward rounding: 999c at 33.33%', 999, '33.33', '10.00'],
      ['smallest possible price', 1, '50.00', '10.00'],
      ['full price taken as deposit', 4500, '100.00', '10.00'],
      ['both at the same non-default rate', 4500, '12.50', '12.50'],
      ['rounding on both sides', 7333, '17.77', '10.00'],
      ['zero platform fee', 4500, '10.00', '0.00'],
      ['half-cent boundary rounds half-up', 333, '92.50', '10.00'],
    ];

    it.each(cases)(
      '%s — the three amounts reconcile exactly',
      (_label, priceCents, depositPct, feePct) => {
        const a = computeAppointmentAmounts(priceCents, D(depositPct), D(feePct));

        expect(a.platformFeeAmountCents + a.businessAmountCents).toBe(
          a.depositAmountCents,
        );
      },
    );

    it.each(cases)(
      '%s — the business share is never negative',
      (_label, priceCents, depositPct, feePct) => {
        const a = computeAppointmentAmounts(priceCents, D(depositPct), D(feePct));

        expect(a.businessAmountCents).toBeGreaterThanOrEqual(0);
      },
    );

    it.each(cases)(
      '%s — every amount is a whole number of cents',
      (_label, priceCents, depositPct, feePct) => {
        const a = computeAppointmentAmounts(priceCents, D(depositPct), D(feePct));

        expect(Number.isInteger(a.depositAmountCents)).toBe(true);
        expect(Number.isInteger(a.platformFeeAmountCents)).toBe(true);
        expect(Number.isInteger(a.businessAmountCents)).toBe(true);
      },
    );

    it('at the floor, the business receives nothing from the deposit', () => {
      const a = computeAppointmentAmounts(4500, D('10.00'), D('10.00'));

      expect(a).toEqual({
        depositAmountCents: 450,
        platformFeeAmountCents: 450,
        businessAmountCents: 0,
      });
    });

    it('derives the business share by subtraction, so rounding cannot lose a cent', () => {
      // 999 x 33.33% = 332.967 -> 333; 999 x 10% = 99.9 -> 100.
      // Rounding a third percentage independently would give 233 or 234 and
      // could disagree with deposit - fee.
      const a = computeAppointmentAmounts(999, D('33.33'), D('10.00'));

      expect(a.depositAmountCents).toBe(333);
      expect(a.platformFeeAmountCents).toBe(100);
      expect(a.businessAmountCents).toBe(233);
    });
  });

  describe('currency conversion at charge time (§18.4)', () => {
    it('converts a USD deposit into provider cents at the configured rate', () => {
      // 900 USD cents x 0.92 = 828 EUR cents.
      expect(convertUsdCentsToProviderCents(900, D('0.92'))).toBe(828);
    });

    it('handles an SSP-scale rate without losing precision', () => {
      expect(convertUsdCentsToProviderCents(900, D('6500.00000000'))).toBe(5_850_000);
    });

    it('rounds half-up on the converted figure', () => {
      // 333 x 0.925 = 308.025
      expect(convertUsdCentsToProviderCents(333, D('0.925'))).toBe(308);
    });

    it('conversion does not disturb the stored USD invariant', () => {
      const a = computeAppointmentAmounts(4500, D('20.00'), D('10.00'));
      const charged = convertUsdCentsToProviderCents(a.depositAmountCents, D('0.92'));

      // The provider is charged a converted figure; the internal split is
      // untouched and still reconciles.
      expect(charged).toBe(828);
      expect(a.platformFeeAmountCents + a.businessAmountCents).toBe(
        a.depositAmountCents,
      );
    });
  });

  describe('pricing snapshot reproduces the stored amounts (§30)', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let appointments: AppointmentsService;
    let business: Awaited<ReturnType<typeof createBusiness>>;
    let customer: { userId: string; email: string };

    beforeAll(async () => {
      moduleRef = await createTestModule([
        AppointmentsService,
        AvailabilityService,
        PlatformSettingsService,
        commonStubs.mail(),
        commonStubs.notifications(),
        commonStubs.payments(),
        commonStubs.chat(),
      ]);
      prisma = moduleRef.get(PrismaService);
      appointments = moduleRef.get(AppointmentsService);
      await resetDatabase(prisma);
      await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10);
      business = await createBusiness(prisma, { priceCents: 4500, depositPercentage: 20 });
      customer = await createCustomer(prisma);
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    it('records the inputs the amounts were computed from', async () => {
      const created = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: futureSlot(7, 8).toISOString(),
      });

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: created.id } });

      expect(row.servicePriceCents).toBe(4500);
      expect(Number(row.depositPercentage)).toBe(20);
      expect(Number(row.platformFeePercentage)).toBe(10);
    });

    it('the snapshot reproduces depositAmountCents exactly', async () => {
      const row = await prisma.appointment.findFirstOrThrow({
        where: { customerId: customer.userId },
      });

      const recomputed = computeAppointmentAmounts(
        row.servicePriceCents!,
        new Prisma.Decimal(row.depositPercentage!),
        new Prisma.Decimal(row.platformFeePercentage!),
      );

      // The point of the snapshot: the stored amounts are explainable from the
      // stored inputs, with no reference to today's editable Service row.
      expect(recomputed.depositAmountCents).toBe(row.depositAmountCents);
    });

    it('the snapshot reproduces platformFeeAmountCents and businessAmountCents exactly', async () => {
      const row = await prisma.appointment.findFirstOrThrow({
        where: { customerId: customer.userId },
      });

      const recomputed = computeAppointmentAmounts(
        row.servicePriceCents!,
        new Prisma.Decimal(row.depositPercentage!),
        new Prisma.Decimal(row.platformFeePercentage!),
      );

      expect(recomputed.platformFeeAmountCents).toBe(row.platformFeeAmountCents);
      expect(recomputed.businessAmountCents).toBe(row.businessAmountCents);
    });

    it('editing the service afterwards does not change the snapshot', async () => {
      const row = await prisma.appointment.findFirstOrThrow({
        where: { customerId: customer.userId },
      });

      // The exact failure the snapshot exists to prevent.
      await prisma.service.update({
        where: { id: business.serviceId },
        data: { priceCents: 9999, depositPercentage: 55 },
      });

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.servicePriceCents).toBe(4500);
      expect(Number(after.depositPercentage)).toBe(20);
      expect(after.depositAmountCents).toBe(row.depositAmountCents);
    });
  });

  describe('deposit floor validation against the live platform fee (§16.3)', () => {
    let moduleRef: TestingModule;
    let services: ServicesService;
    let settings: PlatformSettingsService;
    let prisma: PrismaService;
    let business: Awaited<ReturnType<typeof createBusiness>>;

    beforeAll(async () => {
      moduleRef = await createTestModule([
        PlatformSettingsService,
        BusinessAccessService,
        ServicesService,
      ]);
      prisma = moduleRef.get(PrismaService);
      services = moduleRef.get(ServicesService);
      settings = moduleRef.get(PlatformSettingsService);
      await resetDatabase(prisma);
      business = await createBusiness(prisma);
      await settings.setPlatformFeePercentage(10);
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    it('rejects a deposit percentage just below the platform fee', async () => {
      await expect(
        services.create(business.userId, {
          name: 'Below floor',
          priceCents: 4500,
          durationMinutes: 60,
          depositPercentage: 9.99,
        }),
      ).rejects.toThrow(/at least 10.00%/);
    });

    it('accepts a deposit percentage exactly at the floor', async () => {
      const created = await services.create(business.userId, {
        name: 'At floor',
        priceCents: 4500,
        durationMinutes: 60,
        depositPercentage: 10,
      });

      expect(created.depositPercentage.toString()).toBe('10');
    });

    it('reads the floor LIVE: raising the fee invalidates a previously valid deposit', async () => {
      await settings.setPlatformFeePercentage(25);

      await expect(
        services.create(business.userId, {
          name: 'Was fine at 10%',
          priceCents: 4500,
          durationMinutes: 60,
          depositPercentage: 20,
        }),
      ).rejects.toThrow(/at least 25.00%/);

      await settings.setPlatformFeePercentage(10);
    });

    it('rejects an update that would drop an existing service below the floor', async () => {
      const created = await services.create(business.userId, {
        name: 'To be lowered',
        priceCents: 4500,
        durationMinutes: 60,
        depositPercentage: 20,
      });

      await expect(
        services.update(business.userId, created.id, { depositPercentage: 5 }),
      ).rejects.toThrow(/at least 10.00%/);
    });
  });
});
