import { AppointmentStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * The customer's own review, carried on their own appointment reads (§111).
 *
 * The app has to tell "you can review this" from "you already did", and nothing
 * else could answer it: the public listing carries no `customerId`, so a client
 * cannot find its own row in it. Without this the only way to find out would be
 * to post and read the 409.
 *
 * The test that matters most is the last one. Joining the review onto the SHARED
 * projection would have handed a business a review an admin had HIDDEN, and §93
 * is entirely about hiding removing it from every listing.
 */
describe('A customer sees their own review on their appointment (§111)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let reviews: ReviewsService;
  let business: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      ReviewsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    reviews = moduleRef.get(ReviewsService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.review.deleteMany({});
    await prisma.appointment.deleteMany({});
  });

  const completed = () =>
    createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.COMPLETED,
      startsInHours: -48,
    });

  // Cast through `unknown`: both methods pick their projection at runtime, so
  // their inferred type is the UNION of the two and does not name `review` at
  // all. That the field is only on one branch is the behaviour under test.
  const detail = (id: string) =>
    appointments.findOne(customer.userId, id) as unknown as Promise<{
      review: unknown;
    }>;

  const myList = () =>
    appointments.findAll(customer.userId, UserRole.CUSTOMER, {}) as unknown as Promise<{
      appointments: Array<{ id: string; review: unknown }>;
    }>;

  it('is null before there is one, which is what offers the form', async () => {
    const appointment = await completed();

    expect(await detail(appointment.id)).toHaveProperty('review', null);
    expect((await myList()).appointments[0]).toHaveProperty('review', null);
  });

  it('is there after reviewing, on the detail AND in the list', async () => {
    const appointment = await completed();
    await reviews.create(customer.userId, appointment.id, {
      rating: 4,
      comment: 'Quick and tidy.',
    });

    const one = (await detail(appointment.id)) as { review: { rating: number } };
    expect(one.review.rating).toBe(4);

    // In the list too: the Past tab says "you rated this" without a request per
    // row, which with 50 rows is 50 requests.
    const page = await myList();
    expect((page.appointments[0].review as { rating: number }).rating).toBe(4);
  });

  it('carries no identity — only what was written', async () => {
    const appointment = await completed();
    await reviews.create(customer.userId, appointment.id, { rating: 5 });

    const one = (await detail(appointment.id)) as { review: Record<string, unknown> };

    expect(Object.keys(one.review).sort()).toEqual([
      'comment',
      'createdAt',
      'editedAt',
      'id',
      'rating',
    ]);
  });

  it('a BUSINESS reading the same appointment gets no review at all', async () => {
    const appointment = await completed();
    await reviews.create(customer.userId, appointment.id, { rating: 2 });

    // The business's own list, through the same service.
    const page = (await appointments.findAll(
      business.userId,
      UserRole.BUSINESS,
      {},
    )) as unknown as { appointments: Array<Record<string, unknown>> };

    expect(page.appointments).toHaveLength(1);
    // Not null — absent. Joining it onto the shared projection would also hand
    // over reviews an admin had HIDDEN, which is exactly what §93 removes.
    expect(page.appointments[0]).not.toHaveProperty('review');
  });

  it('the author still sees their own review once an admin has hidden it', async () => {
    const appointment = await completed();
    const review = await reviews.create(customer.userId, appointment.id, {
      rating: 1,
      comment: 'Nobody was there.',
    });
    await prisma.review.update({
      where: { id: review.id },
      data: { hiddenAt: new Date(), hiddenReason: 'Abusive language.' },
    });

    // Deliberate: hiding it from the author would leave the app offering "write
    // a review" on an appointment the server answers with 409 "already
    // reviewed" — worse than saying nothing. Whether the author should be TOLD
    // it was hidden is a separate question this does not answer.
    const one = (await detail(appointment.id)) as { review: { rating: number } };
    expect(one.review.rating).toBe(1);
  });
});
