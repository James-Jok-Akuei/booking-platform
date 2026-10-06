import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationStatus,
  NotificationType,
  BusinessMemberStatus,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  MarkAllReadDto,
  MarkReadDto,
  NOTIFICATION_SELECT,
  DismissedDto,
  DismissedManyDto,
} from './dto/notification-response.dto';
import {
  NOTIFICATION_CHANNEL,
  NotificationChannelDriver,
} from './notification-channel.interface';
import { AppointmentContext, renderNotification } from './notification-templates';

/** Give up after this many failed sends; the row stays FAILED for inspection. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(NOTIFICATION_CHANNEL) private readonly driver: NotificationChannelDriver,
  ) {
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
  }

  /**
   * Records a notification and attempts to deliver it.
   *
   * NEVER throws. A notification is a side effect of something that already
   * happened — a booking, a payment, a cancellation — and none of those should
   * roll back because SMTP was briefly unreachable. Delivery failures are
   * recorded on the row and retried by the sweep.
   */
  async notify(params: {
    recipientId: string;
    type: NotificationType;
    context: AppointmentContext & { inviterEmail?: string; role?: string };
    appointmentId?: string;
  }): Promise<void> {
    try {
      const { subject, body } = renderNotification(params.type, {
        ...params.context,
        timeZone: this.timeZone,
      });

      const notification = await this.prisma.notification.create({
        data: {
          recipientId: params.recipientId,
          type: params.type,
          channel: this.driver.channel,
          subject,
          body,
          appointmentId: params.appointmentId,
        },
        select: { id: true },
      });

      await this.dispatch(notification.id);
    } catch (error) {
      // Even creating the row must not break the caller.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to raise ${params.type} notification for ${params.recipientId}: ${message}`,
      );
    }
  }

  /**
   * Sends to an email address that has no account yet.
   *
   * Business invitations are the case: the whole point is to reach someone who
   * has not signed up, and Notification.recipientId is a foreign key to users,
   * so there is no row to create. The message is rendered by the same templates
   * and sent through the same channel — it simply has no inbox entry, which is
   * correct, because there is no inbox to put it in.
   */
  async notifyUnregisteredEmail(params: {
    email: string;
    type: NotificationType;
    context: AppointmentContext & { inviterEmail?: string; role?: string };
  }): Promise<void> {
    try {
      const { subject, body } = renderNotification(params.type, {
        ...params.context,
        timeZone: this.timeZone,
      });
      await this.driver.send({ destination: params.email, subject, body });
      this.logger.log(
        `Sent ${params.type} to ${params.email} (no account yet, so no inbox row).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // No row exists to retry from, so this is logged and dropped. An owner
      // whose invitee never received an email can revoke and re-invite.
      this.logger.error(
        `Failed to send ${params.type} to unregistered ${params.email}: ${message}`,
      );
    }
  }

  /** Notifies every ACTIVE member of a business — owner, managers and staff. */
  async notifyBusiness(params: {
    businessId: string;
    type: NotificationType;
    context: AppointmentContext;
    appointmentId?: string;
  }): Promise<void> {
    const members = await this.prisma.businessMembership.findMany({
      where: { businessProfileId: params.businessId, status: BusinessMemberStatus.ACTIVE },
      select: { userId: true },
    });

    // Everyone, not just the owner: staff run the day's appointments (§16.6),
    // so a booking nobody on the floor hears about is the problem this module
    // exists to fix. Per-person preferences are a later concern.
    await Promise.all(
      members.map((member) =>
        this.notify({
          recipientId: member.userId,
          type: params.type,
          context: params.context,
          appointmentId: params.appointmentId,
        }),
      ),
    );
  }

  /** Sends one stored notification, recording the outcome either way. */
  async dispatch(notificationId: string): Promise<boolean> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        subject: true,
        body: true,
        type: true,
        failureCount: true,
        recipient: { select: { email: true } },
      },
    });
    if (!notification) return false;

    if (!this.driver.isConfigured()) {
      await this.recordFailure(notification.id, notification.failureCount, 'Channel not configured.');
      return false;
    }

    try {
      await this.driver.send({
        destination: notification.recipient.email,
        subject: notification.subject,
        body: notification.body,
      });

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
      });
      this.logger.log(
        `Sent ${notification.type} to ${notification.recipient.email} (${notification.id}).`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(notification.id, notification.failureCount, message);
      return false;
    }
  }

  private async recordFailure(id: string, failureCount: number, error: string) {
    const attempts = failureCount + 1;
    await this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationStatus.FAILED,
        failureCount: attempts,
        lastError: error.slice(0, 500),
      },
    });
    this.logger.warn(
      `Notification ${id} failed (attempt ${attempts}/${MAX_NOTIFICATION_ATTEMPTS}): ${error}`,
    );
  }

  // ---------- Inbox ----------

  async list(recipientId: string, unreadOnly: boolean, limit: number, offset: number) {
    // A dismissed one is gone from the inbox and from the badge (§159).
    const where: Prisma.NotificationWhereInput = {
      recipientId,
      dismissedAt: null,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [total, unread, notifications] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientId, readAt: null, dismissedAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: NOTIFICATION_SELECT,
      }),
    ]);

    return { total, unread, limit, offset, notifications };
  }

  /**
   * Marks one notification read.
   *
   * Scoped by recipientId, so someone else's notification simply matches no
   * row — the same structural ownership rule used everywhere else.
   */
  async markRead(recipientId: string, notificationId: string): Promise<MarkReadDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, readAt: null },
      data: { readAt: new Date() },
    });

    if (count === 0) {
      // Either it is not theirs, or it was already read. Both are fine to
      // report as success — marking read is idempotent — but a missing row
      // must not leak that someone else's notification exists.
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, recipientId },
      });
      if (exists === 0) return { message: 'Notification not found.', updated: false };
    }

    return { message: 'Notification marked as read.', updated: count > 0 };
  }

  async markAllRead(recipientId: string): Promise<MarkAllReadDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
    return { message: `${count} notification(s) marked as read.`, updated: count };
  }

  /**
   * Takes one off the list (§159). Marked, never deleted — the row is also the
   * record of the email that was sent. Someone else's, or one already gone,
   * matches no row and is reported as not found without saying which.
   */
  async dismiss(recipientId: string, notificationId: string): Promise<DismissedDto> {
    const now = new Date();
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, dismissedAt: null },
      // Taking it off the list is also having seen it.
      data: { dismissedAt: now, readAt: now },
    });
    if (count === 0) throw new NotFoundException('Notification not found.');
    return { id: notificationId, dismissed: true };
  }

  /** Clears every notification already read: what "tidy up" means (§159). */
  async dismissRead(recipientId: string): Promise<DismissedManyDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: { not: null }, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    return { dismissed: count };
  }
}
