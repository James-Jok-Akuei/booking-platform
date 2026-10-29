import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BusinessMemberStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClearDisplayNameDto } from './dto/clear-display-name.dto';
import { ListUsersDto } from './dto/list-users.dto';
import {
  AdminUserPageDto,
  ClearedDisplayNameDto,
} from './dto/user-response.dto';
import { hasMoneyAccess } from './money-access';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Moderation for a review byline: clears it back to null.
   *
   * Back to NULL, not to the string "Anonymous". Null is what an unset name has
   * always meant and what readers render as "Anonymous" anyway; writing the
   * literal would make a moderated customer indistinguishable from one who
   * chose that word, which is the exact distinction §31 exists to keep.
   *
   * Clearing takes effect on every review the customer has ever left, because
   * the name is one field on one user. That is the point of storing it there,
   * and it is also why a single moderation action is enough.
   *
   * The role is asserted here as well as in the guard. @Roles on the controller
   * is a decorator on a class; a service method that trusts it is one
   * refactor away from being callable by anyone (§27.1).
   */
  /**
   * The user directory (§94).
   *
   * `clearDisplayName` was the only thing here, and it takes an id that nothing
   * produced: there was no list, no search and no way to look an account up.
   * A moderation action you cannot navigate to is not reachable.
   *
   * Counts rather than rows: what an admin needs from a list is whether this
   * account is real and active, not its history. The history is a question for
   * the screens that already show it.
   */
  async list(
    actor: { role: UserRole | string },
    query: ListUsersDto,
  ): Promise<AdminUserPageDto> {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can list users.');
    }

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.withDisplayName === 'true' ? { displayName: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { displayName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          role: true,
          displayName: true,
          imageUrl: true,
          createdAt: true,
          closedAt: true,
          homeDistrict: { select: { name: true } },
          // Sessions rotate on every renewal, so the newest is when their app
          // last came back (§250).
          refreshTokens: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
          /**
           * So the console can stop offering an action the server refuses
           * (§118). `revokeAdmin` turns down two cases — removing yourself, and
           * removing the primary administrator, because there must always be
           * one — and the directory carried neither fact, so every row got a
           * "Remove access" button including the reader's own.
           *
           * Meaningless on a CUSTOMER or BUSINESS row, where it is simply false.
           */
          isPrimaryAdmin: true,
          // Whether an administrator has two-step sign-in on (§298).
          totpEnabledAt: true,
          // Money access (§317).
          moneyAccess: true,
          moneyAccessAt: true,
          moneyAccessBy: true,
          // Whether the statistics leave them out (§316).
          isTest: true,
          testMarkedAt: true,
          testMarkedBy: true,
          _count: {
            select: {
              appointments: true,
              reviews: true,
              reportedTickets: true,
            },
          },
          // Only ACTIVE memberships: a removed one says where they used to
          // work, which is history rather than who they are now.
          businessMemberships: {
            where: { status: BusinessMemberStatus.ACTIVE },
            select: {
              role: true,
              businessProfile: { select: { id: true, name: true, logoUrl: true } },
            },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        imageUrl: user.imageUrl,
        createdAt: user.createdAt.toISOString(),
        closedAt: user.closedAt?.toISOString() ?? null,
        lastSeenAt: user.refreshTokens[0]?.createdAt.toISOString() ?? null,
        homeArea: user.homeDistrict?.name ?? null,
        isPrimaryAdmin: user.isPrimaryAdmin,
        twoStepOn: user.totpEnabledAt !== null,
        moneyAccess: hasMoneyAccess(user),
        moneyAccessAt: user.moneyAccessAt?.toISOString() ?? null,
        moneyAccessBy: user.moneyAccessBy,
        isTest: user.isTest,
        testMarkedAt: user.testMarkedAt?.toISOString() ?? null,
        testMarkedBy: user.testMarkedBy,
        appointmentCount: user._count.appointments,
        reviewCount: user._count.reviews,
        ticketCount: user._count.reportedTickets,
        businesses: user.businessMemberships.map((membership) => ({
          id: membership.businessProfile.id,
          name: membership.businessProfile.name,
          logoUrl: membership.businessProfile.logoUrl,
          role: membership.role,
        })),
      })),
    };
  }

  async clearDisplayName(
    actor: { userId: string; role: UserRole | string },
    targetUserId: string,
    dto: ClearDisplayNameDto,
  ): Promise<ClearedDisplayNameDto> {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can clear a display name.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, displayName: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { displayName: null },
      select: { id: true, email: true, displayName: true },
    });

    // Told for the same reason review hiding tells them: something they wrote
    // stopped being visible, and silent moderation reads as a bug.
    await this.notifications.notify({
      recipientId: targetUserId,
      type: NotificationType.DISPLAY_NAME_CLEARED,
      context: {
        serviceName: 'Review',
        locationName: 'your location',
        businessName: 'the business',
        startTime: undefined as unknown as Date,
        reason: dto.reason,
      },
    });

    this.logger.log(
      `Display name for user ${targetUserId} cleared by admin ${actor.userId}: ${dto.reason}`,
    );

    return updated;
  }
}
