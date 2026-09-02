import { Prisma, UserRole } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
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
      await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
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

  describe('appointment responses never render today price (§32)', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let appointments: AppointmentsService;
    let business: Awaited<ReturnType<typeof createBusiness>>;
    let customer: { userId: string; email: string };
    let appointmentId: string;

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
      await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
      business = await createBusiness(prisma, { priceCents: 4500, depositPercentage: 20 });
      customer = await createCustomer(prisma);

      const created = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: futureSlot(9, 8).toISOString(),
      });
      appointmentId = created.id;

      // The business reprices AFTER the booking. Everything below asks what a
      // customer opening that booking now is shown.
      await prisma.service.update({
        where: { id: business.serviceId },
        data: { priceCents: 9999 },
      });
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    it('findOne reports the original price, not the repriced one', async () => {
      const found = await appointments.findOne(customer.userId, appointmentId);

      expect(found.servicePriceCents).toBe(4500);
      // The live price is not reachable anywhere in the response.
      expect(found.service).not.toHaveProperty('priceCents');
      expect(JSON.stringify(found)).not.toContain('9999');
    });

    it('findAll reports the original price, not the repriced one', async () => {
      const list = await appointments.findAll(customer.userId, UserRole.CUSTOMER, {});
      const row = list.appointments.find((a: any) => a.id === appointmentId);

      expect(row.servicePriceCents).toBe(4500);
      expect(row.service).not.toHaveProperty('priceCents');
      expect(JSON.stringify(list)).not.toContain('9999');
    });

    it('a transition method return value reports the original price too', async () => {
      // Every transition returns APPOINTMENT_SELECT, so the same select that
      // served the stale price to a detail view served it here as well.
      const cancelled = await appointments.cancel(customer.userId, appointmentId);

      expect(cancelled.servicePriceCents).toBe(4500);
      expect(cancelled.service).not.toHaveProperty('priceCents');
      expect(JSON.stringify(cancelled)).not.toContain('9999');
    });

    it('keeps the service NAME joined - a renamed label drifts, a price must not', async () => {
      await prisma.service.update({
        where: { id: business.serviceId },
        data: { name: 'Renamed Service' },
      });

      const found = await appointments.findOne(customer.userId, appointmentId);

      expect(found.service.name).toBe('Renamed Service');
      expect(found.servicePriceCents).toBe(4500);
    });

    describe('a pre-snapshot appointment', () => {
      let legacyId: string;

      beforeAll(async () => {
        const created = await appointments.create(customer.userId, {
          locationId: business.locationId,
          serviceId: business.serviceId,
          startTime: futureSlot(10, 8).toISOString(),
        });
        legacyId = created.id;

        // Exactly what a row booked before §30 looks like.
        await prisma.appointment.update({
          where: { id: legacyId },
          data: {
            servicePriceCents: null,
            depositPercentage: null,
            platformFeePercentage: null,
          },
        });
      });

      it('returns null rather than falling back to the live price', async () => {
        const found = await appointments.findOne(customer.userId, legacyId);

        // Null is "not recorded", which a client can render honestly. The live
        // price would be a wrong number presented as a fact, which is the bug
        // this whole change exists to remove.
        expect(found.servicePriceCents).toBeNull();
        expect(JSON.stringify(found)).not.toContain('9999');
      });

      it('exposes the live price nowhere in the response shape', async () => {
        const found = await appointments.findOne(customer.userId, legacyId);
        const list = await appointments.findAll(customer.userId, UserRole.CUSTOMER, {});

        expect(found.service).not.toHaveProperty('priceCents');
        expect(Object.keys(found.service).sort()).toEqual([
          'durationMinutes',
          'id',
          'name',
        ]);
        expect(JSON.stringify(list)).not.toContain('9999');
      });
    });
  });

  /**
   * The floor rule, from both directions (§40).
   *
   * ServicesService refuses to save a service below the fee; this covers the
   * other direction — the service was fine and the FEE moved underneath it — and
   * the defensive assertion that catches anything either misses.
   */
  describe('deposit >= platform fee, enforced both ways (§40)', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let services: ServicesService;
    let settings: PlatformSettingsService;
    let business: Awaited<ReturnType<typeof createBusiness>>;
    let other: Awaited<ReturnType<typeof createBusiness>>;

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
      other = await createBusiness(prisma);
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    beforeEach(async () => {
      await prisma.service.deleteMany({});
      await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });
    });

    const service = (depositPercentage: number, name = 'Service') =>
      services.create(business.userId, {
        name,
        priceCents: 4500,
        durationMinutes: 60,
        depositPercentage,
      });

    describe('at service create and update', () => {
      it('rejects a deposit below the fee, and says why', async () => {
        await expect(service(9)).rejects.toThrow(/at least 10.00%/);
        // The message has to explain the rule, not just state a number.
        await expect(service(9)).rejects.toThrow(/taken out of the deposit/);
      });

      it('accepts a deposit exactly equal to the fee', async () => {
        const created = await service(10, 'At the floor');

        expect(Number(created.depositPercentage)).toBe(10);
      });

      it('accepts a deposit above the fee', async () => {
        const created = await service(25, 'Above the floor');

        expect(Number(created.depositPercentage)).toBe(25);
      });

      it('rejects an UPDATE that drops the deposit below the fee', async () => {
        const created = await service(25);

        await expect(
          services.update(business.userId, created.id, { depositPercentage: 5 }),
        ).rejects.toThrow(/at least 10.00%/);

        const after = await prisma.service.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(Number(after.depositPercentage)).toBe(25);
      });

      it('allows an update that leaves the deposit at or above the fee', async () => {
        const created = await service(25);

        const updated = await services.update(business.userId, created.id, {
          depositPercentage: 10,
        });

        expect(Number(updated.depositPercentage)).toBe(10);
      });
    });

    describe('at platform-fee change', () => {
      it('rejects an increase that would strand an active service', async () => {
        await service(15, 'Deposit 15%');

        await expect(settings.setPlatformFeePercentage(20, { role: 'ADMIN' })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('names the offending services so the admin can act', async () => {
        const created = await service(15, 'Haircut');

        const error = await settings
          .setPlatformFeePercentage(20, { role: 'ADMIN' })
          .catch((e: BadRequestException) => e.getResponse() as any);

        expect(error.offendingCount).toBe(1);
        expect(error.requestedPlatformFeePercentage).toBe('20.00');
        expect(error.currentPlatformFeePercentage).toBe('10.00');
        expect(error.offendingServices).toHaveLength(1);
        expect(error.offendingServices[0]).toMatchObject({
          id: created.id,
          businessId: business.businessId,
          name: 'Haircut',
          depositPercentage: '15.00',
        });
      });

      it('changes nothing when it refuses', async () => {
        await service(15);

        await expect(settings.setPlatformFeePercentage(20, { role: 'ADMIN' })).rejects.toThrow();

        // Neither the fee nor anybody's pricing moved.
        expect(Number(await settings.getPlatformFeePercentage())).toBe(10);
        const rows = await prisma.service.findMany({});
        expect(rows.every((r) => Number(r.depositPercentage) === 15)).toBe(true);
      });

      it('never auto-raises a deposit percentage', async () => {
        const created = await service(15);

        await expect(settings.setPlatformFeePercentage(20, { role: 'ADMIN' })).rejects.toThrow();

        const after = await prisma.service.findUniqueOrThrow({
          where: { id: created.id },
        });
        // Silently rewriting a business's pricing is worse than a failed admin
        // request. The admin is told who to talk to instead.
        expect(Number(after.depositPercentage)).toBe(15);
      });

      it('succeeds once the offending service is fixed', async () => {
        const created = await service(15);
        await expect(settings.setPlatformFeePercentage(20, { role: 'ADMIN' })).rejects.toThrow();

        await services.update(business.userId, created.id, { depositPercentage: 20 });
        const result = await settings.setPlatformFeePercentage(20, { role: 'ADMIN' });

        expect(result.platformFeePercentage).toBe('20.00');
      });

      it('caps the named list at 20 but reports the true count', async () => {
        for (let i = 0; i < 23; i++) {
          await service(15, `Service ${i}`);
        }

        const error = await settings
          .setPlatformFeePercentage(20, { role: 'ADMIN' })
          .catch((e: BadRequestException) => e.getResponse() as any);

        expect(error.offendingCount).toBe(23);
        expect(error.offendingServices).toHaveLength(20);
        expect(error.offendingShown).toBe(20);
      });

      it('ignores INACTIVE services - a soft-deleted one takes no bookings', async () => {
        const created = await service(5.0 + 5.0, 'Will be retired');
        await prisma.service.update({
          where: { id: created.id },
          data: { depositPercentage: 5, isActive: false },
        });

        const result = await settings.setPlatformFeePercentage(20, { role: 'ADMIN' });

        expect(result.platformFeePercentage).toBe('20.00');
      });

      it('blocks on ANY business, not just the caller', async () => {
        await services.create(other.userId, {
          name: 'Someone else',
          priceCents: 4500,
          durationMinutes: 60,
          depositPercentage: 12,
        });

        const error = await settings
          .setPlatformFeePercentage(20, { role: 'ADMIN' })
          .catch((e: BadRequestException) => e.getResponse() as any);

        expect(error.offendingCount).toBe(1);
        expect(error.offendingServices[0].businessId).toBe(other.businessId);
      });

      it('always allows a decrease', async () => {
        await settings.setPlatformFeePercentage(20, { role: 'ADMIN' });
        await service(20);

        const result = await settings.setPlatformFeePercentage(5, { role: 'ADMIN' });

        // Lowering the fee can only widen the margin.
        expect(result.platformFeePercentage).toBe('5.00');
      });

      it('allows setting the same value again', async () => {
        await service(10);

        const result = await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });

        expect(result.platformFeePercentage).toBe('10.00');
      });

      it('allows an increase that strands nobody', async () => {
        await service(30);

        const result = await settings.setPlatformFeePercentage(25, { role: 'ADMIN' });

        expect(result.platformFeePercentage).toBe('25.00');
      });
    });

    describe('the defensive assertion in the money path', () => {
      it('throws when the fee exceeds the deposit', () => {
        // Unreachable given the two checks above — which is the point.
        expect(() => computeAppointmentAmounts(4500, D(10), D(15))).toThrow(
          /exceeds deposit/,
        );
      });

      it('never clamps to zero', () => {
        // A clamp would hide the misconfiguration and quietly move the
        // business's money to the platform.
        let result: unknown = 'not thrown';
        try {
          result = computeAppointmentAmounts(4500, D(10), D(15));
        } catch {
          result = 'threw';
        }
        expect(result).toBe('threw');
      });

      it('permits fee exactly equal to deposit', () => {
        const a = computeAppointmentAmounts(4500, D(10), D(10));

        expect(a.businessAmountCents).toBe(0);
        expect(a.platformFeeAmountCents).toBe(a.depositAmountCents);
      });
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
      await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });
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
      // The raise is only permitted once nothing active sits below the new fee
      // (§40.2), so retire the sub-floor services this suite created first.
      // That is the rule doing its job, not an obstacle to working around: the
      // point of this test is the CREATE floor, which is read live.
      await prisma.service.updateMany({ where: {}, data: { isActive: false } });
      await settings.setPlatformFeePercentage(25, { role: 'ADMIN' });

      await expect(
        services.create(business.userId, {
          name: 'Was fine at 10%',
          priceCents: 4500,
          durationMinutes: 60,
          depositPercentage: 20,
        }),
      ).rejects.toThrow(/at least 25.00%/);

      await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });
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
