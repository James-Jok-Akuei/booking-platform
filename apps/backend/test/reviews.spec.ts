import { AppointmentStatus, BusinessMemberRole } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { ReviewsService } from '../src/reviews/reviews.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REVIEW_EDIT_WINDOW_MS } from '../src/reviews/review-window';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  addMember,
  asUser,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

describe('Reviews (§28)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let customerA: { userId: string; email: string };
  let customerB: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([ReviewsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    customerA = await createCustomer(prisma);
    customerB = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  /** A COMPLETED appointment for customerA at alpha, ready to review. */
  const completedAppointment = async (
    business: TestBusiness = alpha,
    customerId: string = customerA.userId,
  ) =>
    createAppointment(prisma, {
      business,
      customerId,
      status: AppointmentStatus.COMPLETED,
      verified: true,
    });

  const ratingOf = async (locationId: string) => {
    const l = await prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { ratingAvg: true, ratingCount: true },
    });
    return { avg: l.ratingAvg === null ? null : Number(l.ratingAvg), count: l.ratingCount };
  };

  describe('creation preconditions', () => {
    const NON_COMPLETED = [
      AppointmentStatus.PENDING_PAYMENT,
      AppointmentStatus.BOOKED,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
    ];

    it.each(NON_COMPLETED)('rejects a review on a %s appointment', async (status) => {
      const appointment = await createAppointment(prisma, {
        business: alpha,
        customerId: customerA.userId,
        status,
      });

      await expect(
        reviews.create(customerA.userId, appointment.id, { rating: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a review on a COMPLETED appointment', async () => {
      const appointment = await completedAppointment();

      const review = await reviews.create(customerA.userId, appointment.id, {
        rating: 4,
        comment: 'Good service.',
      });

      expect(review.rating).toBe(4);
      expect(review.comment).toBe('Good service.');
    });

    it('rejects a customer who was not on the appointment', async () => {
      const appointment = await completedAppointment();

      await expect(
        reviews.create(customerB.userId, appointment.id, { rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a second review on the same appointment with a conflict', async () => {
      const appointment = await completedAppointment();
      await reviews.create(customerA.userId, appointment.id, { rating: 5 });

      await expect(
        reviews.create(customerA.userId, appointment.id, { rating: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('copies businessId and locationId from the appointment', async () => {
      const appointment = await completedAppointment();

      const review = await reviews.create(customerA.userId, appointment.id, { rating: 3 });

      expect(review.locationId).toBe(alpha.locationId);
      expect(review.businessId).toBe(alpha.businessId);
    });
  });

  describe('rating bounds', () => {
    it.each([1, 5])('accepts the boundary rating %i', async (rating) => {
      const appointment = await completedAppointment();

      const review = await reviews.create(customerA.userId, appointment.id, { rating });

      expect(review.rating).toBe(rating);
    });

    it.each([0, 6, -1])('the database refuses an out-of-range rating of %i', async (rating) => {
      // The DTO rejects these before the service is reached; the CHECK
      // constraint is the backstop for anything that arrives another way.
      const appointment = await completedAppointment();

      await expect(
        reviews.create(customerA.userId, appointment.id, { rating }),
      ).rejects.toThrow();
    });
  });

  describe('customer edit window', () => {
    it('allows an edit inside the window and stamps editedAt', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });

      const updated = await reviews.update(customerA.userId, review.id, {
        rating: 5,
        comment: 'They fixed it.',
      });

      expect(updated.rating).toBe(5);
      expect(updated.comment).toBe('They fixed it.');
      expect(updated.editedAt).not.toBeNull();
    });

    it('rejects an edit after 7 days', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 3 });

      await prisma.review.update({
        where: { id: review.id },
        data: { createdAt: new Date(Date.now() - REVIEW_EDIT_WINDOW_MS - 60_000) },
      });

      await expect(
        reviews.update(customerA.userId, review.id, { rating: 1 }),
      ).rejects.toThrow(/only be edited within 7 days/);
    });

    it("rejects a customer editing someone else's review", async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 3 });

      await expect(
        reviews.update(customerB.userId, review.id, { rating: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('business response', () => {
    it('allows one response from a member of the owning business', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });

      const responded = await reviews.respond(alpha.userId, review.id, {
        responseText: 'Sorry to hear this — please contact us.',
      });

      expect(responded.responseText).toContain('Sorry to hear this');
      expect(responded.responseAt).not.toBeNull();
    });

    it('rejects a second response', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });
      await reviews.respond(alpha.userId, review.id, { responseText: 'First reply.' });

      await expect(
        reviews.respond(alpha.userId, review.id, { responseText: 'Second reply.' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a member of a different business', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });

      await expect(
        reviews.respond(beta.userId, review.id, { responseText: 'Not my customer.' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows any active member, including STAFF, to respond', async () => {
      const staff = await addMember(prisma, alpha.businessId, BusinessMemberRole.STAFF);
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 4 });

      const responded = await reviews.respond(staff.userId, review.id, {
        responseText: 'Thanks for visiting.',
      });

      expect(responded.responseText).toBe('Thanks for visiting.');
    });

    it('allows editing a response inside the window, stamping responseEditedAt', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 3 });
      await reviews.respond(alpha.userId, review.id, { responseText: 'Typo here.' });

      const edited = await reviews.updateResponse(alpha.userId, review.id, {
        responseText: 'Corrected.',
      });

      expect(edited.responseText).toBe('Corrected.');
      expect(edited.responseEditedAt).not.toBeNull();
    });

    it('rejects editing a response after 7 days', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 3 });
      await reviews.respond(alpha.userId, review.id, { responseText: 'Original.' });
      await prisma.review.update({
        where: { id: review.id },
        data: { responseAt: new Date(Date.now() - REVIEW_EDIT_WINDOW_MS - 60_000) },
      });

      await expect(
        reviews.updateResponse(alpha.userId, review.id, { responseText: 'Too late.' }),
      ).rejects.toThrow(/only be edited within 7 days/);
    });
  });

  describe('aggregates — exact values through a full lifecycle', () => {
    let location: string;
    let reviewIds: string[];

    beforeAll(async () => {
      // A dedicated business so the arithmetic is not disturbed by other tests.
      const shop = await createBusiness(prisma);
      location = shop.locationId;
      reviewIds = [];

      for (const rating of [5, 3, 4]) {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(shop, customer.userId);
        const review = await reviews.create(customer.userId, appointment.id, { rating });
        reviewIds.push(review.id);
      }
    });

    it('after three reviews of 5, 3 and 4 the average is exactly 4.00', async () => {
      expect(await ratingOf(location)).toEqual({ avg: 4, count: 3 });
    });

    it('an edit recalculates: 5,3,4 -> 5,3,1 gives exactly 3.00', async () => {
      const owner = await prisma.review.findUniqueOrThrow({
        where: { id: reviewIds[2] },
        select: { customerId: true },
      });
      await reviews.update(owner.customerId, reviewIds[2], { rating: 1 });

      expect(await ratingOf(location)).toEqual({ avg: 3, count: 3 });
    });

    it('hiding excludes it from the aggregate: 5,3 gives exactly 4.00 over 2', async () => {
      await reviews.hide(admin.userId, reviewIds[2], { hiddenReason: 'Abusive language.' });

      expect(await ratingOf(location)).toEqual({ avg: 4, count: 2 });
    });

    it('unhiding restores it: back to 3.00 over 3', async () => {
      await reviews.unhide(admin.userId, reviewIds[2]);

      expect(await ratingOf(location)).toEqual({ avg: 3, count: 3 });
    });

    it('a location with no reviews has a null average, not zero', async () => {
      const fresh = await createBusiness(prisma);

      expect(await ratingOf(fresh.locationId)).toEqual({ avg: null, count: 0 });
    });

    it('hiding every review returns the average to null', async () => {
      const solo = await createBusiness(prisma);
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(solo, customer.userId);
      const review = await reviews.create(customer.userId, appointment.id, { rating: 5 });

      await reviews.hide(admin.userId, review.id, { hiddenReason: 'Spam.' });

      expect(await ratingOf(solo.locationId)).toEqual({ avg: null, count: 0 });
    });
  });

  describe('listing', () => {
    it('excludes hidden reviews from the location listing', async () => {
      const shop = await createBusiness(prisma);
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(shop, customer.userId);
      const review = await reviews.create(customer.userId, appointment.id, {
        rating: 1,
        comment: 'HIDDEN-CONTENT',
      });

      const before = await reviews.listForLocation(shop.locationId, undefined, {});
      await reviews.hide(admin.userId, review.id, { hiddenReason: 'Abusive.' });
      const after = await reviews.listForLocation(shop.locationId, undefined, {});

      expect(before.total).toBe(1);
      expect(after.total).toBe(0);
      expect(JSON.stringify(after)).not.toContain('HIDDEN-CONTENT');
    });

    it("a review for location A is absent from location B's listing, same business", async () => {
      const shop = await createBusiness(prisma);
      // A second location under the SAME business.
      const locationB = await prisma.location.create({
        data: {
          businessId: shop.businessId,
          name: 'Second Branch',
          address: 'Another Road',
          hours: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              openTime: '09:00',
              closeTime: '17:00',
            })),
          },
        },
      });
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(shop, customer.userId);
      await reviews.create(customer.userId, appointment.id, { rating: 5 });

      const a = await reviews.listForLocation(shop.locationId, undefined, {});
      const b = await reviews.listForLocation(locationB.id, undefined, {});

      expect(a.total).toBe(1);
      expect(b.total).toBe(0);
      // The whole point of per-location scoping: one branch's rating is its own.
      expect(a.ratingAvg).toBe(5);
      expect(b.ratingAvg).toBeNull();
    });

    it('hides customer identity from an anonymous viewer', async () => {
      const shop = await createBusiness(prisma);
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(shop, customer.userId);
      await reviews.create(customer.userId, appointment.id, { rating: 5 });

      const list = await reviews.listForLocation(shop.locationId, undefined, {});

      expect(JSON.stringify(list)).not.toContain(customer.email);
      expect(JSON.stringify(list)).not.toContain(customer.userId);
    });

    it('shows customer identity to the owning business, as appointments already do', async () => {
      const shop = await createBusiness(prisma);
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(shop, customer.userId);
      await reviews.create(customer.userId, appointment.id, { rating: 5 });

      const list = await reviews.listForLocation(
        shop.locationId,
        asUser(shop.userId, 'BUSINESS'),
        {},
      );

      expect(JSON.stringify(list)).toContain(customer.email);
    });

    it("does not show identity to a DIFFERENT business", async () => {
      const shop = await createBusiness(prisma);
      const customer = await createCustomer(prisma);
      const appointment = await completedAppointment(shop, customer.userId);
      await reviews.create(customer.userId, appointment.id, { rating: 5 });

      const list = await reviews.listForLocation(
        shop.locationId,
        asUser(beta.userId, 'BUSINESS'),
        {},
      );

      expect(JSON.stringify(list)).not.toContain(customer.email);
    });
  });

  describe('moderation', () => {
    it('rejects hiding an already-hidden review', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });
      await reviews.hide(admin.userId, review.id, { hiddenReason: 'Spam.' });

      await expect(
        reviews.hide(admin.userId, review.id, { hiddenReason: 'Again.' }),
      ).rejects.toThrow(/already hidden/);
    });

    it('rejects unhiding a review that is not hidden', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });

      await expect(reviews.unhide(admin.userId, review.id)).rejects.toThrow(/not hidden/);
    });

    it('keeps the row after hiding — it is evidence, not deleted', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, {
        rating: 1,
        comment: 'Evidence.',
      });
      await reviews.hide(admin.userId, review.id, { hiddenReason: 'Under dispute.' });

      const row = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(row.comment).toBe('Evidence.');
      expect(row.hiddenReason).toBe('Under dispute.');
      expect(row.hiddenById).toBe(admin.userId);
    });
  });
});
