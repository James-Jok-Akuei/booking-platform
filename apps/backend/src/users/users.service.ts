import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClearDisplayNameDto } from './dto/clear-display-name.dto';

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
  async clearDisplayName(
    actor: { userId: string; role: UserRole | string },
    targetUserId: string,
    dto: ClearDisplayNameDto,
  ) {
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
