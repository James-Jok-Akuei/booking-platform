import { jest } from '@jest/globals';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  MobileMoneyProvider,
  NotificationType,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * What a customer and an admin are each told when a payment cannot start (§52).
 *
 * The distinction under test is whose fault it is. Before this, a platform
 * misconfiguration and a busy provider were indistinguishable to everyone: the
 * customer got "Provider rejected the request (HTTP 500)" for both, and the
 * actual cause lived only in a server log a support agent could not see.
 */
describe('Payment failures (§52)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let provider: { initiatePayment: jest.Mock };
  let notifications: { notify: { mock: { calls: any[][] } } };

  let business: TestBusiness;
  let customer: { userId: string; email: string };

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
    provider = moduleRef
      .get(PaymentProviderRegistry)
      .require(MobileMoneyProvider.MTN_MOMO) as never;
    notifications = moduleRef.get(NotificationsService) as never;
    await resetDatabase(prisma);
    await moduleRef
      .get(PlatformSettingsService)
      .setExchangeRate(650, 'SSP', { role: 'ADMIN' });
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => {
    notifications.notify.mock.calls.length = 0;
  });

  const pending = () =>
    createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.PENDING_PAYMENT,
      providerCharge: null,
    });

  const initiate = (appointmentId: string) =>
    appointments.initiateDepositPayment(customer.userId, appointmentId, '256770000000');

  describe('a CONFIGURATION failure', () => {
    beforeEach(() => {
      provider.initiatePayment.mockResolvedValue({
        providerReferenceId: '',
        status: 'FAILED',
        failureKind: 'CONFIGURATION',
        failureReason: 'Provider rejected the request (HTTP 500): INVALID_CURRENCY.',
      });
    });

    it('tells the customer it is temporary and that they were not charged', async () => {
      const appointment = await pending();

      const error = await initiate(appointment.id).catch((e) => e);

      // 503, not 400: the customer did nothing wrong.
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toMatch(/temporarily unavailable/i);
      expect(error.message).toMatch(/NOT been charged/i);
      // The provider's own code is a platform detail, not a customer's problem.
      expect(error.message).not.toMatch(/INVALID_CURRENCY/);
      expect(error.message).not.toMatch(/HTTP 500/);
    });

    it('notifies every admin, with the real cause', async () => {
      const first = await prisma.user.create({
        data: { email: `admin-a-${Date.now()}@example.com`, role: 'ADMIN' },
      });
      const second = await prisma.user.create({
        data: { email: `admin-b-${Date.now()}@example.com`, role: 'ADMIN' },
      });
      const appointment = await pending();

      await initiate(appointment.id).catch(() => undefined);

      const calls = notifications.notify.mock.calls.filter(
        (c) => c[0].type === NotificationType.PAYMENT_PROVIDER_MISCONFIGURED,
      );
      expect(calls.map((c) => c[0].recipientId)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
      // The cause a support agent could not previously see.
      expect(calls[0][0].context.reason).toMatch(/INVALID_CURRENCY/);
      expect(calls[0][0].context.reason).toMatch(appointment.id);
    });

    it('leaves the appointment held and unpaid', async () => {
      const appointment = await pending();

      await initiate(appointment.id).catch(() => undefined);

      const row = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      // The slot is still theirs. Nothing was charged and nothing was released.
      expect(row.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      expect(row.paymentProviderReferenceId).toBeNull();
      expect(row.depositPaidAt).toBeNull();
    });
  });

  describe('a TRANSIENT failure', () => {
    beforeEach(() => {
      provider.initiatePayment.mockResolvedValue({
        providerReferenceId: '',
        status: 'FAILED',
        failureKind: 'TRANSIENT',
        failureReason: 'Provider rejected the request (HTTP 503): no code given.',
      });
    });

    it('asks the customer to try again, and says they were not charged', async () => {
      const appointment = await pending();

      const error = await initiate(appointment.id).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/try again/i);
      expect(error.message).toMatch(/not been charged/i);
    });

    it('does NOT notify admins — nobody needs waking for a busy provider', async () => {
      await prisma.user.create({
        data: { email: `admin-c-${Date.now()}@example.com`, role: 'ADMIN' },
      });
      const appointment = await pending();

      await initiate(appointment.id).catch(() => undefined);

      expect(
        notifications.notify.mock.calls.filter(
          (c) => c[0].type === NotificationType.PAYMENT_PROVIDER_MISCONFIGURED,
        ),
      ).toHaveLength(0);
    });
  });

  describe('an unclassified failure behaves like a transient one', () => {
    it('does not notify admins when the provider gave no kind', async () => {
      provider.initiatePayment.mockResolvedValue({
        providerReferenceId: '',
        status: 'FAILED',
        failureReason: 'Something went wrong.',
      });
      const appointment = await pending();

      const error = await initiate(appointment.id).catch((e) => e);

      // Defaulting to "wake the admins" would make every provider blip an alarm.
      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        notifications.notify.mock.calls.filter(
          (c) => c[0].type === NotificationType.PAYMENT_PROVIDER_MISCONFIGURED,
        ),
      ).toHaveLength(0);
    });
  });
});
