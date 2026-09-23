import { jest } from '@jest/globals';
import { AppointmentStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import {
  PLATFORM_SETTING_ID,
  PlatformSettingsService,
} from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.interface';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
  futureSlot,
} from './setup/factories';

const HOUR = 3_600_000;

/**
 * The indicative SSP figure shown beside USD prices (§39).
 *
 * Two things are being protected here. One: a customer never has to convert
 * anything themselves, and never sees two amounts converted at different rates.
 * Two: this figure touches nothing — it is not stored, not compared, and not
 * accepted back.
 */
describe('Approximate local-currency figures (§39)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let settings: PlatformSettingsService;

  let business: TestBusiness;
  let customer: { userId: string; email: string };
  let admin: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    settings = moduleRef.get(PlatformSettingsService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma, { priceMinor: 4500, depositPercentage: 20 });
    customer = await createCustomer(prisma);
    admin = { userId: 'unused', email: 'unused' };
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await prisma.platformSetting.deleteMany({});
  });

  /** 650 SSP to the dollar, set now. */
  const setRate = (rate = 650) =>
    settings.setExchangeRate(rate, 'SSP', { role: 'ADMIN' });

  const booked = async () =>
    createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.BOOKED,
    });

  const AS_CUSTOMER = () => customer.userId;

  describe('what the customer is shown', () => {
    it('returns a figure for every USD amount on the appointment', async () => {
      await setRate();
      const a = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: futureSlot(11, 8).toISOString(),
      });

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      expect(Object.keys(found.approxSettlement).sort()).toEqual([
        'businessAmountMinor',
        'depositAmountMinor',
        'platformFeeAmountMinor',
        'servicePriceMinor',
      ]);
    });

    it('skips an amount that is null rather than converting it to zero', async () => {
      await setRate();
      // A pre-§30 appointment: no price snapshot to convert.
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      expect(found.servicePriceMinor).toBeNull();
      // A missing price and a free one are different claims.
      expect(found.approxSettlement).not.toHaveProperty('servicePriceMinor');
      expect(found.approxSettlement).toHaveProperty('depositAmountMinor');
    });

    it('converts the deposit — the number that decides whether someone books', async () => {
      await setRate(650);
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);
      const deposit = found.approxSettlement.depositAmountMinor;

      // 900 USD cents = $9.00, at 650 => 5850 SSP.
      expect(found.depositAmountMinor).toBe(900);
      expect(deposit.currency).toBe('SSP');
      expect(deposit.amountMinor).toBe(585_000);
      expect(deposit.exchangeRate).toBe('650.00000000');
      expect(deposit.approximate).toBe(true);
      expect(deposit.rateAsOf).not.toBeNull();
    });

    it('rounds to whole units - never more precision than the rate justifies', async () => {
      await setRate(650.5);
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      // $9.00 x 650.5 = 5854.5 SSP, shown as 5855 whole pounds.
      expect(found.approxSettlement.depositAmountMinor.amountMinor % 100).toBe(0);
      expect(found.approxSettlement.depositAmountMinor.amountMinor).toBe(585_500);
    });

    it('leaves the USD amounts exactly as they were', async () => {
      await setRate();
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      // USD stays authoritative. The pound figure is decoration on top.
      expect(found.depositAmountMinor).toBe(a.depositAmountMinor);
      expect(found.platformFeeAmountMinor).toBe(a.platformFeeAmountMinor);
      expect(found.businessAmountMinor).toBe(a.businessAmountMinor);
      expect(found.currency).toBe('USD');
    });

    it('attaches it to a freshly created booking', async () => {
      await setRate();

      const created: any = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: futureSlot(6, 8).toISOString(),
      });

      expect(created.approxSettlement.depositAmountMinor.currency).toBe('SSP');
    });
  });

  describe('one rate read per response', () => {
    it('reads the rate exactly once for a whole listing', async () => {
      await setRate();
      await booked();
      await booked();
      await booked();
      const spy = jest.spyOn(settings, 'getExchangeRateForDisplay');

      const list: any = await appointments.findAll(
        customer.userId,
        UserRole.CUSTOMER,
        {},
      );

      expect(list.appointments.length).toBeGreaterThanOrEqual(3);
      // Once, not once per item. A page whose items were converted at
      // different rates would be indefensible to anyone comparing them.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('converts every item in a listing at the same rate', async () => {
      await setRate();
      await booked();
      await booked();

      const list: any = await appointments.findAll(
        customer.userId,
        UserRole.CUSTOMER,
        {},
      );

      const rates = new Set(
        list.appointments.map(
          (a: any) => a.approxSettlement.depositAmountMinor.exchangeRate,
        ),
      );
      expect(rates.size).toBe(1);
    });

    it('reads it once for a single appointment', async () => {
      await setRate();
      const a = await booked();
      const spy = jest.spyOn(settings, 'getExchangeRateForDisplay');

      await appointments.findOne(AS_CUSTOMER(), a.id);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('when there is no rate', () => {
    it('omits the figure entirely rather than showing zero', async () => {
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      // Not zero, not null, not a placeholder — absent.
      expect(found).not.toHaveProperty('approxSettlement');
      expect(found.depositAmountMinor).toBe(a.depositAmountMinor);
    });

    it('omits it from every item in a listing', async () => {
      await booked();
      await booked();

      const list: any = await appointments.findAll(
        customer.userId,
        UserRole.CUSTOMER,
        {},
      );

      expect(
        list.appointments.every((a: any) => a.approxSettlement === undefined),
      ).toBe(true);
    });
  });

  describe('when the rate is stale', () => {
    it('still returns the figure - staleness is an admin problem', async () => {
      await setRate();
      await prisma.platformSetting.update({
        where: { id: PLATFORM_SETTING_ID },
        data: { exchangeRateUpdatedAt: new Date(Date.now() - 200 * HOUR) },
      });
      const a = await booked();

      const found: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      // Surfaced to admins (§37), invisible to customers. Degrading the
      // customer experience over it would punish the wrong person.
      expect((await settings.getExchangeRateStaleness()).stale).toBe(true);
      expect(found.approxSettlement.depositAmountMinor.amountMinor).toBe(585_000);
      // The rate's age is still disclosed, so a client could label it.
      expect(found.approxSettlement.depositAmountMinor.rateAsOf).not.toBeNull();
    });
  });

  describe('it is display only', () => {
    it('changes with the rate and changes nothing stored', async () => {
      await setRate(650);
      const a = await booked();
      const before = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      const first: any = await appointments.findOne(AS_CUSTOMER(), a.id);

      await setRate(1300);
      const second: any = await appointments.findOne(AS_CUSTOMER(), a.id);
      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });

      expect(first.approxSettlement.depositAmountMinor.amountMinor).toBe(585_000);
      expect(second.approxSettlement.depositAmountMinor.amountMinor).toBe(1_170_000);
      // The row is byte-identical: nothing about this figure is persisted.
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    });

    it('never writes an approxSettlement column - there is none', async () => {
      await setRate();
      const a = await booked();
      await appointments.findOne(AS_CUSTOMER(), a.id);

      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'appointments'
      `;
      expect(
        columns.some((c) => c.column_name.toLowerCase().includes('approx')),
      ).toBe(false);
      expect(a.currency).toBe('USD');
    });
  });

  describe('business and admin views are unchanged', () => {
    it('a business member reading one appointment sees no pound figure', async () => {
      await setRate();
      const a = await booked();

      const found: any = await appointments.findOne(business.userId, a.id);

      // A business prices in USD and is paid against USD. An indicative pound
      // figure here would invite reconciling a payout against a number that
      // means nothing.
      expect(found).not.toHaveProperty('approxSettlement');
      expect(found.depositAmountMinor).toBe(a.depositAmountMinor);
    });

    it('a business listing is USD only', async () => {
      await setRate();
      await booked();

      const list: any = await appointments.findAll(
        business.userId,
        UserRole.BUSINESS,
        {},
      );

      expect(
        list.appointments.every((x: any) => x.approxSettlement === undefined),
      ).toBe(true);
    });

    it('a business transition response is USD only', async () => {
      await setRate();
      const a = await booked();

      const noShown: any = await appointments.noShow(business.userId, a.id);

      expect(noShown).not.toHaveProperty('approxSettlement');
    });

    it('a business cancelling sees no pound figure, the customer would', async () => {
      await setRate();
      const forBusiness = await booked();
      const forCustomer = await booked();

      const byBusiness: any = await appointments.cancel(
        business.userId,
        forBusiness.id,
        { reason: 'Closed.' },
      );
      const byCustomer: any = await appointments.cancel(
        customer.userId,
        forCustomer.id,
      );

      // Same route, same method — the figure follows who is reading.
      expect(byBusiness).not.toHaveProperty('approxSettlement');
      expect(byCustomer.approxSettlement.depositAmountMinor.currency).toBe('SSP');
    });
  });

  describe('the charged amount is untouched', () => {
    it('initiateDepositPayment still charges from its own rate read', async () => {
      await setRate(650);
      const a = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      const provider = moduleRef.get<any>(PAYMENT_PROVIDER);
      provider.initiatePayment.mockResolvedValue({
        providerReferenceId: 'ref-charge-1',
        status: 'PENDING',
      });

      const result: any = await appointments.initiateDepositPayment(
        customer.userId,
        a.id,
        { phoneNumber: '256770000000' },
      );

      // 900 USD cents x 650 = 585000 minor units, unrounded to whole pounds —
      // the charge keeps full precision. Only the DISPLAY figure rounds.
      expect(result.providerAmountMinor).toBe(585_000);
      expect(result.exchangeRateUsed).toBe('650.00000000');
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.providerAmountMinor).toBe(585_000);
      expect(Number(row.exchangeRateUsed)).toBe(650);
    });
  });
});
