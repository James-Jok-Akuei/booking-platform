import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus, NotificationStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, MAX_NOTIFICATION_ATTEMPTS } from './notifications.service';

/** How far ahead of an appointment the reminder goes out. */
export const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Reminds customers about appointments starting within the next 24 hours.
   *
   * Runs every 15 minutes rather than once a day, so an appointment booked
   * inside the reminder window still gets one promptly instead of waiting for
   * a nightly batch that has already run.
   *
   * Only BOOKED and IN_PROGRESS qualify: PENDING_PAYMENT is not yet a
   * commitment, and reminding someone about an appointment they never paid for
   * would be worse than silence.
   *
   * `reminderSentAt` is the dedup marker — set before the notification is
   * raised, so a slow send cannot cause a second reminder on the next cycle.
   */
  @Cron('0 */15 * * * *', { name: 'appointment-reminders' })
  async sendReminders(): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + REMINDER_LEAD_TIME_MS);

    const due = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.IN_PROGRESS] },
        reminderSentAt: null,
        startTime: { gt: now, lte: horizon },
      },
      select: {
        id: true,
        startTime: true,
        customerId: true,
        depositAmountMinor: true,
        currency: true,
        service: { select: { name: true } },
        location: {
          select: { name: true, business: { select: { name: true } } },
        },
      },
    });

    if (due.length === 0) return 0;

    let sent = 0;
    for (const appointment of due) {
      // Claimed first, and conditionally, so two overlapping runs cannot both
      // remind the same customer.
      const { count } = await this.prisma.appointment.updateMany({
        where: { id: appointment.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (count === 0) continue;

      await this.notifications.notify({
        recipientId: appointment.customerId,
        type: NotificationType.APPOINTMENT_REMINDER,
        appointmentId: appointment.id,
        context: {
          serviceName: appointment.service.name,
          locationName: appointment.location.name,
          businessName: appointment.location.business.name ?? 'the business',
          startTime: appointment.startTime,
          depositAmountMinor: appointment.depositAmountMinor,
          currency: appointment.currency,
        },
      });
      sent++;
      this.logger.log(
        `Reminder queued for appointment ${appointment.id}, starting ${appointment.startTime.toISOString()}.`,
      );
    }

    if (sent > 0) this.logger.log(`Appointment reminders: ${sent} sent.`);
    return sent;
  }

  /**
   * Retries notifications whose delivery failed.
   *
   * Every 5 minutes, giving up after MAX_NOTIFICATION_ATTEMPTS so a permanently
   * bad address cannot be retried forever. The row stays FAILED with its
   * lastError, which is what makes "why didn't they get told?" answerable.
   */
  @Cron('0 */5 * * * *', { name: 'notification-retry' })
  async retryFailed(): Promise<{ retried: number; recovered: number }> {
    const failed = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.FAILED,
        failureCount: { lt: MAX_NOTIFICATION_ATTEMPTS },
      },
      select: { id: true },
      take: 100,
    });

    if (failed.length === 0) return { retried: 0, recovered: 0 };

    let recovered = 0;
    for (const notification of failed) {
      if (await this.notifications.dispatch(notification.id)) recovered++;
    }

    this.logger.log(
      `Notification retry: ${failed.length} attempted, ${recovered} delivered.`,
    );
    return { retried: failed.length, recovered };
  }
}
