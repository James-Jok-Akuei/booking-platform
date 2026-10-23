import { jest } from '@jest/globals';
import { AppointmentStatus, MobileMoneyProvider, NotificationType, RefundReason, RefundStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsScheduler } from '../src/appointments/appointments.scheduler';
import { DisbursementProviderRegistry } from '../src/payments/disbursement-provider.registry';
import type {
  DisbursementProvider,
  SendTransferResult,
  TransferStatusResult,
} from '../src/payments/disbursement-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { REFUND_ATTEMPTS, RefundsService } from '../src/refunds/refunds.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, asUser, createAdmin, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * Deposits going back (§313): sent to the number that paid, once, checked
 * until the operator answers; three refusals and our team takes over.
 */
describe('Refunds, sent (§313)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refunds: RefundsService;
  let provider: DisbursementProvider & { sendTransfer: jest.Mock; checkTransferStatus: jest.Mock };
  let business: TestBusiness;
  let customer: { userId: string };
  let admin: { userId: string };

  beforeAll(async () => {
    provider = {
      key: MobileMoneyProvider.MTN_MOMO,
      name: 'fake disbursement',
      isConfigured: () => true,
      sendTransfer: jest.fn(async () => ({ status: 'ACCEPTED' }) as SendTransferResult),
      checkTransferStatus: jest.fn(async () => ({ status: 'PENDING' }) as TransferStatusResult),
    } as never;
    moduleRef = await createTestModule([
      AppointmentsScheduler,
      commonStubs.notifications(),
      { provide: DisbursementProviderRegistry, useValue: new DisbursementProviderRegistry([provider]) },
    ]);
    prisma = moduleRef.get(PrismaService);
    refunds = moduleRef.get(RefundsService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);
    admin = await createAdmin(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    provider.sendTransfer.mockClear();
    provider.checkTransferStatus.mockClear();
    await prisma.refund.deleteMany({});
  });

  /** A refund owed on a paid booking, with the number that paid it. */
  const owed = async (phoneNumber: string | null = '250788123456') => {
    const a = await createAppointment(prisma, { business, customerId: customer.userId, status: AppointmentStatus.CANCELLED });
    await prisma.appointment.update({
      where: { id: a.id },
      data: {
        depositPaidAt: new Date(),
        providerAmountMinor: 1400,
        providerCurrency: 'RWF',
        paymentPhoneNumber: phoneNumber,
        paymentProvider: MobileMoneyProvider.MTN_MOMO,
      },
    });
    return prisma.$transaction((tx) => refunds.owe(tx, a.id, RefundReason.CANCELLED_IN_TIME));
  };

  it('owes exactly what was paid, in the currency it was paid in, to the number that paid', async () => {
    const r = await owed();
    expect(r).toMatchObject({ amountMinor: 1400, currency: 'RWF', phoneNumber: '250788123456', status: RefundStatus.PENDING });
  });

  it('sends it once, then records the operator’s answer', async () => {
    const r = await owed();
    await refunds.sendDue();
    await refunds.sendDue();
    expect(provider.sendTransfer).toHaveBeenCalledTimes(1);
    expect(provider.sendTransfer.mock.calls[0][0]).toMatchObject({ msisdn: '250788123456', amountMinor: 1400, currency: 'RWF' });
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ status: RefundStatus.SENDING, attempts: 1 });

    provider.checkTransferStatus.mockResolvedValueOnce({ status: 'SUCCESSFUL', providerReference: 'MTN-123' } as never);
    await refunds.pollInFlight();
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ status: RefundStatus.SENT, reference: 'MTN-123' });
  });

  it('after three refusals, waits for our team — who can try again, or send it by hand', async () => {
    const r = await owed();
    provider.sendTransfer.mockResolvedValue({ status: 'FAILED', failureReason: 'Not enough in the account' } as never);
    for (let i = 0; i < REFUND_ATTEMPTS + 1; i++) await refunds.sendDue();
    expect(provider.sendTransfer).toHaveBeenCalledTimes(REFUND_ATTEMPTS);
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ status: RefundStatus.FAILED });
    provider.sendTransfer.mockResolvedValue({ status: 'ACCEPTED' } as never);

    await refunds.retry(asUser(admin.userId, 'ADMIN'), r!.id);
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ status: RefundStatus.SENDING });
  });

  it('one on a network we cannot send through goes straight to our team', async () => {
    const r = await owed();
    await prisma.refund.update({ where: { id: r!.id }, data: { provider: MobileMoneyProvider.AIRTEL_MONEY } });
    await refunds.sendDue();
    expect(provider.sendTransfer).not.toHaveBeenCalled();
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ status: RefundStatus.FAILED });
  });

  it('one with no number on record is sent by hand, and marked so', async () => {
    const r = await owed(null);
    await refunds.sendDue();
    expect(provider.sendTransfer).not.toHaveBeenCalled();
    await expect(refunds.retry(asUser(admin.userId, 'ADMIN'), r!.id)).rejects.toThrow(/no number/);
    await refunds.markSent(asUser(admin.userId, 'ADMIN'), r!.id, { reference: 'Sent from the MTN portal', phoneNumber: '0788 123 456' });
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({
      status: RefundStatus.SENT,
      phoneNumber: '0788123456',
      sentByUserId: admin.userId,
    });
  });

  it('a booking missed by itself, a day after its end, is said to the customer', async () => {
    const a = await createAppointment(prisma, { business, customerId: customer.userId, status: AppointmentStatus.BOOKED });
    await prisma.appointment.update({
      where: { id: a.id },
      data: { startTime: new Date(Date.now() - 30 * 3_600_000), endTime: new Date(Date.now() - 29 * 3_600_000) },
    });
    const notifications = moduleRef.get(NotificationsService) as unknown as { notify: jest.Mock };
    notifications.notify.mockClear();
    await moduleRef.get(AppointmentsScheduler).runAutoTransitions();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: customer.userId, type: NotificationType.APPOINTMENT_NO_SHOW, context: expect.objectContaining({ automatic: true }) }),
    );
  });
});
