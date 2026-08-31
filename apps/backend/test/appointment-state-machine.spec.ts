import { AppointmentStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  KNOWN_VERIFICATION_CODE,
  TestBusiness,
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

      const result = await appointments.cancel(business.userId, a.id);

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
});
