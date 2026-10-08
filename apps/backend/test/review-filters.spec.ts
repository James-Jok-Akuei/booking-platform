import { AppointmentStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReviewsService } from '../src/reviews/reviews.service';
import { ListReviewsDto, ReviewOrder } from '../src/reviews/dto/list-reviews.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * Reading a long list of reviews (§215): one star, waiting for a reply, a
 * search, an order — and true totals beside whatever page is shown.
 */
describe('Filtering a location’s reviews (§215)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let shop: TestBusiness;

  /** rating, words, replied?, days ago, hidden? */
  const ROWS: Array<[number, string | null, boolean, number, boolean?]> = [
    [5, 'Brilliant fade, very clean', true, 1],
    [5, null, false, 2],
    [4, 'Good but a long wait', false, 3],
    [2, 'Rushed and the towel was cold', false, 4],
    [1, 'Never again', true, 5],
    [1, 'Hidden for abuse', false, 6, true],
  ];

  beforeAll(async () => {
    moduleRef = await createTestModule([ReviewsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);
    await resetDatabase(prisma);
    shop = await createBusiness(prisma);

    for (const [rating, comment, replied, daysAgo, hidden] of ROWS) {
      const customer = await createCustomer(prisma);
      await prisma.user.update({ where: { id: customer.userId }, data: { displayName: `Guest ${rating}${daysAgo}` } });
      const appointment = await createAppointment(prisma, {
        business: shop,
        customerId: customer.userId,
        status: AppointmentStatus.COMPLETED,
        verified: true,
      });
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      await prisma.review.create({
        data: {
          appointmentId: appointment.id,
          customerId: customer.userId,
          businessId: shop.businessId,
          locationId: shop.locationId,
          rating,
          comment,
          createdAt: at,
          ...(replied ? { responseText: 'Thank you', responseAt: at } : {}),
          ...(hidden ? { hiddenAt: new Date(), hiddenReason: 'abuse' } : {}),
        },
      });
    }
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const list = (query: Partial<ListReviewsDto>) =>
    reviews.listForLocation(shop.locationId, undefined, query as ListReviewsDto);
  const ratings = async (query: Partial<ListReviewsDto>) => (await list(query)).reviews.map((r) => r.rating);

  it('counts every visible review by star and by reply, whatever is filtered', async () => {
    const page = await list({ rating: 5, limit: 1 });
    expect(page.breakdown).toEqual({ stars: [1, 1, 0, 1, 2], replied: 2, waiting: 3 });
    expect(page.total).toBe(2);
    expect(page.reviews).toHaveLength(1);
  });

  it('filters by star, and by whether the shop has replied', async () => {
    expect(await ratings({ rating: 1 })).toEqual([1]);
    expect(await ratings({ replied: false })).toEqual([5, 4, 2]);
    expect(await ratings({ replied: true })).toEqual([5, 1]);
  });

  it('searches the words and the reviewer’s name, case aside — never a hidden review', async () => {
    expect(await ratings({ q: 'TOWEL' })).toEqual([2]);
    expect(await ratings({ q: 'guest 4' })).toEqual([4]);
    expect(await ratings({ q: 'abuse' })).toEqual([]);
  });

  it('orders newest, oldest, lowest and highest', async () => {
    expect(await ratings({})).toEqual([5, 5, 4, 2, 1]);
    expect(await ratings({ sort: ReviewOrder.OLDEST })).toEqual([1, 2, 4, 5, 5]);
    expect(await ratings({ sort: ReviewOrder.LOWEST })).toEqual([1, 2, 4, 5, 5]);
    expect(await ratings({ sort: ReviewOrder.HIGHEST })).toEqual([5, 5, 4, 2, 1]);
  });

  it('says which service was reviewed', async () => {
    const service = await prisma.service.findUniqueOrThrow({ where: { id: shop.serviceId } });
    const page = await list({ limit: 1 });
    expect(page.reviews[0].serviceName).toBe(service.name);
  });

  it('reads replied=true and replied=false from the address as they are written', async () => {
    const yes = plainToInstance(ListReviewsDto, { replied: 'true' });
    const no = plainToInstance(ListReviewsDto, { replied: 'false' });
    expect(yes.replied).toBe(true);
    expect(no.replied).toBe(false);
    expect(await validate(plainToInstance(ListReviewsDto, { replied: 'maybe' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(ListReviewsDto, { rating: '6' }))).not.toHaveLength(0);
  });
});
