import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { LocationsService } from '../src/business/locations.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
// Discovery marks each result saved-or-not since §120, so it needs this.
import { FavouritesService } from '../src/favourites/favourites.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
  futureSlot,
} from './setup/factories';

/**
 * §89. A branch is closed, never erased.
 *
 * The bug these exist for: deleting a location cascaded through every
 * appointment ever made there, taking reviews and chat threads with them and
 * leaving ledger entries with a null appointmentId — money on the books with
 * nothing to explain it. The code comment admitted the premise it relied on
 * ("no historical appointment references yet") and that premise had expired.
 */
describe('Closing a branch (§89)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let locations: LocationsService;
  let discovery: DiscoveryService;
  let appointments: AppointmentsService;
  let business: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      LocationsService,
      DiscoveryService,
      FavouritesService,
      BusinessAccessService,
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    locations = moduleRef.get(LocationsService);
    discovery = moduleRef.get(DiscoveryService);
    appointments = moduleRef.get(AppointmentsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
  });

  it('keeps the row, and its history, instead of deleting it', async () => {
    const customer = await createCustomer(prisma);
    const appointment = await createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.COMPLETED,
    });

    await locations.close(business.userId, business.locationId);

    const row = await prisma.location.findUnique({ where: { id: business.locationId } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);

    // The thing the old hard delete destroyed.
    const kept = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(kept).not.toBeNull();
    expect(kept?.locationId).toBe(business.locationId);
  });

  it('refuses while bookings are still to happen', async () => {
    const customer = await createCustomer(prisma);
    await createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.BOOKED,
    });

    await expect(
      locations.close(business.userId, business.locationId),
    ).rejects.toBeInstanceOf(BadRequestException);

    const row = await prisma.location.findUnique({ where: { id: business.locationId } });
    expect(row?.isActive).toBe(true);
  });

  it('allows closing when past bookings are all finished', async () => {
    const customer = await createCustomer(prisma);
    await createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.COMPLETED,
    });

    await expect(
      locations.close(business.userId, business.locationId),
    ).resolves.toBeDefined();
  });

  it('refuses to close twice, and to reopen what is open', async () => {
    await locations.close(business.userId, business.locationId);
    await expect(
      locations.close(business.userId, business.locationId),
    ).rejects.toBeInstanceOf(BadRequestException);

    await locations.reopen(business.userId, business.locationId);
    await expect(
      locations.reopen(business.userId, business.locationId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('disappears from discovery, and comes back on reopen', async () => {
    const before = await discovery.search({});
    expect(before.locations.some((l) => l.id === business.locationId)).toBe(true);

    await locations.close(business.userId, business.locationId);
    const during = await discovery.search({});
    expect(during.locations.some((l) => l.id === business.locationId)).toBe(false);
    // The count must agree with the page — the reason the filter is in
    // buildWhere rather than applied afterwards.
    expect(during.total).toBe(before.total - 1);

    await locations.reopen(business.userId, business.locationId);
    const after = await discovery.search({});
    expect(after.locations.some((l) => l.id === business.locationId)).toBe(true);
  });

  it('404s on the public detail page once closed', async () => {
    await locations.close(business.userId, business.locationId);
    await expect(discovery.findOne(business.locationId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still lists for the business that owns it, so it can be reopened', async () => {
    await locations.close(business.userId, business.locationId);
    const mine = await locations.findAll(business.userId);
    const found = mine.find((l: { id: string }) => l.id === business.locationId);
    expect(found).toBeDefined();
    expect(found?.isActive).toBe(false);
  });

  it('refuses a new booking, which is the whole point of closing it', async () => {
    const customer = await createCustomer(prisma);
    const at = futureSlot(7, 8).toISOString();

    await locations.close(business.userId, business.locationId);

    await expect(
      appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: at,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // And takes it again once reopened, so closing is not a one-way door.
    await locations.reopen(business.userId, business.locationId);
    await expect(
      appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: at,
      }),
    ).resolves.toBeDefined();
  });
});
