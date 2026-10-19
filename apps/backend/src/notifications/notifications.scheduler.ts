import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

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
   * The sweep (§287), every minute: whatever is due goes — a push held for
   * the morning, a message's email after its wait, a failed send's next try
   * (up to MAX_NOTIFICATION_ATTEMPTS), one interrupted half-way — and the
   * morning summaries. A delivery that keeps failing stays FAILED with its
   * lastError, which is what makes "why didn't they get told?" answerable.
   */
  @Cron('0 * * * * *', { name: 'notification-sweep' })
  async sweep() {
    const result = await this.notifications.deliverDue();
    if (result.attempted + result.summaries > 0) {
      this.logger.log(
        `Notification sweep: ${result.attempted} attempted, ${result.delivered} delivered, ${result.summaries} summaries.`,
      );
    }
    return result;
  }

  /** Phones Apple or Google say are gone, from Expo's receipts (§287). */
  @Cron('0 */15 * * * *', { name: 'push-receipts' })
  async receipts() {
    const gone = await this.notifications.checkPushReceipts();
    if (gone > 0) this.logger.log(`Push receipts: ${gone} phone(s) no longer take pushes.`);
    return gone;
  }
}
