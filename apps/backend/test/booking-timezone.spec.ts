import { AppointmentStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness, createCustomer } from './setup/factories';

/**
 * §103. A zone-less startTime is the SHOP's wall clock.
 *
 * `new Date('2026-11-03T10:00:00')` reads the string in the HOST's timezone.
 * The machine this was written on is set to Africa/Kigali, so it was right by
 * accident; on a host in UTC — which is every deployment — the same booking
 * landed two hours late.
 *
 * These pin the behaviour to the shop's zone — its country's clock (§315) —
 * rather than the host's, so a server moved to UTC cannot reintroduce it
 * silently.
 */
describe('Booking time zones (§103)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let availability: AvailabilityService;
  let business: TestBusiness;
  let customerId: string;

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
    availability = moduleRef.get(AvailabilityService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customerId = (await createCustomer(prisma)).userId;
  });

  /** A weekday the seeded business is open, far enough out to be bookable. */
  const openDate = () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 10);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date.toISOString().slice(0, 10);
  };

  const offsetHours = (zone: string, on: string) => {
    const probe = new Date(`${on}T12:00:00Z`);
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      hour12: false,
    }).format(probe);
    return Number(label) - 12;
  };

  it("reads a zone-less time as the shop's zone, not the host zone", async () => {
    const date = openDate();
    const zone = await availability.zoneOfLocation(business.locationId);
    expect(zone).toBe('Africa/Kigali');
    const shift = offsetHours(zone, date);

    const appointment = await appointments.create(customerId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: `${date}T10:00:00`,
    });

    // 10:00 at the shop is (10 - offset):00 UTC.
    const expectedUtcHour = 10 - shift;
    expect(appointment.startTime.getUTCHours()).toBe(expectedUtcHour);
    expect(appointment.status).toBe(AppointmentStatus.PENDING_PAYMENT);
  });

  it("shows the same wall-clock time back in the shop's zone", async () => {
    const date = openDate();
    const zone = await availability.zoneOfLocation(business.locationId);

    const appointment = await appointments.create(customerId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: `${date}T10:00:00`,
    });

    const shown = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(appointment.startTime);

    // What the customer tapped is what the shop sees. This is the assertion
    // that fails on a UTC host without the fix.
    expect(shown).toBe('10:00');
  });

  it('still trusts a string that carries its own zone', async () => {
    const date = openDate();

    const appointment = await appointments.create(customerId, {
      locationId: business.locationId,
      serviceId: business.serviceId,
      startTime: `${date}T08:00:00Z`,
    });

    expect(appointment.startTime.toISOString()).toBe(`${date}T08:00:00.000Z`);
  });

  it('refuses a string that is not a date-time at all', async () => {
    await expect(
      appointments.create(customerId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: 'next tuesday',
      }),
    ).rejects.toThrow(/valid date-time/);
  });
});
