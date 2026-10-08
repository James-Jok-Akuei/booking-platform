import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessMemberStatus,
  BusinessStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { HideReviewDto } from './dto/hide-review.dto';
import { ListReviewsDto, ReviewOrder } from './dto/list-reviews.dto';
import { ListAdminReviewsDto } from './dto/list-admin-reviews.dto';
import { REVIEW_EDIT_WINDOW_DAYS, isPastEditWindow } from './review-window';

/** What everyone may see about a review. Customer identity is added separately. */
const REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  editedAt: true,
  responseText: true,
  responseAt: true,
  responseEditedAt: true,
  createdAt: true,
  locationId: true,
  businessId: true,
  // The byline. Always selected, for every viewer, because a review with no
  // attribution at all is what the platform showed before §31 and it read as
  // broken. Only the NAME is public — never the id or the email.
  customer: { select: { displayName: true } },
} as const;

/** What a review with no display name is shown as. Never stored; see §31. */
export const ANONYMOUS_DISPLAY_NAME = 'Anonymous';

/**
 * Turns the selected customer row into the byline the caller is entitled to.
 *
 * The nested `customer` object is always replaced, never passed through: that
 * is what stops a `displayName`-only select from leaking a field somebody
 * later adds to it. A viewer entitled to identity gets `{ id, email }` back
 * exactly as before, alongside the name.
 */
function withByline<
  T extends { customer: { displayName: string | null; id?: string; email?: string } },
