import { AppointmentStatus, NotificationType, UserRole, VerificationMethod } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import {
  AppointmentsService,
  MAX_VERIFICATION_CODE_SENDS,
} from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { MailService } from '../src/mail/mail.service';
import { NotificationsService } from '../src/notifications/notifications.service';
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
 * Resending an arrival code, showing it to the customer, and verifying without
 * it (§54).
 *
 * The three parts are one feature: the code exists so that a business cannot
 * complete an appointment on its own say-so (§16.2), and each of these changes
 * bends that rule somewhere. The tests below are mostly about where it does NOT
 * bend — the business still cannot summon a code, still cannot read one, and
 * still cannot verify without leaving a name against it.
 */
describe('Arrival codes: resend, display, manual verification (§54)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let mail: { sendAppointmentVerificationEmail: jest.Mock };
  let notifications: { notify: jest.Mock };
  let business: TestBusiness;
  let other: TestBusiness;
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
    mail = moduleRef.get(MailService);
    notifications = moduleRef.get(NotificationsService);

    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    other = await createBusiness(prisma);
    customer = await createCustomer(prisma);
    await createAdmin(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => {
    mail.sendAppointmentVerificationEmail.mockClear();
    notifications.notify.mockClear();
  });

  const booked = () =>
    createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.BOOKED,
    });

  /** The code handed to the mail service by the most recent send. */
  const emailedCode = (): string => {
    const calls = mail.sendAppointmentVerificationEmail.mock.calls;
    return calls[calls.length - 1][1] as string;
  };

  // ==================================================================
  describe('resend issues a new code and retires the old one (§54.1)', () => {
    it('emails a different code, and the previous one stops working', async () => {
      const a = await booked();

      await appointments.resendVerificationCode(customer.userId, a.id);
      const fresh = emailedCode();

      expect(fresh).not.toBe(KNOWN_VERIFICATION_CODE);

      // The whole point of the decision: one live code, never two.
      await expect(
        appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE),
      ).rejects.toThrow(/Incorrect verification code/);

      const verified = await appointments.verify(business.userId, a.id, fresh);
      expect(verified.status).toBe(AppointmentStatus.IN_PROGRESS);
    });

    it('resets attempts, because they were spent against a code that no longer exists', async () => {
      const a = await booked();
      await appointments.verify(business.userId, a.id, '000000').catch(() => undefined);
      await appointments.verify(business.userId, a.id, '111111').catch(() => undefined);

      const before = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(before.verificationAttempts).toBe(2);

      await appointments.resendVerificationCode(customer.userId, a.id);

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.verificationAttempts).toBe(0);
    });

    it('stores the readable copy and the hash together, from the same value', async () => {
      const a = await booked();

      await appointments.resendVerificationCode(customer.userId, a.id);

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.verificationCode).toBe(emailedCode());
      // Still hashed as well: verification never compares the plaintext.
      expect(row.verificationCodeHash).not.toBe(emailedCode());
    });

    it('counts the send, and stamps when it went out', async () => {
      const a = await booked();

      await appointments.resendVerificationCode(customer.userId, a.id);

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.verificationCodeSentCount).toBe(2); // the booking email, then this
      expect(row.verificationCodeSentAt).not.toBeNull();
    });
  });

  // ==================================================================
  describe('resend is rate-limited in two independent ways (§54.1)', () => {
    it('refuses a second send inside the cooldown', async () => {
      const a = await booked();
      await appointments.resendVerificationCode(customer.userId, a.id);

      await expect(
        appointments.resendVerificationCode(customer.userId, a.id),
      ).rejects.toThrow(/Try again in \d+ second/);
    });

    it('refuses once the ceiling is reached, however long ago the last one was', async () => {
      const a = await booked();
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          verificationCodeSentCount: MAX_VERIFICATION_CODE_SENDS,
          verificationCodeSentAt: new Date(Date.now() - 86_400_000),
        },
      });

      await expect(
        appointments.resendVerificationCode(customer.userId, a.id),
      ).rejects.toThrow(/verify you in person/);
    });

    it('sends nothing at all when it refuses', async () => {
      const a = await booked();
      await prisma.appointment.update({
        where: { id: a.id },
        data: { verificationCodeSentCount: MAX_VERIFICATION_CODE_SENDS },
      });

      await appointments
        .resendVerificationCode(customer.userId, a.id)
        .catch(() => undefined);

      expect(mail.sendAppointmentVerificationEmail).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  describe('only the customer can ask for a code (§54.1)', () => {
    it('404s for a business member of the same appointment', async () => {
      const a = await booked();

      // A code the business can summon is a code the business controls.
      await expect(
        appointments.resendVerificationCode(business.userId, a.id),
      ).rejects.toThrow(/Appointment not found/);
    });

    it('404s for another customer', async () => {
      const stranger = await createCustomer(prisma);
      const a = await booked();

      await expect(
        appointments.resendVerificationCode(stranger.userId, a.id),
      ).rejects.toThrow(/Appointment not found/);
    });

    it('refuses once the appointment has been verified', async () => {
      const a = await booked();
      await appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE);

      await expect(
        appointments.resendVerificationCode(customer.userId, a.id),
      ).rejects.toThrow(/already been verified/);
    });

    it.each([AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])(
      'refuses on a %s appointment',
      async (status) => {
        const a = await createAppointment(prisma, {
          business,
          customerId: customer.userId,
          status,
        });

        await expect(
          appointments.resendVerificationCode(customer.userId, a.id),
        ).rejects.toThrow(/only useful while the appointment is live/);
      },
    );
  });

  // ==================================================================
  describe('the code is visible to the customer and to nobody else (§54.2)', () => {
    it('the customer sees the live code on their own appointment', async () => {
      const a = await booked();

      const seen = await appointments.findOne(customer.userId, a.id);

      expect((seen as any).verificationCode).toBe(KNOWN_VERIFICATION_CODE);
    });

    it('the business reading the SAME appointment gets no code field at all', async () => {
      const a = await booked();

      const seen = await appointments.findOne(business.userId, a.id);

      // Absent, not null: the business projection never selects it, so a new
      // read path cannot leak it by forgetting to strip it.
      expect(seen).not.toHaveProperty('verificationCode');
    });

    it('never exposes the hash to anyone', async () => {
      const a = await booked();

      const asCustomer = await appointments.findOne(customer.userId, a.id);
      const asBusiness = await appointments.findOne(business.userId, a.id);

      expect(asCustomer).not.toHaveProperty('verificationCodeHash');
      expect(asBusiness).not.toHaveProperty('verificationCodeHash');
    });

    it('is null once the code has been used', async () => {
      const a = await booked();
      await appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE);

      const seen = await appointments.findOne(customer.userId, a.id);

      expect((seen as any).verificationCode).toBeNull();
    });

    it('is absent from the LIST, deliberately, even for the customer', async () => {
      await booked();

      const page = await appointments.findAll(customer.userId, UserRole.CUSTOMER, {});

      expect(page.appointments.length).toBeGreaterThan(0);
      for (const item of page.appointments) {
        expect(item).not.toHaveProperty('verificationCode');
      }
    });
  });

  // ==================================================================
  describe('manual verification is possible, and impossible to do quietly (§54.3)', () => {
    const NOTE = 'Read back the booking time and the service; phone battery dead.';

    it('moves BOOKED -> IN_PROGRESS without a code', async () => {
      const a = await booked();

      const result = await appointments.verifyManually(business.userId, a.id, NOTE);

      expect(result.status).toBe(AppointmentStatus.IN_PROGRESS);
      expect(result.verifiedAt).not.toBeNull();
    });

    it('records the method, the individual and what the customer recalled', async () => {
      const a = await booked();

      await appointments.verifyManually(business.userId, a.id, NOTE);

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.verificationMethod).toBe(VerificationMethod.MANUAL);
      expect(row.verifiedById).toBe(business.userId);
      expect(row.manualVerificationNote).toBe(NOTE);
    });

    it('tells every admin, as it happens', async () => {
      const a = await booked();

      await appointments.verifyManually(business.userId, a.id, NOTE);

      const calls = notifications.notify.mock.calls.filter(
        ([arg]) => arg.type === NotificationType.APPOINTMENT_MANUALLY_VERIFIED,
      );
      const admins = await prisma.user.count({ where: { role: UserRole.ADMIN } });
      expect(calls.length).toBe(admins);
      expect(calls[0][0].context.reason).toContain(NOTE);
    });

    it('the code path records CODE, so "null" keeps meaning pre-§54', async () => {
      const a = await booked();

      await appointments.verify(business.userId, a.id, KNOWN_VERIFICATION_CODE);

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.verificationMethod).toBe(VerificationMethod.CODE);
      expect(row.verifiedById).toBe(business.userId);
    });

    it('completes normally afterwards — the path is actually usable end to end', async () => {
      const a = await booked();
      await appointments.verifyManually(business.userId, a.id, NOTE);

      const done = await appointments.complete(business.userId, a.id);

      expect(done.status).toBe(AppointmentStatus.COMPLETED);
    });

    it.each([
      AppointmentStatus.PENDING_PAYMENT,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.COMPLETED,
    ])('refuses from %s', async (status) => {
      const a = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status,
      });

      await expect(
        appointments.verifyManually(business.userId, a.id, NOTE),
      ).rejects.toThrow(/Only a BOOKED appointment can be verified/);
    });

    it("404s on another business's appointment", async () => {
      const a = await booked();

      await expect(
        appointments.verifyManually(other.userId, a.id, NOTE),
      ).rejects.toThrow(/Appointment not found/);
    });

    it('a customer cannot verify themselves', async () => {
      const a = await booked();

      await expect(
        appointments.verifyManually(customer.userId, a.id, NOTE),
      ).rejects.toThrow();
    });
  });
});
