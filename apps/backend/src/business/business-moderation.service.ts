import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  BusinessStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { findBusinessTransition } from './business-status';
import { ListBusinessesDto } from './dto/list-businesses.dto';

/** What an admin reviewing an application needs to see. */
const ADMIN_BUSINESS_SELECT = {
  id: true,
  name: true,
  description: true,
  phone: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  statusChangedById: true,
  logoUrl: true,
  coverImageUrl: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
} as const;

const NOTIFICATION_FOR: Record<string, NotificationType> = {
  [BusinessStatus.APPROVED]: NotificationType.BUSINESS_APPROVED,
  [BusinessStatus.REJECTED]: NotificationType.BUSINESS_REJECTED,
  [BusinessStatus.SUSPENDED]: NotificationType.BUSINESS_SUSPENDED,
};

/**
 * Admin moderation of business applications (§42).
 *
 * Separate from `BusinessProfileService`, which is the business's own view of
 * itself. Mixing "what a business may edit" with "what an admin may decide
 * about it" in one service is how a self-service route eventually acquires the
 * ability to approve its own account.
 */
@Injectable()
export class BusinessModerationService {
  private readonly logger = new Logger(BusinessModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: { role: UserRole | string }, query: ListBusinessesDto) {
    this.assertAdmin(actor);

    const where: Prisma.BusinessProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, businesses] = await Promise.all([
      this.prisma.businessProfile.count({ where }),
      this.prisma.businessProfile.findMany({
        where,
        // Oldest first: a queue sorted newest-first is one where the person who
        // has waited longest is read last.
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
        select: ADMIN_BUSINESS_SELECT,
      }),
    ]);

    return { total, limit, offset, businesses };
  }

  async findOne(actor: { role: UserRole | string }, businessId: string) {
    this.assertAdmin(actor);

    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        ...ADMIN_BUSINESS_SELECT,
        locations: { select: { id: true, name: true, address: true, capacity: true } },
        services: {
          select: {
            id: true,
            name: true,
            priceMinor: true,
            durationMinutes: true,
            depositPercentage: true,
            isActive: true,
          },
        },
        members: {
          where: { status: BusinessMemberStatus.ACTIVE },
          select: { id: true, role: true, user: { select: { id: true, email: true } } },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found.');

    return business;
  }

  approve(actor: { userId: string; role: UserRole | string }, businessId: string) {
    return this.transition(actor, businessId, BusinessStatus.APPROVED);
  }

  reject(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    reason: string,
  ) {
    return this.transition(actor, businessId, BusinessStatus.REJECTED, reason);
  }

  suspend(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    reason: string,
  ) {
    return this.transition(actor, businessId, BusinessStatus.SUSPENDED, reason);
  }

  /** Reinstatement is the same move as approval, from SUSPENDED. */
  reinstate(actor: { userId: string; role: UserRole | string }, businessId: string) {
    return this.transition(actor, businessId, BusinessStatus.APPROVED, undefined, true);
  }

  /**
   * The single place a business's status changes.
   *
   * Every route funnels through here so the transition table, the audit stamp
   * and the notification cannot get out of step — the failure mode of the
   * appointment lifecycle, whose rules live in five separate methods (§16.1).
   */
  private async transition(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    to: BusinessStatus,
    reason?: string,
    isReinstatement = false,
  ) {
    this.assertAdmin(actor);

    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, status: true },
    });
    if (!business) throw new NotFoundException('Business not found.');

    const rule = findBusinessTransition(business.status, to);
    if (!rule) {
      throw new BadRequestException(
        `A business cannot move from ${business.status} to ${to}.`,
      );
    }

    // Reinstatement and approval are the same transition; the distinction only
    // exists so the two routes read honestly and send different copy.
    if (isReinstatement && business.status !== BusinessStatus.SUSPENDED) {
      throw new BadRequestException(
        `Only a SUSPENDED business can be reinstated. This one is ${business.status}.`,
      );
    }

    // An APPROVED business becomes publicly listed, and a listing with no name
    // is not something a customer can choose (§53.1). The approval queue itself
    // rendered a nameless row during the walk-through, which is not a decision
    // anyone can make.
    //
    // The COLUMN stays nullable: a profile mid-onboarding legitimately has no
    // name yet, and forcing one at creation would block the step before it.
    if (to === BusinessStatus.APPROVED && !business.name?.trim()) {
      throw new BadRequestException(
        'This business has no name, so it cannot be approved — it would appear ' +
          'in search as a blank. Ask the business to complete its profile first.',
      );
    }

    if (rule.requiresReason && !reason?.trim()) {
      throw new BadRequestException(
        `A reason is required to move a business to ${to}. The business is told ` +
          'what it says, and cannot act on a decision it has not been given.',
      );
    }

    const updated = await this.prisma.businessProfile.update({
      where: { id: businessId },
      data: {
        status: to,
        // Cleared on the way back to APPROVED: a stale rejection reason sitting
        // beside an approved business reads as an accusation.
        statusReason: rule.requiresReason ? reason!.trim() : null,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
      select: ADMIN_BUSINESS_SELECT,
    });

    this.logger.warn(
      `Business ${businessId} moved ${business.status} -> ${to} by admin ${actor.userId}` +
        (reason ? `: ${reason.trim()}` : '.'),
    );

    await this.notifyMembers(businessId, to, isReinstatement, updated.statusReason);

    return updated;
  }

  /**
   * Tells every ACTIVE member what happened, and why when there is a why.
   *
   * Being suspended without being told is worse than the suspension: the
   * business discovers it through a customer complaining that they cannot book.
   */
  private async notifyMembers(
    businessId: string,
    to: BusinessStatus,
    isReinstatement: boolean,
    reason: string | null,
  ) {
    const type = isReinstatement
      ? NotificationType.BUSINESS_REINSTATED
      : NOTIFICATION_FOR[to];
    if (!type) return;

    await this.notifications.notifyBusiness({
      businessId,
      type,
      context: {
        serviceName: 'Account status',
        locationName: 'your business',
        businessName: 'your business',
        startTime: undefined as unknown as Date,
        reason: reason ?? undefined,
      },
    });
  }

  /** Admin-only, asserted here as well as by the guard (§27.1, §41). */
  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }
}
