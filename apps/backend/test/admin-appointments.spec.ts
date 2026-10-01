import { ForbiddenException } from '@nestjs/common';
import { AppointmentStatus, CancelledBy, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * §95. The admin appointment listing.
 *
 * `reclassifyAsBusinessCancellation` took an id nothing produced. These cover
 * the listing, and specifically `canReclassify` — which must agree with what
 * the PATCH actually accepts, because a row offering a button the server
 * refuses is worse than no button at all.
 */
describe('Admin appointments (§95)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let business: TestBusiness;
  let customerId: string;
  let adminId: string;

  const AS_ADMIN = () => ({ userId: adminId, role: UserRole.ADMIN });

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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customerId = (await createCustomer(prisma)).userId;
    const admin = await prisma.user.create({
      data: { email: `admin.${Date.now()}@test.local`, role: UserRole.ADMIN },
    });
    adminId = admin.id;
  });

  /** A cancellation blamed on the customer, with the deposit actually taken. */
  const customerCancelledAndPaid = async () => {
    const appointment = await createAppointment(prisma, {
      business,
      customerId,
      status: AppointmentStatus.CANCELLED,
    });
    return prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        cancelledBy: CancelledBy.CUSTOMER,
        cancelledAt: new Date(),
        depositPaidAt: new Date(),
      },
    });
  };

  it('lists appointments with the business and customer behind them', async () => {
    await customerCancelledAndPaid();

    const page = await appointments.listForAdmin(AS_ADMIN(), {});
    const row = page.appointments[0];

    expect(page.total).toBe(1);
    expect(row.businessName).toBeTruthy();
    expect(row.locationName).toBeTruthy();
    expect(row.serviceName).toBeTruthy();
    expect(row.customerEmail).toBeTruthy();
  });

  describe('canReclassify agrees with what the PATCH accepts', () => {
    it('is true for a paid, customer-cancelled booking', async () => {
      await customerCancelledAndPaid();

      const page = await appointments.listForAdmin(AS_ADMIN(), {});
      expect(page.appointments[0].canReclassify).toBe(true);
    });

    it('is false when no deposit was taken — there is nothing to refund', async () => {
      const appointment = await createAppointment(prisma, {
        business,
        customerId,
        status: AppointmentStatus.CANCELLED,
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { cancelledBy: CancelledBy.SYSTEM_EXPIRY, depositPaidAt: null },
      });

      const page = await appointments.listForAdmin(AS_ADMIN(), {});
      expect(page.appointments[0].canReclassify).toBe(false);
    });

    it('is false when it is already the business that cancelled', async () => {
      const appointment = await customerCancelledAndPaid();
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { cancelledBy: CancelledBy.BUSINESS },
      });

      const page = await appointments.listForAdmin(AS_ADMIN(), {});
      expect(page.appointments[0].canReclassify).toBe(false);

      // And the PATCH refuses it, which is the agreement being asserted.
      await expect(
        appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), appointment.id, {
          reason: 'Trying anyway.',
          gatewayChargeMinor: 0,
        }),
      ).rejects.toThrow();
    });

    it('is false for a completed booking, which the PATCH also refuses', async () => {
      const appointment = await createAppointment(prisma, {
        business,
        customerId,
        status: AppointmentStatus.COMPLETED,
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { depositPaidAt: new Date() },
      });

      const page = await appointments.listForAdmin(AS_ADMIN(), {});
      expect(page.appointments[0].canReclassify).toBe(false);

      await expect(
        appointments.reclassifyAsBusinessCancellation(AS_ADMIN(), appointment.id, {
          reason: 'Trying anyway.',
          gatewayChargeMinor: 0,
        }),
      ).rejects.toThrow();
    });
  });

  it('the reclassifiable filter returns only those rows', async () => {
    await customerCancelledAndPaid();
    await createAppointment(prisma, {
      business,
      customerId,
      status: AppointmentStatus.BOOKED,
    });

    const page = await appointments.listForAdmin(AS_ADMIN(), { reclassifiable: 'true' });
    expect(page.total).toBe(1);
    expect(page.appointments.every((a) => a.canReclassify)).toBe(true);
  });

  it('filters by status and by who cancelled', async () => {
    await customerCancelledAndPaid();
    await createAppointment(prisma, {
      business,
      customerId,
      status: AppointmentStatus.BOOKED,
    });

    const booked = await appointments.listForAdmin(AS_ADMIN(), {
      status: AppointmentStatus.BOOKED,
    });
    expect(booked.total).toBe(1);

    const byCustomer = await appointments.listForAdmin(AS_ADMIN(), {
      cancelledBy: CancelledBy.CUSTOMER,
    });
    expect(byCustomer.total).toBe(1);
  });

  it.each([UserRole.CUSTOMER, UserRole.BUSINESS])('refuses a %s', async (role) => {
    await expect(
      appointments.listForAdmin({ role }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
