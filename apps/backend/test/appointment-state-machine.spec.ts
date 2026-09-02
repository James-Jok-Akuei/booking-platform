import { AppointmentStatus, CancelledBy, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  KNOWN_VERIFICATION_CODE,
  TestBusiness,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * The state machine is what stands between "the business says the job is done"
 * and "the customer confirmed they turned up" (§16.2). Each test names the
 * exact transition it guards, so a failure says which rule broke.
 */
describe('Appointment state machine (§16.1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let business: TestBusiness;
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
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const make = (status: AppointmentStatus, verified = false) =>
    createAppointment(prisma, { business, customerId: customer.userId, status, verified });

  describe('COMPLETED requires verification and has no bypass', () => {
    it('rejects complete() directly from BOOKED — the hard gate', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      await expect(appointments.complete(business.userId, a.id)).rejects.toThrow(
        /has not been verified yet/,
      );
    });

    it('rejects complete() from PENDING_PAYMENT', async () => {
      const a = await make(AppointmentStatus.PENDING_PAYMENT);

      await expect(appointments.complete(business.userId, a.id)).rejects.toThrow(
        /Only an IN_PROGRESS appointment can be completed/,
      );
    });

    it('leaves the appointment BOOKED after a refused completion', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      await expect(appointments.complete(business.userId, a.id)).rejects.toThrow();

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.status).toBe(AppointmentStatus.BOOKED);
      expect(after.completedAt).toBeNull();
    });

    it('allows complete() from IN_PROGRESS, and stamps completedAt', async () => {
      const a = await make(AppointmentStatus.IN_PROGRESS, true);

      const done = await appointments.complete(business.userId, a.id);

      expect(done.status).toBe(AppointmentStatus.COMPLETED);
      expect(done.completedAt).not.toBeNull();
    });

    it('COMPLETED is never reachable without a verifiedAt on the record', async () => {
      // Drive the only supported route: BOOKED -> verify -> IN_PROGRESS -> COMPLETED.
      const a = await make(AppointmentStatus.BOOKED);
      await appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE);
      await appointments.complete(business.userId, a.id);

      const final = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(final.status).toBe(AppointmentStatus.COMPLETED);
      expect(final.verifiedAt).not.toBeNull();
    });

    it('every COMPLETED appointment in the database carries a verifiedAt', async () => {
      const completedWithoutVerification = await prisma.appointment.count({
        where: { status: AppointmentStatus.COMPLETED, verifiedAt: null },
      });

      expect(completedWithoutVerification).toBe(0);
    });
  });

  describe('verify() moves BOOKED -> IN_PROGRESS only', () => {
    it('accepts the correct code from BOOKED', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE);

      expect(result.status).toBe(AppointmentStatus.IN_PROGRESS);
      expect(result.verifiedAt).not.toBeNull();
    });

    it('rejects a wrong code and does not advance the status', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      await expect(appointments.verify(business.userId, a.id, '000000')).rejects.toThrow(
        /Incorrect verification code/,
      );

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.status).toBe(AppointmentStatus.BOOKED);
      expect(after.verifiedAt).toBeNull();
      expect(after.verificationAttempts).toBe(1);
    });

    it('rejects verification from PENDING_PAYMENT', async () => {
      const a = await make(AppointmentStatus.PENDING_PAYMENT);

      await expect(
        appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE),
      ).rejects.toThrow(/Only a BOOKED appointment can be verified/);
    });

    it('rejects verification from IN_PROGRESS (already verified)', async () => {
      const a = await make(AppointmentStatus.IN_PROGRESS, true);

      await expect(
        appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE),
      ).rejects.toThrow(/Only a BOOKED appointment can be verified/);
    });

    it('locks the code after five wrong attempts', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      for (let i = 0; i < 5; i++) {
        await expect(appointments.verify(business.userId, a.id, '999999')).rejects.toThrow();
      }

      // The sixth is refused for being locked, not for being wrong — and the
      // CORRECT code no longer works either.
      await expect(
        appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE),
      ).rejects.toThrow(/Too many incorrect attempts/);
    });
  });

  describe('NO_SHOW is reachable only from BOOKED', () => {
    it('allows no-show from BOOKED and stamps noShowAt', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.noShow(business.userId, a.id);

      expect(result.status).toBe(AppointmentStatus.NO_SHOW);
      expect(result.noShowAt).not.toBeNull();
    });

    it('rejects no-show from IN_PROGRESS — verification proves they arrived', async () => {
      const a = await make(AppointmentStatus.IN_PROGRESS, true);

      await expect(appointments.noShow(business.userId, a.id)).rejects.toThrow(
        /already verified, so it cannot be marked a no-show/,
      );
    });

    it('rejects no-show from PENDING_PAYMENT', async () => {
      const a = await make(AppointmentStatus.PENDING_PAYMENT);

      await expect(appointments.noShow(business.userId, a.id)).rejects.toThrow(
        /Only a BOOKED appointment can be marked as a no-show/,
      );
    });

    it('rejects no-show from COMPLETED', async () => {
      const a = await make(AppointmentStatus.COMPLETED, true);

      await expect(appointments.noShow(business.userId, a.id)).rejects.toThrow(
        /Only a BOOKED appointment can be marked as a no-show/,
      );
    });

    it('rejects no-show from CANCELLED', async () => {
      const a = await make(AppointmentStatus.CANCELLED);

      await expect(appointments.noShow(business.userId, a.id)).rejects.toThrow(
        /Only a BOOKED appointment can be marked as a no-show/,
      );
    });
  });

  describe('CANCELLED is reachable only from PENDING_PAYMENT or BOOKED', () => {
    it('allows cancellation from PENDING_PAYMENT', async () => {
      const a = await make(AppointmentStatus.PENDING_PAYMENT);

      const result = await appointments.cancel(customer.userId, a.id);

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(result.cancelledAt).not.toBeNull();
    });

    it('allows cancellation from BOOKED', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.cancel(customer.userId, a.id);

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('allows the business to cancel, not only the customer', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      // A reason is now required of a business, and only of a business (§33).
      const result = await appointments.cancel(business.userId, a.id, {
        reason: 'The stylist is ill.',
      });

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('rejects cancellation from IN_PROGRESS — the service is under way', async () => {
      const a = await make(AppointmentStatus.IN_PROGRESS, true);

      await expect(appointments.cancel(customer.userId, a.id)).rejects.toThrow(
        /Only a PENDING_PAYMENT or BOOKED appointment can be cancelled/,
      );
    });

    it('rejects cancellation from COMPLETED', async () => {
      const a = await make(AppointmentStatus.COMPLETED, true);

      await expect(appointments.cancel(customer.userId, a.id)).rejects.toThrow(
        /Only a PENDING_PAYMENT or BOOKED appointment can be cancelled/,
      );
    });

    it('rejects cancellation from NO_SHOW', async () => {
      const a = await make(AppointmentStatus.NO_SHOW);

      await expect(appointments.cancel(customer.userId, a.id)).rejects.toThrow(
        /Only a PENDING_PAYMENT or BOOKED appointment can be cancelled/,
      );
    });

    it('rejects cancelling an already CANCELLED appointment', async () => {
      const a = await make(AppointmentStatus.CANCELLED);

      await expect(appointments.cancel(customer.userId, a.id)).rejects.toThrow(
        /Only a PENDING_PAYMENT or BOOKED appointment can be cancelled/,
      );
    });
  });

  describe('terminal states accept nothing', () => {
    const terminal = [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
    ];

    it.each(terminal)('%s rejects complete()', async (status) => {
      const a = await make(status, status === AppointmentStatus.COMPLETED);

      await expect(appointments.complete(business.userId, a.id)).rejects.toThrow();
    });

    it.each(terminal)('%s rejects verify()', async (status) => {
      const a = await make(status, status === AppointmentStatus.COMPLETED);

      await expect(
        appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE),
      ).rejects.toThrow();
    });

    it.each(terminal)('%s rejects cancel()', async (status) => {
      const a = await make(status, status === AppointmentStatus.COMPLETED);

      await expect(appointments.cancel(customer.userId, a.id)).rejects.toThrow();
    });

    it.each(terminal)('%s rejects no-show()', async (status) => {
      const a = await make(status, status === AppointmentStatus.COMPLETED);

      await expect(appointments.noShow(business.userId, a.id)).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------
  // Who cancelled, and whether the deposit was ever paid (§33)
  // ------------------------------------------------------------------

  describe('cancellation attribution', () => {
    const row = (id: string) =>
      prisma.appointment.findUniqueOrThrow({ where: { id } });

    it('records CUSTOMER and the acting user when the customer cancels', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.cancel(customer.userId, a.id);

      expect(result.cancelledBy).toBe(CancelledBy.CUSTOMER);
      expect(result.cancelledByUserId).toBe(customer.userId);
      const stored = await row(a.id);
      expect(stored.cancelledBy).toBe(CancelledBy.CUSTOMER);
      expect(stored.cancelledByUserId).toBe(customer.userId);
    });

    it('records BUSINESS and the acting user when a business member cancels', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.cancel(business.userId, a.id, {
        reason: 'Double booked.',
      });

      expect(result.cancelledBy).toBe(CancelledBy.BUSINESS);
      expect(result.cancelledByUserId).toBe(business.userId);
      expect(result.cancellationReason).toBe('Double booked.');
    });

    it('rejects a business cancellation with no reason, and writes nothing', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      await expect(appointments.cancel(business.userId, a.id)).rejects.toThrow(
        /reason is required/,
      );

      // Refused before the update, not after it.
      const stored = await row(a.id);
      expect(stored.status).toBe(AppointmentStatus.BOOKED);
      expect(stored.cancelledBy).toBeNull();
      expect(stored.cancelledAt).toBeNull();
    });

    it('accepts a customer cancellation with no reason', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.cancel(customer.userId, a.id);

      // A customer calling off their own booking owes nobody an explanation.
      expect(result.cancelledBy).toBe(CancelledBy.CUSTOMER);
      expect(result.cancellationReason).toBeNull();
    });

    it('keeps a customer reason when one is given', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      const result = await appointments.cancel(customer.userId, a.id, {
        reason: 'Travelling that week.',
      });

      expect(result.cancellationReason).toBe('Travelling that week.');
    });

    it('lets cancelledBy and cancelledByUserId differ - the admin-resolved case', async () => {
      const admin = await createAdmin(prisma);
      const ticket = await prisma.ticket.create({
        data: {
          reference: `TKT-CANCEL-${Date.now()}`,
          reporterId: customer.userId,
          reporterType: 'CUSTOMER',
          category: 'APPOINTMENT_DISPUTE',
          subject: 'The shop was closed when I arrived',
          lastMessageAt: new Date(),
        },
      });
      const a = await make(AppointmentStatus.BOOKED);
      await appointments.cancel(customer.userId, a.id);

      // What an admin reclassification writes: the BUSINESS bears it, the
      // ADMIN performed it, and the ticket says why. The refund module reads
      // cancelledBy; the audit trail reads the other two.
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          cancelledBy: CancelledBy.BUSINESS,
          cancelledByUserId: admin.userId,
          cancellationReason: 'Business did not open. Reclassified on dispute.',
          cancellationTicketId: ticket.id,
        },
      });

      const stored = await row(a.id);
      expect(stored.cancelledBy).toBe(CancelledBy.BUSINESS);
      expect(stored.cancelledByUserId).toBe(admin.userId);
      expect(stored.cancelledByUserId).not.toBe(customer.userId);
      expect(stored.cancellationTicketId).toBe(ticket.id);
    });

    it('refuses a member of another business - 404, not 403', async () => {
      const other = await createBusiness(prisma);
      const a = await make(AppointmentStatus.BOOKED);

      await expect(
        appointments.cancel(other.userId, a.id, { reason: 'Not mine to cancel.' }),
      ).rejects.toThrow(/Appointment not found/);

      const stored = await row(a.id);
      expect(stored.status).toBe(AppointmentStatus.BOOKED);
      expect(stored.cancelledBy).toBeNull();
    });
  });

  describe('depositPaidAt survives every later transition', () => {
    /** A PENDING_PAYMENT appointment with a payment in flight. */
    const withPaymentInFlight = async (reference: string) => {
      const a = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      await prisma.appointment.update({
        where: { id: a.id },
        data: { paymentProviderReferenceId: reference, paymentInitiatedAt: new Date() },
      });
      return a;
    };

    it('is set when the provider confirms the deposit', async () => {
      const a = await withPaymentInFlight('ref-confirm-1');

      await appointments.applyPaymentResult(a.id, 'ref-confirm-1', 'SUCCESSFUL');

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(stored.status).toBe(AppointmentStatus.BOOKED);
      expect(stored.depositPaidAt).not.toBeNull();
    });

    it('survives cancellation - the row still says the money arrived', async () => {
      const a = await withPaymentInFlight('ref-confirm-2');
      await appointments.applyPaymentResult(a.id, 'ref-confirm-2', 'SUCCESSFUL');
      const paidAt = (await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } }))
        .depositPaidAt;

      await appointments.cancel(customer.userId, a.id);

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(stored.status).toBe(AppointmentStatus.CANCELLED);
      // The exact case status alone could never answer.
      expect(stored.depositPaidAt).toEqual(paidAt);
    });

    it('survives completion', async () => {
      const a = await withPaymentInFlight('ref-confirm-3');
      await appointments.applyPaymentResult(a.id, 'ref-confirm-3', 'SUCCESSFUL');
      await prisma.appointment.update({
        where: { id: a.id },
        data: { status: AppointmentStatus.IN_PROGRESS, verifiedAt: new Date() },
      });

      await appointments.complete(business.userId, a.id);

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(stored.status).toBe(AppointmentStatus.COMPLETED);
      expect(stored.depositPaidAt).not.toBeNull();
    });

    it('stays null on an appointment that was never paid', async () => {
      const a = await make(AppointmentStatus.BOOKED);

      await appointments.cancel(customer.userId, a.id);

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(stored.depositPaidAt).toBeNull();
    });
  });
});
