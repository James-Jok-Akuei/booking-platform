import { AppointmentStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * The business's list, by branch and by a search (§213).
 *
 * Both narrow the caller's own scope and never widen it: a branch of another
 * business, or a search matching another business's customer, finds nothing.
 */
describe('Filtering the appointment list (§213)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let shop: TestBusiness;
  let other: TestBusiness;
  let second: string;
  let ids: { main: string; branch: string; elsewhere: string };

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

    shop = await createBusiness(prisma);
    other = await createBusiness(prisma);
    second = (
      await prisma.location.create({
        data: { businessId: shop.businessId, name: 'Riverside Branch', address: '2 River Rd' },
      })
    ).id;

    const amina = await createCustomer(prisma);
    await prisma.user.update({ where: { id: amina.userId }, data: { email: 'amina.k@example.com' } });
    const brian = await createCustomer(prisma);

    const main = await createAppointment(prisma, { business: shop, customerId: amina.userId, status: AppointmentStatus.BOOKED });
    const branch = await createAppointment(prisma, {
      business: { ...shop, locationId: second },
      customerId: brian.userId,
      status: AppointmentStatus.BOOKED,
    });
    // Another business's booking, by the same customer as `main`.
    const elsewhere = await createAppointment(prisma, { business: other, customerId: amina.userId, status: AppointmentStatus.BOOKED });
    ids = { main: main.id, branch: branch.id, elsewhere: elsewhere.id };
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const list = async (query: { locationId?: string; q?: string }) => {
    const page = (await appointments.findAll(shop.userId, UserRole.BUSINESS, query)) as {
      total: number;
      appointments: Array<{ id: string }>;
    };
    return { total: page.total, ids: page.appointments.map((a) => a.id).sort() };
  };

  it('lists one branch only', async () => {
    expect(await list({ locationId: second })).toEqual({ total: 1, ids: [ids.branch] });
    expect((await list({ locationId: shop.locationId })).ids).toEqual([ids.main]);
  });

  it("finds nothing for another business's branch", async () => {
    expect(await list({ locationId: other.locationId })).toEqual({ total: 0, ids: [] });
  });

  it('finds by part of the email, whatever its case — but only in this business', async () => {
    expect((await list({ q: 'AMINA' })).ids).toEqual([ids.main]);
  });

  it('finds by branch name and by service name', async () => {
    expect((await list({ q: 'riverside' })).ids).toEqual([ids.branch]);
    const service = await prisma.service.findUniqueOrThrow({ where: { id: shop.serviceId } });
    expect((await list({ q: service.name.slice(0, 4) })).ids).toEqual([ids.branch, ids.main].sort());
  });

  it('finds by the reservation number the customer sees, with or without its dash', async () => {
    const plain = ids.main.replace(/-/g, '').slice(0, 8).toUpperCase();
    const shown = `${plain.slice(0, 4)}-${plain.slice(4)}`;
    expect((await list({ q: shown })).ids).toEqual([ids.main]);
    expect((await list({ q: plain.toLowerCase() })).ids).toEqual([ids.main]);
  });

  it('combines a branch and a search', async () => {
    expect((await list({ locationId: second, q: 'amina' })).ids).toEqual([]);
  });
});