>(
  row: T,
): Omit<T, 'customer'> & {
  displayName: string;
  /**
   * Present only for a viewer entitled to the customer's identity (§28.6).
   *
   * Declared explicitly, because the inferred type was a UNION of the two
   * branches below — and a union member without `customer` makes reading
   * `.customer` a compile error even where it is genuinely there. Tests
   * asserting the business-side shape were correct and the type was not; that
   * only became visible once `test/` was typechecked (§59).
   */
  customer?: { id?: string; email?: string };
} {
  const { customer, ...rest } = row;
  const displayName = customer.displayName ?? ANONYMOUS_DISPLAY_NAME;

  return customer.id !== undefined
    ? { ...rest, displayName, customer: { id: customer.id, email: customer.email } }
    : { ...rest, displayName };
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Creation ----------

  /**
   * Reviews a completed appointment.
   *
   * Both preconditions are checked here, not only in a guard: the appointment
   * must be COMPLETED, and the caller must be the customer on it. A guard
   * cannot see either without repeating this query.
   */
  async create(customerId: string, appointmentId: string, dto: CreateReviewDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        customerId: true,
        locationId: true,
        location: { select: { businessId: true } },
      },
    });

    // 404, not 403, for someone else's appointment — the same rule used
    // everywhere: do not confirm that a record exists to a stranger.
    if (!appointment || appointment.customerId !== customerId) {
      throw new NotFoundException('Appointment not found.');
    }

    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new BadRequestException(
        `Only a completed appointment can be reviewed. This one is ${appointment.status}.`,
      );
    }

    // businessId and locationId come from the appointment, never the body: a
    // review has to describe where the service actually happened.
    const locationId = appointment.locationId;
    const businessId = appointment.location.businessId;

    try {
      const review = await this.prisma.$transaction(async (tx) => {
        // Same transaction as the review itself. A review that posted while
        // its byline failed to save would publish under the customer's OLD
        // name, or under none — visibly not what they just asked for.
        if (dto.displayName !== undefined) {
          await tx.user.update({
            where: { id: customerId },
            data: { displayName: dto.displayName },
          });
        }

        const created = await tx.review.create({
          data: {
            appointmentId,
            customerId,
            businessId,
            locationId,
            rating: dto.rating,
            comment: dto.comment ?? null,
          },
          select: REVIEW_SELECT,
        });

        // Same transaction as the write, so the aggregate can never disagree
        // with the rows it summarises.
        await this.recalculateLocationRating(tx, locationId);

        return created;
      });

      await this.notifyBusiness(businessId, NotificationType.REVIEW_CREATED, {
        rating: dto.rating,
        locationId,
      });

      this.logger.log(
        `Review ${review.id} created for location ${locationId} (${dto.rating}/5).`,
      );

      return withByline(review);
    } catch (error) {
      // The unique index is the real guard against double submission — a
      // read-then-write check loses the race between two concurrent posts.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This appointment has already been reviewed.');
      }
      throw error;
    }
  }

  // ---------- Customer edit ----------

  /**
   * Edits rating or comment, within the window.
   *
   * There is deliberately no delete: delete-and-repost is how a review escapes
   * a business response it did not like.
   */
  async update(customerId: string, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, customerId },
      select: { id: true, createdAt: true, locationId: true },
    });
    if (!review) throw new NotFoundException('Review not found.');

    if (isPastEditWindow(review.createdAt)) {
      throw new BadRequestException(
        `A review can only be edited within ${REVIEW_EDIT_WINDOW_DAYS} days of posting.`,
      );
    }

    const changesReview = dto.rating !== undefined || dto.comment !== undefined;
    if (!changesReview && dto.displayName === undefined) {
      throw new BadRequestException('Provide a rating, a comment, a display name, or any combination.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Last write wins, and it wins across every review this customer has
      // left — the name is one field on one user, which is the whole reason
      // it is not stored per review.
      if (dto.displayName !== undefined) {
        await tx.user.update({
          where: { id: customerId },
          data: { displayName: dto.displayName },
        });
      }

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
          // Surfaced in every response: a rating that changed after the
          // business replied is context the reader needs. Renaming yourself is
          // not an edit to the review, so it does not set this.
          ...(changesReview ? { editedAt: new Date() } : {}),
        },
        select: REVIEW_SELECT,
      });

      await this.recalculateLocationRating(tx, review.locationId);

      return withByline(updated);
    });
  }

  // ---------- Business response ----------

  async respond(userId: string, reviewId: string, dto: ReviewResponseDto) {
    const review = await this.requireBusinessReview(userId, reviewId);

    if (review.responseText) {
      throw new ConflictException(
        'This review already has a response. Edit it instead of posting a second one.',
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        responseText: dto.responseText,
        responseAt: new Date(),
        responseById: userId,
      },
      select: REVIEW_SELECT,
    });

    await this.notifications.notify({
      recipientId: review.customerId,
      type: NotificationType.REVIEW_RESPONSE,
      context: this.reviewContext('The business replied to your review.'),
    });

    return withByline(updated);
  }

  async updateResponse(userId: string, reviewId: string, dto: ReviewResponseDto) {
    const review = await this.requireBusinessReview(userId, reviewId);

    if (!review.responseText || !review.responseAt) {
      throw new BadRequestException('This review has no response to edit.');
    }
    if (isPastEditWindow(review.responseAt)) {
      throw new BadRequestException(
        `A response can only be edited within ${REVIEW_EDIT_WINDOW_DAYS} days of posting.`,
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { responseText: dto.responseText, responseEditedAt: new Date() },
      select: REVIEW_SELECT,
    });

    return withByline(updated);
  }

  /** Loads a review and proves the caller belongs to the business that owns it. */
  private async requireBusinessReview(userId: string, reviewId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: { userId, status: BusinessMemberStatus.ACTIVE },
      select: { businessProfileId: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'This account is not an active member of any business.',
      );
    }

    const review = await this.prisma.review.findFirst({
      // Scoped by business, so another business's review simply never matches.
      where: { id: reviewId, businessId: membership.businessProfileId },
      select: {
        id: true,
        customerId: true,
        responseText: true,
        responseAt: true,
      },
    });
    if (!review) throw new NotFoundException('Review not found.');

    return review;
  }

  // ---------- Moderation ----------

  async hide(
    actor: { userId: string; role: UserRole | string },
    reviewId: string,
    dto: HideReviewDto,
  ) {
    this.assertAdmin(actor);
    const adminId = actor.userId;

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, locationId: true, businessId: true, customerId: true, hiddenAt: true },
    });
    if (!review) throw new NotFoundException('Review not found.');
    if (review.hiddenAt) {
      throw new BadRequestException('This review is already hidden.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const hidden = await tx.review.update({
        where: { id: reviewId },
        data: {
          hiddenAt: new Date(),
          hiddenReason: dto.hiddenReason,
          hiddenById: adminId,
        },
        select: REVIEW_SELECT,
      });

      // The aggregate must exclude it immediately, in the same transaction —
      // a hidden review that still moves the star rating is not hidden.
      await this.recalculateLocationRating(tx, review.locationId);

      return hidden;
    });

    // Both sides are told: the author, because their words stopped being
    // visible, and the business, because its rating just moved.
    await this.notifications.notify({
      recipientId: review.customerId,
      type: NotificationType.REVIEW_HIDDEN,
      context: this.reviewContext(dto.hiddenReason),
    });
    await this.notifyBusiness(review.businessId, NotificationType.REVIEW_HIDDEN, {
      rating: 0,
      locationId: review.locationId,
    });

    this.logger.log(`Review ${reviewId} hidden by admin ${adminId}: ${dto.hiddenReason}`);

    return withByline(updated);
  }

  async unhide(actor: { userId: string; role: UserRole | string }, reviewId: string) {
    this.assertAdmin(actor);
    const adminId = actor.userId;

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, locationId: true, hiddenAt: true },
    });
    if (!review) throw new NotFoundException('Review not found.');
    if (!review.hiddenAt) {
      throw new BadRequestException('This review is not hidden.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const restored = await tx.review.update({
        where: { id: reviewId },
        data: { hiddenAt: null, hiddenReason: null, hiddenById: null },
        select: REVIEW_SELECT,
      });

      await this.recalculateLocationRating(tx, review.locationId);

      return restored;
    });

    this.logger.log(`Review ${reviewId} unhidden by admin ${adminId}.`);

    return withByline(updated);
  }

  /**
   * Moderation is admin-only, asserted here as well as by the guard (§41).
   *
   * Both methods previously took a bare `adminId` and trusted the caller to
   * have checked — a string parameter named after a role is not a check.
   */
  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can moderate reviews.');
    }
  }

  // ---------- Public listing ----------

  /**
   * A location's visible reviews, newest first.
   *
   * Matches the auth posture of the only other public `/locations` route,
   * `GET /locations/:id/availability` (§13.2): reachable without a token, but a
   * non-APPROVED business is 404 to anyone who is not one of its members.
   *
   * Customer identity is exposed only to the counterparty business (and
   * admins), never publicly — see the comment on `viewerSeesCustomer`.
   */
  async listForLocation(
    locationId: string,
    viewer: { userId: string; role: string } | undefined,
    query: ListReviewsDto,
  ) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        ratingAvg: true,
        ratingCount: true,
        businessId: true,
        business: {
          select: {
            status: true,
            members: {
              where: { status: BusinessMemberStatus.ACTIVE },
              select: { userId: true },
            },
          },
        },
      },
    });
    if (!location) throw new NotFoundException('Location not found.');

    const isMember = Boolean(
      viewer && location.business.members.some((m) => m.userId === viewer.userId),
    );
    const isAdmin = viewer?.role === UserRole.ADMIN;

    if (!isMember && !isAdmin && location.business.status !== BusinessStatus.APPROVED) {
      throw new NotFoundException('Location not found.');
    }

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    // Hidden reviews are excluded in the QUERY, not filtered afterwards.
    const visible: Prisma.ReviewWhereInput = { locationId, hiddenAt: null };
    const find = query.q?.trim();
    const where: Prisma.ReviewWhereInput = {
      ...visible,
      ...(query.rating ? { rating: query.rating } : {}),
      ...(query.replied === true ? { responseText: { not: null } } : {}),
      ...(query.replied === false ? { responseText: null } : {}),
      ...(find
        ? {
            OR: [
              { comment: { contains: find, mode: Prisma.QueryMode.insensitive } },
              { customer: { displayName: { contains: find, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };
    // Newest first unless asked otherwise; ties broken by date, so a page
    // boundary never repeats or skips a review (§215).
    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      query.sort === ReviewOrder.OLDEST
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : query.sort === ReviewOrder.LOWEST
          ? [{ rating: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
          : query.sort === ReviewOrder.HIGHEST
            ? [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'asc' }];

    const [total, reviews, byStars, waiting] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          ...REVIEW_SELECT,
          appointment: { select: { service: { select: { name: true } } } },
          // The public gets the byline and nothing else. id and email are
          // selected only for viewers entitled to identity — the counterparty
          // business and admins — so an anonymous reader cannot be handed them
          // by a later change to the shared select.
          customer: {
            select: {
              displayName: true,
              ...(isMember || isAdmin ? { id: true, email: true } : {}),
            },
          },
        },
      }),
      // Counted over every visible review, whatever the filter (§215).
      this.prisma.review.groupBy({ by: ['rating'], where: visible, _count: { _all: true } }),
      this.prisma.review.count({ where: { ...visible, responseText: null } }),
    ]);

    const stars = [1, 2, 3, 4, 5].map((n) => byStars.find((g) => g.rating === n)?._count._all ?? 0);
    const all = stars.reduce((sum, n) => sum + n, 0);

    return {
      locationId,
      // Served straight from the denormalised columns — never AVG() on a read.
      ratingAvg: location.ratingAvg ? Number(location.ratingAvg) : null,
      ratingCount: location.ratingCount,
      total,
      limit,
      offset,
      reviews: reviews.map(({ appointment, ...review }) => ({
        ...withByline(review),
        serviceName: appointment?.service.name ?? null,
      })),
      breakdown: { stars, replied: all - waiting, waiting },
    };
  }

  /**
   * The moderation queue (§93).
   *
   * The ONE listing that can return hidden reviews. Every other read excludes
   * them in the query — which is what makes hiding real — so an admin had no
   * way to see what they had hidden, or to find it again to unhide it.
   *
   * Identity is included because an admin is entitled to it (§28.6) and a
   * moderation decision about one customer's words cannot be made against
   * "Anonymous". Business and location names come with it: a reviewer's
   * sentence means little without knowing who it is about.
   */
  async listForModeration(
    actor: { userId: string; role: UserRole | string },
    query: ListAdminReviewsDto,
  ) {
    this.assertAdmin(actor);

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const visibility = query.visibility ?? 'ALL';

    const where: Prisma.ReviewWhereInput = {
      ...(visibility === 'HIDDEN' ? { hiddenAt: { not: null } } : {}),
      ...(visibility === 'VISIBLE' ? { hiddenAt: null } : {}),
      ...(query.maxRating !== undefined ? { rating: { lte: query.maxRating } } : {}),
      ...(query.businessId ? { businessId: query.businessId } : {}),
    };

    const [total, hiddenCount, reviews] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.count({ where: { hiddenAt: { not: null } } }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          rating: true,
          comment: true,
          editedAt: true,
          responseText: true,
          responseAt: true,
          createdAt: true,
          hiddenAt: true,
          hiddenReason: true,
          locationId: true,
          businessId: true,
          customer: { select: { id: true, email: true, displayName: true } },
          location: { select: { name: true } },
          businessProfile: { select: { name: true } },
          hiddenBy: { select: { email: true } },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      /** Across the whole platform, not this page — the number worth watching. */
      hiddenCount,
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        editedAt: review.editedAt,
        responseText: review.responseText,
        responseAt: review.responseAt,
        createdAt: review.createdAt,
        hiddenAt: review.hiddenAt,
        hiddenReason: review.hiddenReason,
        hiddenByEmail: review.hiddenBy?.email ?? null,
        locationId: review.locationId,
        locationName: review.location.name,
        businessId: review.businessId,
        businessName: review.businessProfile.name,
        customerId: review.customer.id,
        customerEmail: review.customer.email,
        displayName: review.customer.displayName ?? ANONYMOUS_DISPLAY_NAME,
      })),
    };
  }

  // ---------- Aggregates ----------

  /**
   * Recomputes a location's rating from its non-hidden reviews.
   *
   * Always called with the same `tx` as the change that triggered it, so the
   * aggregate and the rows can never disagree — a reader either sees both or
   * neither.
   */
  private async recalculateLocationRating(
    tx: Prisma.TransactionClient,
    locationId: string,
  ) {
    const aggregate = await tx.review.aggregate({
      where: { locationId, hiddenAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const count = aggregate._count._all;

    await tx.location.update({
      where: { id: locationId },
      data: {
        // Null rather than 0 when nothing is visible: "not yet rated" and
        // "rated zero" are different claims, and 0 is not a valid rating.
        ratingAvg:
          count > 0 && aggregate._avg.rating !== null
            ? new Prisma.Decimal(aggregate._avg.rating.toFixed(2))
            : null,
        ratingCount: count,
      },
    });
  }

  // ---------- Notifications ----------

  private reviewContext(detail?: string) {
    return {
      serviceName: 'Review',
      locationName: 'your location',
      businessName: 'the business',
      startTime: undefined as unknown as Date,
      reason: detail,
    };
  }

  private async notifyBusiness(
    businessId: string,
    type: NotificationType,
    meta: { rating: number; locationId: string },
  ) {
    await this.notifications.notifyBusiness({
      businessId,
      type,
      context: this.reviewContext(
        type === NotificationType.REVIEW_CREATED
          ? `A customer left a ${meta.rating}-star review.`
          : 'A review on your location was hidden by an administrator.',
      ),
    });
  }
}
