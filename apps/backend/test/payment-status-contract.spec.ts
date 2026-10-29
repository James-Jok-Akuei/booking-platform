import { jest } from '@jest/globals';
import { AppointmentStatus, MobileMoneyProvider } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  commonStubs,
  createTestModule,
  paymentProviderStub,
  resetDatabase,
} from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * The exact field names of the two payment replies (§109).
 *
 * This exists because the customer app polled `payment-status` with a
 * hand-written interface in which EVERY field name was wrong — `status` for
 * `appointmentStatus`, `depositPaidAt` and `paymentInitiatedAt` for fields that
 * were never there. It read `undefined` for all of them and therefore never
 * noticed a deposit being paid. Nothing failed: not a type, not a test, not a
 * request.
 *
 * So the names are asserted here, as names. A test that only checked values
 * would have passed throughout, which is precisely the problem.
 *
 * Both endpoints now return a DTO and the contract describes them, so a client
 * can generate its types instead of guessing — but the DTO can still be edited,
 * and three apps read these two shapes.
 */
describe('Payment reply shapes (§109)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let provider: ReturnType<typeof paymentProviderStub>;

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
    provider.initiatePayment.mockResolvedValue({
      providerReferenceId: 'reference-from-the-operator',
      status: 'PENDING',
    });
    provider.checkPaymentStatus.mockResolvedValue({ status: 'PENDING' });
  });

  const pending = () =>
    createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.PENDING_PAYMENT,
      providerCharge: null,
    });

  const status = (appointmentId: string) =>
    appointments.getPaymentStatus(customer.userId, appointmentId);

  it('initiating replies with every field a client needs to show the amount', async () => {
    const appointment = await pending();

    const reply = await appointments.initiateDepositPayment(
      customer.userId,
      appointment.id,
      '250788123456',
    );

    expect(Object.keys(reply).sort()).toEqual([
      'appointmentId',
      'currency',
      'depositAmountMinor',
      'exchangeRateUsed',
      'message',
      'paymentStatus',
      'providerAmountMinor',
      'providerCurrency',
      'providerReferenceId',
      'status',
    ]);
    // A 200 means the request was ACCEPTED, never that money moved.
    expect(reply.paymentStatus).toBe('PENDING');
    expect(reply.status).toBe(AppointmentStatus.PENDING_PAYMENT);
  });

  it('says NOT_STARTED before anything has been asked of the handset', async () => {
    const appointment = await pending();

    const reply = await status(appointment.id);

    expect(Object.keys(reply).sort()).toEqual([
      'appointmentId',
      'appointmentStatus',
      'paymentStatus',
      'providerReferenceId',
    ]);
    expect(reply.paymentStatus).toBe('NOT_STARTED');
    expect(reply.providerReferenceId).toBeNull();
  });

  it('names the appointment status and the payment status separately', async () => {
    const appointment = await pending();
    await appointments.initiateDepositPayment(
      customer.userId,
      appointment.id,
      '250788123456',
    );

    const reply = await status(appointment.id);

    // The two must never be one field: the appointment is alive while the
    // payment is in flight, and a client that conflated them would release a
    // held slot.
    expect(reply.appointmentStatus).toBe(AppointmentStatus.PENDING_PAYMENT);
    expect(reply.paymentStatus).toBe('PENDING');
    expect(reply.providerReferenceId).toBe('reference-from-the-operator');
  });

  it('a paid deposit says SUCCESSFUL, and the appointment has moved on', async () => {
    const appointment = await pending();
    await appointments.initiateDepositPayment(
      customer.userId,
      appointment.id,
      '250788123456',
    );
    provider.checkPaymentStatus.mockResolvedValue({ status: 'SUCCESSFUL' });

    const reply = await status(appointment.id);

    expect(reply.paymentStatus).toBe('SUCCESSFUL');
    expect(reply.appointmentStatus).toBe(AppointmentStatus.BOOKED);

    // Asked again once there is nothing left in flight, the reply is still the
    // same shape — the customer app keeps this query mounted after paying.
    provider.checkPaymentStatus.mockResolvedValue({ status: 'PENDING' });
    const settled = await status(appointment.id);
    expect(settled.paymentStatus).toBe('SUCCESSFUL');
    expect(settled.appointmentStatus).toBe(AppointmentStatus.BOOKED);
  });

  it('a failed deposit clears the reference and keeps the slot, so a retry works', async () => {
    const appointment = await pending();
    await appointments.initiateDepositPayment(
      customer.userId,
      appointment.id,
      '250788123456',
    );
    // What MTN's sandbox actually returns for payer 46733123451, confirmed
    // against it rather than invented (§109.3).
    provider.checkPaymentStatus.mockResolvedValue({
      status: 'FAILED',
      failureReason: 'FAILED: APPROVAL_REJECTED',
    });

    const reply = await status(appointment.id);

    expect(reply.paymentStatus).toBe('FAILED');
    // Still holdable. A failure is not a cancellation.
    expect(reply.appointmentStatus).toBe(AppointmentStatus.PENDING_PAYMENT);
    // Null is what tells a client to offer the payment again (§57.3).
    expect(reply.providerReferenceId).toBeNull();
    expect(reply.failureReason).toBe('FAILED: APPROVAL_REJECTED');

    // And the retry is genuinely accepted, not refused as a duplicate attempt.
    const retried = await appointments.initiateDepositPayment(
      customer.userId,
      appointment.id,
      '250788123456',
    );
    expect(retried.paymentStatus).toBe('PENDING');
  });
});
