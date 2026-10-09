import { AppointmentStatus, BusinessMemberRole } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReviewsService } from '../src/reviews/reviews.service';
import { UsersService } from '../src/users/users.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  CreateReviewDto,
  UpdateReviewDto,
} from '../src/reviews/dto/create-review.dto';
import { ClearDisplayNameDto } from '../src/users/dto/clear-display-name.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { REVIEW_EDIT_WINDOW_MS } from '../src/reviews/review-window';
import { ReviewOrder } from '../src/reviews/dto/list-reviews.dto';
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
  let users: UsersService;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let customerA: { userId: string; email: string };
  let customerB: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ReviewsService,
      UsersService,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);
    users = moduleRef.get(UsersService);
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
      await reviews.hide(asUser(admin.userId, 'ADMIN'), reviewIds[2], { hiddenReason: 'Abusive language.' });

      expect(await ratingOf(location)).toEqual({ avg: 4, count: 2 });
    });

    it('unhiding restores it: back to 3.00 over 3', async () => {
      await reviews.unhide(asUser(admin.userId, 'ADMIN'), reviewIds[2]);

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

      await reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, { hiddenReason: 'Spam.' });

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
      await reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, { hiddenReason: 'Abusive.' });
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

  describe('the moderation queue (§93)', () => {
    const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');

    it('is the one listing that returns hidden reviews', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, {
        rating: 1,
        comment: 'Hidden later.',
      });
      await reviews.hide(AS_ADMIN(), review.id, { hiddenReason: 'Abusive.' });

      // Absent from the public listing, which is what hiding means.
      const publicList = await reviews.listForLocation(alpha.locationId, undefined, {});
      expect(publicList.reviews.some((r) => r.id === review.id)).toBe(false);

      // Present here, or hiding would be a one-way door.
      const queue = await reviews.listForModeration(AS_ADMIN(), {});
      const found = queue.reviews.find((r) => r.id === review.id);
      expect(found).toBeDefined();
      expect(found?.hiddenAt).not.toBeNull();
      expect(found?.hiddenReason).toBe('Abusive.');
    });

    it('names who hid it and why, so the decision can be reviewed', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });
      await reviews.hide(AS_ADMIN(), review.id, { hiddenReason: 'Names a member of staff.' });

      const queue = await reviews.listForModeration(AS_ADMIN(), { visibility: 'HIDDEN' });
      const found = queue.reviews.find((r) => r.id === review.id);
      expect(found?.hiddenByEmail).toBe(admin.email);
      expect(found?.hiddenReason).toBe('Names a member of staff.');
    });

    it('gives an admin the customer identity a decision needs', async () => {
      const appointment = await completedAppointment();
      await reviews.create(customerA.userId, appointment.id, { rating: 3 });

      const queue = await reviews.listForModeration(AS_ADMIN(), {});
      const row = queue.reviews[0];

      // The public listing never carries these (§28.6).
      expect(row.customerEmail).toBe(customerA.email);
      expect(row.businessName).toBeTruthy();
      expect(row.locationName).toBeTruthy();
    });

    it('filters by visibility', async () => {
      // Its own business: this suite resets once, so reviews accumulate across
      // it and a platform-wide assertion would be about every earlier test.
      const shop = await createBusiness(prisma);
      const first = await completedAppointment(shop);
      const visible = await reviews.create(customerA.userId, first.id, { rating: 5 });
      const second = await completedAppointment(shop, customerB.userId);
      const hidden = await reviews.create(customerB.userId, second.id, { rating: 1 });
      await reviews.hide(AS_ADMIN(), hidden.id, { hiddenReason: 'Spam.' });

      const scope = { businessId: shop.businessId };

      const onlyHidden = await reviews.listForModeration(AS_ADMIN(), {
        ...scope,
        visibility: 'HIDDEN',
      });
      expect(onlyHidden.reviews.map((r) => r.id)).toEqual([hidden.id]);

      const onlyVisible = await reviews.listForModeration(AS_ADMIN(), {
        ...scope,
        visibility: 'VISIBLE',
      });
      expect(onlyVisible.reviews.map((r) => r.id)).toEqual([visible.id]);

      const all = await reviews.listForModeration(AS_ADMIN(), { ...scope, visibility: 'ALL' });
      expect(all.total).toBe(2);
    });

    it('filters by rating, which is what a dispute looks like', async () => {
      const shop = await createBusiness(prisma);
      const first = await completedAppointment(shop);
      const low = await reviews.create(customerA.userId, first.id, { rating: 1 });
      const second = await completedAppointment(shop, customerB.userId);
      await reviews.create(customerB.userId, second.id, { rating: 5 });

      const bad = await reviews.listForModeration(AS_ADMIN(), {
        businessId: shop.businessId,
        maxRating: 2,
      });
      expect(bad.reviews.map((r) => r.id)).toEqual([low.id]);
    });

    it('counts hidden reviews across the platform, not just this page', async () => {
      const before = (await reviews.listForModeration(AS_ADMIN(), {})).hiddenCount;

      const shop = await createBusiness(prisma);
      const appointment = await completedAppointment(shop);
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 1 });
      await reviews.hide(AS_ADMIN(), review.id, { hiddenReason: 'Spam.' });

      // Scoped to a business with nothing visible: the page is empty and the
      // platform-wide count still moved, which is the distinction being made.
      const visibleOnly = await reviews.listForModeration(AS_ADMIN(), {
        businessId: shop.businessId,
        visibility: 'VISIBLE',
      });
      expect(visibleOnly.reviews).toHaveLength(0);
      expect(visibleOnly.hiddenCount).toBe(before + 1);
    });

    it.each(['CUSTOMER', 'BUSINESS'])('refuses a %s', async (role) => {
      await expect(
        reviews.listForModeration(asUser(alpha.userId, role), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("the console's review desk (§248)", () => {
    const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');

    /** A shop of its own, with a name worth searching for. */
    const namedShop = async (name: string, logoUrl: string | null = null) => {
      const shop = await createBusiness(prisma);
      await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { name, logoUrl } });
      return shop;
    };

    it('searches the words, the reviewer and the shop', async () => {
      const shop = await namedShop('Searchable Salon 248');
      const appointment = await completedAppointment(shop);
      const review = await reviews.create(customerA.userId, appointment.id, {
        rating: 2,
        comment: 'The fade was uneven on one side.',
      });
      const scope = { businessId: shop.businessId };

      for (const q of ['UNEVEN on one', 'searchable salon', customerA.email.slice(0, 12)]) {
        const found = await reviews.listForModeration(AS_ADMIN(), { ...scope, q });
        expect(found.reviews.map((r) => r.id)).toEqual([review.id]);
      }
      const none = await reviews.listForModeration(AS_ADMIN(), { ...scope, q: 'nothing-like-this-248' });
      expect(none.total).toBe(0);
    });

    it('filters to exactly one number of stars', async () => {
      const shop = await namedShop('Star Count Shop');
      const four = await reviews.create(customerA.userId, (await completedAppointment(shop)).id, { rating: 4 });
      await reviews.create(customerB.userId, (await completedAppointment(shop, customerB.userId)).id, { rating: 5 });

      const page = await reviews.listForModeration(AS_ADMIN(), { businessId: shop.businessId, rating: 4 });
      expect(page.reviews.map((r) => r.id)).toEqual([four.id]);
    });

    it('counts what customers see by star, and the hidden apart, whatever the filter', async () => {
      const shop = await namedShop('Breakdown Barbers');
      await reviews.create(customerA.userId, (await completedAppointment(shop)).id, { rating: 5 });
      await reviews.create(customerB.userId, (await completedAppointment(shop, customerB.userId)).id, { rating: 4 });
      const hidden = await reviews.create(customerA.userId, (await completedAppointment(shop)).id, { rating: 1 });
      await reviews.hide(AS_ADMIN(), hidden.id, { hiddenReason: 'Abusive.' });

      // The filter narrows the rows, never the counts.
      const page = await reviews.listForModeration(AS_ADMIN(), {
        businessId: shop.businessId,
        visibility: 'HIDDEN',
        rating: 1,
      });
      expect(page.reviews.map((r) => r.id)).toEqual([hidden.id]);
      expect(page.breakdown).toEqual({ stars: [0, 0, 0, 1, 1], visible: 2, hidden: 1, ratingAvg: 4.5 });
    });

    it('has no average, rather than zero, when nothing is showing', async () => {
      const shop = await namedShop('Quiet Shop');
      const page = await reviews.listForModeration(AS_ADMIN(), { businessId: shop.businessId });
      expect(page.breakdown).toEqual({ stars: [0, 0, 0, 0, 0], visible: 0, hidden: 0, ratingAvg: null });
    });

    it("carries the booking, its service and the shop's logo", async () => {
      const shop = await namedShop('Logo Lounge', 'https://example.com/logo-248.png');
      const appointment = await completedAppointment(shop);
      await reviews.create(customerA.userId, appointment.id, { rating: 3 });
      const service = await prisma.service.findUniqueOrThrow({ where: { id: shop.serviceId }, select: { name: true } });

      const [row] = (await reviews.listForModeration(AS_ADMIN(), { businessId: shop.businessId })).reviews;
      expect(row.appointmentId).toBe(appointment.id);
      expect(row.serviceName).toBe(service.name);
      expect(row.businessLogoUrl).toBe('https://example.com/logo-248.png');
      expect(row.businessName).toBe('Logo Lounge');
    });

    it('reads lowest first when asked, newest first otherwise', async () => {
      const shop = await namedShop('Order Shop');
      await reviews.create(customerA.userId, (await completedAppointment(shop)).id, { rating: 3 });
      await reviews.create(customerB.userId, (await completedAppointment(shop, customerB.userId)).id, { rating: 1 });
      await reviews.create(customerA.userId, (await completedAppointment(shop)).id, { rating: 5 });
      const scope = { businessId: shop.businessId };

      const lowest = await reviews.listForModeration(AS_ADMIN(), { ...scope, sort: ReviewOrder.LOWEST });
      expect(lowest.reviews.map((r) => r.rating)).toEqual([1, 3, 5]);
      const newest = await reviews.listForModeration(AS_ADMIN(), scope);
      expect(newest.reviews.map((r) => r.rating)).toEqual([5, 1, 3]);
    });
  });

  describe('moderation', () => {
    it('rejects hiding an already-hidden review', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });
      await reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, { hiddenReason: 'Spam.' });

      await expect(
        reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, { hiddenReason: 'Again.' }),
      ).rejects.toThrow(/already hidden/);
    });

    it('rejects unhiding a review that is not hidden', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, { rating: 2 });

      await expect(reviews.unhide(asUser(admin.userId, 'ADMIN'), review.id)).rejects.toThrow(/not hidden/);
    });

    describe('moderation is admin-only at the service level (§41)', () => {
      const NON_ADMINS = ['CUSTOMER', 'BUSINESS'];

      it.each(NON_ADMINS)('refuses a %s hiding a review', async (role) => {
        const appointment = await completedAppointment();
        const review = await reviews.create(customerA.userId, appointment.id, {
          rating: 1,
          comment: 'Unflattering.',
        });

        await expect(
          reviews.hide(asUser(alpha.userId, role), review.id, { hiddenReason: 'Dislike.' }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        // And nothing was hidden.
        const row = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
        expect(row.hiddenAt).toBeNull();
      });

      it.each(NON_ADMINS)('refuses a %s unhiding a review', async (role) => {
        const appointment = await completedAppointment();
        const review = await reviews.create(customerA.userId, appointment.id, { rating: 1 });
        await reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, {
          hiddenReason: 'Spam.',
        });

        await expect(
          reviews.unhide(asUser(alpha.userId, role), review.id),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const row = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
        expect(row.hiddenAt).not.toBeNull();
      });
    });

    it('keeps the row after hiding — it is evidence, not deleted', async () => {
      const appointment = await completedAppointment();
      const review = await reviews.create(customerA.userId, appointment.id, {
        rating: 1,
        comment: 'Evidence.',
      });
      await reviews.hide(asUser(admin.userId, 'ADMIN'), review.id, { hiddenReason: 'Under dispute.' });

      const row = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(row.comment).toBe('Evidence.');
      expect(row.hiddenReason).toBe('Under dispute.');
      expect(row.hiddenById).toBe(admin.userId);
    });
  });

  // ------------------------------------------------------------------
  // Display names (§31)
  // ------------------------------------------------------------------

  describe('display names', () => {
    // Built rather than typed, so they survive an editor and a diff intact.
    const ZWSP = String.fromCharCode(0x200b);
    const NUL = String.fromCharCode(0);

    /** What the DTO layer does to a value before the service ever sees it. */
    const validateDto = async (cls: any, payload: Record<string, unknown>) => {
      const dto = plainToInstance(cls, payload);
      const errors = await validate(dto as object);
      return { dto: dto as { displayName?: string }, errors };
    };

    const storedName = async (userId: string) =>
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { displayName: true },
        })
      ).displayName;

    describe('setting and changing the name', () => {
      it('stores the name given when the review is created', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);

        const review = await reviews.create(customer.userId, appointment.id, {
          rating: 5,
          displayName: 'Akuei J.',
        });

        expect(review.displayName).toBe('Akuei J.');
        expect(await storedName(customer.userId)).toBe('Akuei J.');
      });

      it('leaves an existing name untouched when the field is omitted', async () => {
        const customer = await createCustomer(prisma);
        const first = await completedAppointment(alpha, customer.userId);
        await reviews.create(customer.userId, first.id, {
          rating: 5,
          displayName: 'Nyandeng',
        });

        const second = await completedAppointment(alpha, customer.userId);
        const review = await reviews.create(customer.userId, second.id, { rating: 3 });

        // Omitting is not clearing: the second review publishes under the name
        // they already chose.
        expect(review.displayName).toBe('Nyandeng');
        expect(await storedName(customer.userId)).toBe('Nyandeng');
      });

      it('overwrites the name when supplied on an edit - last write wins', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);
        const review = await reviews.create(customer.userId, appointment.id, {
          rating: 4,
          displayName: 'Old Name',
        });

        const updated = await reviews.update(customer.userId, review.id, {
          displayName: 'New Name',
        });

        expect(updated.displayName).toBe('New Name');
        expect(await storedName(customer.userId)).toBe('New Name');
      });

      it('accepts a display name as the only field on an edit', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);
        const review = await reviews.create(customer.userId, appointment.id, {
          rating: 4,
          comment: 'Unchanged.',
        });

        const updated = await reviews.update(customer.userId, review.id, {
          displayName: 'Renamed',
        });

        expect(updated.rating).toBe(4);
        expect(updated.comment).toBe('Unchanged.');
        // Renaming yourself is not an edit to the review's content, so the
        // "edited" marker a reader relies on is not raised by it.
        expect(updated.editedAt).toBeNull();
      });

      it('still rejects an edit that changes nothing at all', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);
        const review = await reviews.create(customer.userId, appointment.id, { rating: 4 });

        await expect(
          reviews.update(customer.userId, review.id, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('renames the byline on EVERY review the customer has left', async () => {
        // A fresh business, so the listing contains only this customer's work.
        const shop = await createBusiness(prisma);
        const customer = await createCustomer(prisma);
        const a = await completedAppointment(shop, customer.userId);
        const b = await completedAppointment(shop, customer.userId);
        const first = await reviews.create(customer.userId, a.id, {
          rating: 5,
          displayName: 'Before',
        });
        await reviews.create(customer.userId, b.id, { rating: 4 });

        await reviews.update(customer.userId, first.id, { displayName: 'After' });

        const list = await reviews.listForLocation(shop.locationId, undefined, {});
        expect(list.reviews).toHaveLength(2);
        // Including the review that was never edited: one name, one place.
        expect(list.reviews.map((r) => r.displayName)).toEqual(['After', 'After']);
      });

      it('rejects a display name change aimed at another customer review', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);
        const review = await reviews.create(customer.userId, appointment.id, { rating: 5 });

        await expect(
          reviews.update(customerB.userId, review.id, { displayName: 'Hijack' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        // Neither their own name nor the author's was written.
        expect(await storedName(customerB.userId)).toBeNull();
        expect(await storedName(customer.userId)).toBeNull();
      });
    });

    describe('Anonymous is rendered, never stored', () => {
      it('renders a customer with no name as Anonymous', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);

        const review = await reviews.create(customer.userId, appointment.id, { rating: 5 });

        expect(review.displayName).toBe('Anonymous');
        // Rendered on the way out. Nothing was written.
        expect(await storedName(customer.userId)).toBeNull();
      });

      it('keeps a customer who typed Anonymous distinguishable from one who did not', async () => {
        const chose = await createCustomer(prisma);
        const skipped = await createCustomer(prisma);
        const a = await completedAppointment(alpha, chose.userId);
        const b = await completedAppointment(alpha, skipped.userId);

        const chosen = await reviews.create(chose.userId, a.id, {
          rating: 5,
          displayName: 'Anonymous',
        });
        const blank = await reviews.create(skipped.userId, b.id, { rating: 5 });

        // Identical to a reader...
        expect(chosen.displayName).toBe('Anonymous');
        expect(blank.displayName).toBe('Anonymous');
        // ...and never identical in the database. This is the whole reason the
        // literal string is not written on a customer's behalf.
        expect(await storedName(chose.userId)).toBe('Anonymous');
        expect(await storedName(skipped.userId)).toBeNull();
      });
    });

    describe('validation', () => {
      const REJECTED: Array<[string, string]> = [
        ['a single character', 'A'],
        ['a single character once trimmed', '   B   '],
        ['nothing but whitespace', '     '],
        ['41 characters', 'x'.repeat(41)],
        ['an email address', 'jane.doe@example.com'],
        ['an email address with surrounding words', 'mail me at jane@example.com'],
        ['a full URL', 'https://example.com/me'],
        ['a www address', 'www.example.com'],
        ['a bare domain', 'example.com'],
        ['a mailto scheme', 'mailto:jane@example'],
        ['a name that is only invisible characters', ZWSP + ZWSP + ZWSP],
        ['padding that hides a too-short name', ZWSP + 'A' + ZWSP],
      ];

      it.each(REJECTED)('rejects %s', async (_label, value) => {
        const { errors } = await validateDto(CreateReviewDto, {
          rating: 5,
          displayName: value,
        });
        expect(errors.map((e) => e.property)).toContain('displayName');
      });

      it.each(REJECTED)('rejects %s on an edit too', async (_label, value) => {
        const { errors } = await validateDto(UpdateReviewDto, { displayName: value });
        expect(errors.map((e) => e.property)).toContain('displayName');
      });

      const ACCEPTED: Array<[string, string, string]> = [
        ['the shortest allowed name', 'Jo', 'Jo'],
        ['a name needing trimming', '   Kwame   ', 'Kwame'],
        ['exactly 40 characters', 'y'.repeat(40), 'y'.repeat(40)],
        ['a hyphenated name', 'Anne-Marie', 'Anne-Marie'],
        ['an initial and a surname', 'J. Smith', 'J. Smith'],
        ['a name carrying a control character', 'Jo' + NUL + 'hn', 'John'],
        ['a name padded with zero-width characters', ZWSP + 'Ama' + ZWSP, 'Ama'],
      ];

      it.each(ACCEPTED)('accepts %s', async (_label, value, expected) => {
        const { dto, errors } = await validateDto(CreateReviewDto, {
          rating: 5,
          displayName: value,
        });
        expect(errors).toHaveLength(0);
        // Stripping and trimming happen BEFORE the length rules, so what is
        // stored is exactly what was measured.
        expect(dto.displayName).toBe(expected);
      });

      it('leaves the field absent when it is not supplied', async () => {
        const { dto, errors } = await validateDto(CreateReviewDto, { rating: 5 });
        expect(errors).toHaveLength(0);
        expect(dto.displayName).toBeUndefined();
      });
    });

    describe('exposure', () => {
      let owner: { userId: string; email: string };
      let shop: TestBusiness;

      beforeAll(async () => {
        shop = await createBusiness(prisma);
        owner = await createCustomer(prisma);
        const appointment = await completedAppointment(shop, owner.userId);
        await reviews.create(owner.userId, appointment.id, {
          rating: 5,
          displayName: 'Public Name',
        });
      });

      it('shows an anonymous reader the name and nothing else about the customer', async () => {
        const list = await reviews.listForLocation(shop.locationId, undefined, {});

        expect(list.reviews[0].displayName).toBe('Public Name');
        expect(list.reviews[0]).not.toHaveProperty('customer');
        expect(list.reviews[0]).not.toHaveProperty('customerId');
        const serialised = JSON.stringify(list);
        expect(serialised).not.toContain(owner.email);
        expect(serialised).not.toContain(owner.userId);
      });

      it('shows the owning business id and email as before, plus the name', async () => {
        const list = await reviews.listForLocation(
          shop.locationId,
          asUser(shop.userId, 'BUSINESS'),
          {},
        );

        expect(list.reviews[0].displayName).toBe('Public Name');
        expect(list.reviews[0].customer).toEqual({
          id: owner.userId,
          email: owner.email,
        });
      });

      it('shows an admin the same as the owning business', async () => {
        const list = await reviews.listForLocation(
          shop.locationId,
          asUser(admin.userId, 'ADMIN'),
          {},
        );

        expect(list.reviews[0].displayName).toBe('Public Name');
        expect(list.reviews[0].customer).toEqual({
          id: owner.userId,
          email: owner.email,
        });
      });

      it('gives a DIFFERENT business the name but no identity', async () => {
        const list = await reviews.listForLocation(
          shop.locationId,
          asUser(beta.userId, 'BUSINESS'),
          {},
        );

        expect(list.reviews[0].displayName).toBe('Public Name');
        expect(list.reviews[0]).not.toHaveProperty('customer');
        expect(JSON.stringify(list)).not.toContain(owner.email);
      });
    });

    describe('admin moderation', () => {
      it('clears the name back to null, not to the literal string', async () => {
        const customer = await createCustomer(prisma);
        const appointment = await completedAppointment(alpha, customer.userId);
        await reviews.create(customer.userId, appointment.id, {
          rating: 5,
          displayName: 'Bad Name',
        });

        await users.clearDisplayName(
          { userId: admin.userId, role: 'ADMIN' },
          customer.userId,
          { reason: 'Impersonates a business.' },
        );

        expect(await storedName(customer.userId)).toBeNull();
      });

      it('changes what every existing review of that customer shows', async () => {
        const customer = await createCustomer(prisma);
        const shop = await createBusiness(prisma);
        const a = await completedAppointment(shop, customer.userId);
        const b = await completedAppointment(shop, customer.userId);
        await reviews.create(customer.userId, a.id, { rating: 5, displayName: 'Slur' });
        await reviews.create(customer.userId, b.id, { rating: 4 });

        const before = await reviews.listForLocation(shop.locationId, undefined, {});
        expect(before.reviews.every((r) => r.displayName === 'Slur')).toBe(true);

        await users.clearDisplayName(
          { userId: admin.userId, role: 'ADMIN' },
          customer.userId,
          { reason: 'Abusive.' },
        );

        // One action, every review - which is the argument for holding the
        // name on the user rather than copying it onto each review.
        const after = await reviews.listForLocation(shop.locationId, undefined, {});
        expect(after.reviews).toHaveLength(2);
        expect(after.reviews.every((r) => r.displayName === 'Anonymous')).toBe(true);
      });

      it('notifies the customer, the way review hiding does', async () => {
        const customer = await createCustomer(prisma);
        const notifications = moduleRef.get(NotificationsService);
        const spy = notifications.notify as unknown as { mock: { calls: any[][] } };
        const before = spy.mock.calls.length;

        await users.clearDisplayName(
          { userId: admin.userId, role: 'ADMIN' },
          customer.userId,
          { reason: 'Contains a phone number.' },
        );

        const call = spy.mock.calls[before][0];
        expect(call.recipientId).toBe(customer.userId);
        expect(call.type).toBe('DISPLAY_NAME_CLEARED');
        expect(call.context.reason).toBe('Contains a phone number.');
      });

      it.each(['CUSTOMER', 'BUSINESS'])(
        'refuses a %s at the service level, not only in the guard',
        async (role) => {
          const customer = await createCustomer(prisma);
          const appointment = await completedAppointment(alpha, customer.userId);
          await reviews.create(customer.userId, appointment.id, {
            rating: 5,
            displayName: 'Keep Me',
          });

          await expect(
            users.clearDisplayName({ userId: customerB.userId, role }, customer.userId, {
              reason: 'I do not like it.',
            }),
          ).rejects.toBeInstanceOf(ForbiddenException);

          expect(await storedName(customer.userId)).toBe('Keep Me');
        },
      );

      it('404s on a user that does not exist', async () => {
        await expect(
          users.clearDisplayName(
            { userId: admin.userId, role: 'ADMIN' },
            '00000000-0000-4000-8000-000000000000',
            { reason: 'Nobody.' },
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('requires a reason', async () => {
        const missing = await validateDto(ClearDisplayNameDto, {});
        expect(missing.errors.map((e) => e.property)).toContain('reason');

        const tooShort = await validateDto(ClearDisplayNameDto, { reason: 'x' });
        expect(tooShort.errors.map((e) => e.property)).toContain('reason');
      });
    });
  });
});
