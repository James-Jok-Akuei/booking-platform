import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  PayoutDestinationStatus,
  BusinessStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
// One select, shared with the DTO describing its result (§128.5).
import { ADMIN_BUSINESS_SELECT } from './dto/admin-business-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { findBusinessTransition } from './business-status';
import { GO_LIVE_WORDS, READINESS_SELECT, goLiveGaps, listInWords, readinessView } from './readiness';
import { adviceItems, adviceToSend, type AdviceItem } from './shop-advice';
import { ListBusinessesDto } from './dto/list-businesses.dto';

/** What an admin reviewing an application needs to see. */
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

    const q = query.q?.trim();
    const where: Prisma.BusinessProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.submitted === 'true' ? { submittedAt: { not: null } } : {}),
      ...(query.submitted === 'false' ? { submittedAt: null } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              {
                members: {
                  some: { status: BusinessMemberStatus.ACTIVE, user: { email: { contains: q, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, businesses] = await Promise.all([
      this.prisma.businessProfile.count({ where }),
      this.prisma.businessProfile.findMany({
        where,
        // Oldest first: a queue sorted newest-first is one where the person who
        // has waited longest is read last. Waiting is counted from when the
        // shop asked to be reviewed (§255), not from when it signed up.
        orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
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
        // Where they are, as a reviewer needs to see it (§244): the pin, the
        // district, whether the branch is open, and its photos.
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            capacity: true,
            latitude: true,
            longitude: true,
            isActive: true,
            district: { select: { name: true, province: { select: { name: true } } } },
            media: { orderBy: { displayOrder: 'asc' }, take: 6, select: { url: true, status: true } },
          },
        },
        // The number they are to be paid to, if they have given one (§48).
        payoutDestinations: {
          where: { status: { not: PayoutDestinationStatus.SUPERSEDED } },
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { msisdn: true, provider: true, status: true },
        },
        services: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            depositPercentage: true,
            isActive: true,
            description: true,
            images: { orderBy: { displayOrder: 'asc' }, take: 1, select: { url: true } },
            // Price is per branch since §72, so an admin reviewing an
            // application sees where each service is offered and for how much —
            // which is more of the picture than one number ever was.
            locations: {
              select: {
                priceMinor: true,
                location: { select: { id: true, name: true } },
              },
            },
          },
        },
        members: {
          where: { status: BusinessMemberStatus.ACTIVE },
          select: { id: true, role: true, user: { select: { id: true, email: true } } },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found.');

    const shop = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: READINESS_SELECT,
    });
    return { ...business, readiness: readinessView(shop) };
  }

  /**
   * With advice, if the reviewer sends some (§303): of the things still
   * missing, the ones they chose, and their own note — in the approval notice,
   * and kept on the shop for its dashboard and the next reviewer.
   */
  approve(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    advice: { keys?: string[]; note?: string | null } = {},
  ) {
    return this.transition(actor, businessId, BusinessStatus.APPROVED, undefined, false, advice);
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
    advice: { keys?: string[]; note?: string | null } = {},
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

    // What the approval sends as advice (§303): worked out from the shop as it
    // is now, so nothing it has added since the panel opened is asked for.
    let advised: { items: AdviceItem[]; note: string | null } = { items: [], note: null };

    // An APPROVED business may be listed — the moment it posts itself (§268)
    // — so it must be one a customer can use (§53.1, §255): a name — a nameless listing is a blank in
    // search — and an open branch with hours and a service to book there. The
    // rest of the checklist (its phone, its type) is the shop's to finish and
    // an administrator's to judge. Reinstatement is an approval too.
    if (to === BusinessStatus.APPROVED) {
      const shop = await this.prisma.businessProfile.findUniqueOrThrow({
        where: { id: businessId },
        select: READINESS_SELECT,
      });
      if (!isReinstatement) advised = adviceToSend(adviceItems(shop), advice.keys, advice.note);
      const gaps = goLiveGaps(shop);
      if (gaps.includes('name')) {
        throw new BadRequestException(
          'This business has no name, so it cannot be approved — it would appear ' +
            'in search as a blank. Ask the business to complete its profile first.',
        );
      }
      if (gaps.length > 0) {
        throw new BadRequestException(
          `This business cannot go live yet: it still needs ${listInWords(gaps, GO_LIVE_WORDS)}. ` +
            'Listed without that, no customer could book it — ask the business to finish setting up.',
        );
      }
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
        // Kept after the shop fixes things and sends itself back (§255), so
        // whoever reviews it next can see what was asked.
        ...(to === BusinessStatus.REJECTED ? { lastRejectionReason: reason!.trim() } : {}),
        // What this approval advised, replacing any earlier one; none is none.
        ...(to === BusinessStatus.APPROVED && !isReinstatement
          ? {
              approvalAdvice:
                advised.items.length || advised.note
                  ? { keys: advised.items.map((item) => item.key), note: advised.note, at: new Date().toISOString() }
                  : Prisma.DbNull,
            }
          : {}),
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
      select: ADMIN_BUSINESS_SELECT,
    });

    this.logger.warn(
      `Business ${businessId} moved ${business.status} -> ${to} by admin ${actor.userId}` +
        (reason ? `: ${reason.trim()}` : '.') +
        (advised.items.length || advised.note
          ? ` Advised: ${advised.items.map((item) => item.key).join(', ') || 'a note only'}.`
          : ''),
    );

    await this.notifyMembers(businessId, to, isReinstatement, updated.statusReason, advised);

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
    advised: { items: AdviceItem[]; note: string | null },
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
        ...(advised.items.length || advised.note
          ? { advice: { items: advised.items.map(({ title, why }) => ({ title, why })), note: advised.note } }
          : {}),
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
