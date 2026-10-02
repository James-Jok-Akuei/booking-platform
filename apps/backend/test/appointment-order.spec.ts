import { AppointmentStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { AppointmentOrder } from '../src/appointments/dto/list-appointments.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Which end of the list comes first (§110.2).
 *
 * The endpoint has always ordered `startTime desc`, which is right for a
 * business reading a schedule backwards and wrong for a customer asking what is
 * next. The customer app's "Upcoming" tab would have opened on the booking
 * FURTHEST away — and on page one, so reversing the page client-side would have
 * ordered 25 rows correctly while still showing the wrong 25.
 */
describe('Listing order (§110.2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
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
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  /** Three bookings, 24 / 48 / 72 hours out. */
  const three = async () => {
    const hours = [24, 48, 72];
    const made = [];
    for (const startsInHours of hours) {
      made.push(
        await createAppointment(prisma, {
          business,
          customerId: customer.userId,
          status: AppointmentStatus.BOOKED,
          startsInHours,
        }),
      );
    }
    return made;
  };

  const list = (sort?: AppointmentOrder) =>
    appointments.findAll(customer.userId, UserRole.CUSTOMER, { sort }) as Promise<{
      appointments: Array<{ id: string; startTime: Date }>;
    }>;

  it('defaults to latest first, which is what the business app has always had', async () => {
    const [soon, mid, far] = await three();

    const page = await list();

    expect(page.appointments.map((a) => a.id)).toEqual([far.id, mid.id, soon.id]);
  });

  it('sort=soonest puts the next booking first', async () => {
    const [soon, mid, far] = await three();

    const page = await list(AppointmentOrder.SOONEST);

    expect(page.appointments.map((a) => a.id)).toEqual([soon.id, mid.id, far.id]);
  });

  it('the order holds across pages, not just within one', async () => {
    await three();

    // The bug this guards: an order applied after paging gets the right rows in
    // the wrong order, or the wrong rows entirely.
    const first = await appointments.findAll(customer.userId, UserRole.CUSTOMER, {
      sort: AppointmentOrder.SOONEST,
      limit: 1,
    });
    const second = await appointments.findAll(customer.userId, UserRole.CUSTOMER, {
      sort: AppointmentOrder.SOONEST,
      limit: 1,
      offset: 1,
    });

    expect(new Date(first.appointments[0].startTime).getTime()).toBeLessThan(
      new Date(second.appointments[0].startTime).getTime(),
    );
  });

  afterEach(async () => {
    await prisma.appointment.deleteMany({});
  });
});
