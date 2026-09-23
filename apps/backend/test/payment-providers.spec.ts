import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppointmentStatus, MobileMoneyProvider } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PaymentsScheduler } from '../src/appointments/payments.scheduler';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PaymentProvider } from '../src/payments/payment-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Talking to more than one mobile money operator (§57).
 *
 * The behaviour under test is unglamorous and load-bearing: a payment reference
 * means something only to the operator that issued it. Ask another and you get
 * "no such transaction" — which is indistinguishable from a real failure, and
 * which the poller acts on by cancelling the booking. So a platform with two
 * operators and no record of which took the money does not merely lose
 * bookkeeping; it cancels paid appointments.
 */
describe('Multiple payment providers (§57)', () => {
  /** A provider that records what it was asked, keyed to a chosen operator. */
  const fakeProvider = (
    key: MobileMoneyProvider,
    configured = true,
  ): PaymentProvider & { checkPaymentStatus: jest.Mock } =>
    ({
      key,
      name: `fake ${key}`,
      isConfigured: () => configured,
      initiatePayment: jest.fn(async () => ({
        providerReferenceId: `ref-${key}`,
        status: 'PENDING' as const,
      })),
      checkPaymentStatus: jest.fn(async () => ({ status: 'PENDING' as const })),
    }) as never;

  // ==================================================================
  describe('the registry only offers operators that are actually usable', () => {
    it('lists the configured ones', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
        fakeProvider(MobileMoneyProvider.AIRTEL_MONEY),
      ]);

      expect(registry.available().sort()).toEqual(
        [MobileMoneyProvider.AIRTEL_MONEY, MobileMoneyProvider.MTN_MOMO].sort(),
      );
    });

    it('leaves out one whose credentials are missing', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
        fakeProvider(MobileMoneyProvider.AIRTEL_MONEY, false),
      ]);

      expect(registry.available()).toEqual([MobileMoneyProvider.MTN_MOMO]);
      expect(registry.isAvailable(MobileMoneyProvider.AIRTEL_MONEY)).toBe(false);
    });

    it('returns the operator asked for, not merely the first one', () => {
      const airtel = fakeProvider(MobileMoneyProvider.AIRTEL_MONEY);
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
        airtel,
      ]);

      expect(registry.require(MobileMoneyProvider.AIRTEL_MONEY)).toBe(airtel);
    });

    it('refuses an unavailable operator, and says what IS accepted', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
      ]);

      // A 503, not a 400: the customer's Airtel number is perfectly valid and
      // the reason it cannot be served is on the platform's side.
      expect(() => registry.require(MobileMoneyProvider.AIRTEL_MONEY)).toThrow(
        ServiceUnavailableException,
      );
      expect(() => registry.require(MobileMoneyProvider.AIRTEL_MONEY)).toThrow(
        /Currently accepted: MTN_MOMO/,
      );
    });

    it('a platform with no configured provider refuses rather than pretending', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO, false),
      ]);

      expect(() => registry.requireOnlyOne()).toThrow(/No payment provider is configured/);
    });
  });

  // ==================================================================
  describe('with two operators, one is never picked by default', () => {
    it('refuses to guess', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
        fakeProvider(MobileMoneyProvider.AIRTEL_MONEY),
      ]);

      // Defaulting here charges the wrong network roughly half the time, and
      // silently. Refusing forces the choice to be made from the customer's
      // number instead (§58).
      expect(() => registry.requireOnlyOne()).toThrow(/has to be chosen rather than defaulted/);
    });

    it('resolves without complaint while only one is configured', () => {
      const registry = new PaymentProviderRegistry([
        fakeProvider(MobileMoneyProvider.MTN_MOMO),
        fakeProvider(MobileMoneyProvider.AIRTEL_MONEY, false),
      ]);

      expect(registry.requireOnlyOne().key).toBe(MobileMoneyProvider.MTN_MOMO);
    });
  });

  // ==================================================================
  /**
   * The reason the column exists. Named so nobody deletes it.
   */
  describe('a payment is polled against the operator that took it', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let scheduler: PaymentsScheduler;
    let mtn: PaymentProvider & { checkPaymentStatus: jest.Mock };
    let airtel: PaymentProvider & { checkPaymentStatus: jest.Mock };
    let business: TestBusiness;
    let customer: { userId: string; email: string };

    beforeAll(async () => {
      mtn = fakeProvider(MobileMoneyProvider.MTN_MOMO);
      airtel = fakeProvider(MobileMoneyProvider.AIRTEL_MONEY);

      moduleRef = await createTestModule([
        AppointmentsService,
        AvailabilityService,
        PaymentsScheduler,
        PlatformSettingsService,
        commonStubs.mail(),
        commonStubs.notifications(),
        commonStubs.chat(),
        {
          provide: PaymentProviderRegistry,
          useValue: new PaymentProviderRegistry([mtn, airtel]),
        },
      ]);
      prisma = moduleRef.get(PrismaService);
      scheduler = moduleRef.get(PaymentsScheduler);
      await resetDatabase(prisma);
      business = await createBusiness(prisma);
      customer = await createCustomer(prisma);
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    beforeEach(() => {
      mtn.checkPaymentStatus.mockClear();
      airtel.checkPaymentStatus.mockClear();
    });

    const pendingPayment = async (provider: MobileMoneyProvider, reference: string) => {
      const appointment = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      return prisma.appointment.update({
        where: { id: appointment.id },
        data: { paymentProvider: provider, paymentProviderReferenceId: reference },
      });
    };

    it('asks Airtel about an Airtel reference, and never asks MTN', async () => {
      await pendingPayment(MobileMoneyProvider.AIRTEL_MONEY, 'airtel-ref-1');

      await scheduler.pollPendingPayments();

      expect(airtel.checkPaymentStatus).toHaveBeenCalledWith('airtel-ref-1');
      expect(mtn.checkPaymentStatus).not.toHaveBeenCalled();
    });

    it('asks MTN about an MTN reference, and never asks Airtel', async () => {
      await prisma.appointment.deleteMany({});
      await pendingPayment(MobileMoneyProvider.MTN_MOMO, 'mtn-ref-1');

      await scheduler.pollPendingPayments();

      expect(mtn.checkPaymentStatus).toHaveBeenCalledWith('mtn-ref-1');
      expect(airtel.checkPaymentStatus).not.toHaveBeenCalled();
    });

    it('routes each appointment in a mixed sweep to its own operator', async () => {
      await prisma.appointment.deleteMany({});
      await pendingPayment(MobileMoneyProvider.MTN_MOMO, 'mtn-ref-2');
      await pendingPayment(MobileMoneyProvider.AIRTEL_MONEY, 'airtel-ref-2');

      await scheduler.pollPendingPayments();

      expect(mtn.checkPaymentStatus).toHaveBeenCalledTimes(1);
      expect(mtn.checkPaymentStatus).toHaveBeenCalledWith('mtn-ref-2');
      expect(airtel.checkPaymentStatus).toHaveBeenCalledTimes(1);
      expect(airtel.checkPaymentStatus).toHaveBeenCalledWith('airtel-ref-2');
    });

    it('one operator being down does not stop the other being polled', async () => {
      await prisma.appointment.deleteMany({});
      await pendingPayment(MobileMoneyProvider.MTN_MOMO, 'mtn-ref-3');
      await pendingPayment(MobileMoneyProvider.AIRTEL_MONEY, 'airtel-ref-3');
      mtn.checkPaymentStatus.mockRejectedValueOnce(new Error('MTN is down') as never);

      await expect(scheduler.pollPendingPayments()).resolves.toBeDefined();

      expect(airtel.checkPaymentStatus).toHaveBeenCalledWith('airtel-ref-3');
    });
  });
});
