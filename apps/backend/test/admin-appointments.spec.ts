import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, CancelledBy, LedgerEntryType, TicketCategory, TicketStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppointmentOrder } from '../src/appointments/dto/list-appointments.dto';
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

  describe("the console's bookings (§249)", () => {
    const booked = (startsInHours = 48) =>
      createAppointment(prisma, { business, customerId, status: AppointmentStatus.BOOKED, startsInHours });

    it('finds a booking by the reservation number the customer quotes', async () => {
      const wanted = await booked();
      await booked(72);
      const hex = wanted.id.replace(/-/g, '').slice(0, 8).toUpperCase();

      for (const q of [`${hex.slice(0, 4)}-${hex.slice(4)}`, hex, `No. ${hex.slice(0, 4)}-${hex.slice(4)}`]) {
        const page = await appointments.listForAdmin(AS_ADMIN(), { q });
        expect(page.appointments.map((a) => a.id)).toEqual([wanted.id]);
      }
    });

    it("finds a booking by the customer's email, the shop's name or the service's", async () => {
      const appointment = await booked();
      await prisma.businessProfile.update({ where: { id: business.businessId }, data: { name: 'Findable Barbers 249' } });
      const customer = await prisma.user.findUniqueOrThrow({ where: { id: customerId }, select: { email: true } });
      const service = await prisma.service.findUniqueOrThrow({ where: { id: business.serviceId }, select: { name: true } });

      for (const q of [customer.email.slice(0, 10), 'findable barbers', service.name.toUpperCase()]) {
        const page = await appointments.listForAdmin(AS_ADMIN(), { q });
        expect(page.appointments.map((a) => a.id)).toEqual([appointment.id]);
      }
      expect((await appointments.listForAdmin(AS_ADMIN(), { q: 'nothing-like-this-249' })).total).toBe(0);
    });

    it('reads the latest start first, or the soonest when asked', async () => {
      const soon = await booked(24);
      const later = await booked(96);

      const latest = await appointments.listForAdmin(AS_ADMIN(), {});
      expect(latest.appointments.map((a) => a.id)).toEqual([later.id, soon.id]);
      const soonest = await appointments.listForAdmin(AS_ADMIN(), { sort: AppointmentOrder.SOONEST });
      expect(soonest.appointments.map((a) => a.id)).toEqual([soon.id, later.id]);
    });

    it('opens one booking with its payment, ledger lines, review and tickets', async () => {
      const appointment = await createAppointment(prisma, {
        business,
        customerId,
        status: AppointmentStatus.COMPLETED,
        verified: true,
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { depositPaidAt: new Date(), paymentProviderReferenceId: 'MTN-REF-249', completedAt: new Date() },
      });
      await prisma.ledgerEntry.createMany({
        data: [
          { businessId: business.businessId, appointmentId: appointment.id, type: LedgerEntryType.DEPOSIT_RECEIVED, amountMinor: 900, currency: 'USD' },
          { businessId: business.businessId, appointmentId: appointment.id, type: LedgerEntryType.PLATFORM_FEE, amountMinor: -450, currency: 'USD' },
        ],
      });
      await prisma.review.create({
        data: {
          appointmentId: appointment.id,
          customerId,
          businessId: business.businessId,
          locationId: business.locationId,
          rating: 4,
          comment: 'Good.',
        },
      });
      const ticket = await prisma.ticket.create({
        data: {
          reference: 'TKT-249001',
          reporterId: customerId,
          reporterType: 'CUSTOMER',
          appointmentId: appointment.id,
          category: TicketCategory.APPOINTMENT_DISPUTE,
          subject: 'About my booking',
          status: TicketStatus.OPEN,
        },
      });

      const one = await appointments.findOneForAdmin(AS_ADMIN(), appointment.id);
      expect(one.id).toBe(appointment.id);
      expect(one.paymentProviderReferenceId).toBe('MTN-REF-249');
      expect(one.ledger.map((l) => [l.type, l.amountMinor])).toEqual([
        [LedgerEntryType.DEPOSIT_RECEIVED, 900],
        [LedgerEntryType.PLATFORM_FEE, -450],
      ]);
      expect(one.review).toMatchObject({ rating: 4, comment: 'Good.', hiddenAt: null });
      expect(one.reviewRating).toBe(4);
      expect(one.tickets.map((t) => t.reference)).toEqual([ticket.reference]);
      expect(one.ticketCount).toBe(1);
      expect(one.exchangeRateUsed).toBe(650);
      expect(one.locationAddress).toBeTruthy();
    });

    it('404s on a booking that does not exist, and refuses anyone but an admin', async () => {
      await expect(
        appointments.findOneForAdmin(AS_ADMIN(), '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
      const appointment = await booked();
      await expect(
        appointments.findOneForAdmin({ role: UserRole.CUSTOMER }, appointment.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
