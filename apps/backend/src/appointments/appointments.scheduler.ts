import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { askHowItWent } from './how-it-went';

/** How long after an appointment ends before it is resolved automatically. */
export const AUTO_TRANSITION_GRACE_HOURS = 24;

/**
 * Resolves appointments the business never closed out.
 *
 * Businesses forget to press buttons. Without this, an appointment verified on
 * Monday sits IN_PROGRESS forever, and one the customer silently skipped sits
 * BOOKED forever — both of which would corrupt any earnings report built on
 * status, and leave the Payments module unable to tell what it owes.
 *
 * The 24-hour grace period after endTime is what makes each transition safe to
 * infer: a full day past the end of the appointment, a verified one plainly did
 * happen, and an unverified one plainly did not.
 *
 * Both transitions preserve the manual meaning exactly — IN_PROGRESS becomes
 * COMPLETED, BOOKED becomes NO_SHOW. Notably it never invents a COMPLETED out
 * of a BOOKED, so the "no completion without verification" rule holds for the
 * automated path too.
 */
@Injectable()
export class AppointmentsScheduler {
  private readonly logger = new Logger(AppointmentsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    // Optional so suites about the money alone need not stand up the inbox.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // Every 15 minutes. Written as a raw expression because @nestjs/schedule's
  // CronExpression enum has no 15-minute constant.
  @Cron('0 */15 * * * *', { name: 'appointment-auto-transition' })
  async runAutoTransitions(): Promise<{ completed: number; noShow: number }> {
    const cutoff = new Date(Date.now() - AUTO_TRANSITION_GRACE_HOURS * 60 * 60 * 1000);

    const completed = await this.transition(
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
      cutoff,
      'completedAt',
    );
    const noShow = await this.transition(
      AppointmentStatus.BOOKED,
      AppointmentStatus.NO_SHOW,
      cutoff,
      'noShowAt',
    );

    if (completed + noShow > 0) {
      this.logger.log(
        `Auto-transition sweep finished: ${completed} -> COMPLETED, ${noShow} -> NO_SHOW.`,
      );
    }

    return { completed, noShow };
  }

  private async transition(
    from: AppointmentStatus,
    to: AppointmentStatus,
    cutoff: Date,
    timestampField: 'completedAt' | 'noShowAt',
  ): Promise<number> {
    // Selected first, then updated by id, purely so each transition can be
    // logged individually — "12 rows updated" is not enough to debug a
    // disputed appointment months later.
    const due = await this.prisma.appointment.findMany({
      where: { status: from, endTime: { lt: cutoff } },
      select: { id: true, endTime: true, locationId: true },
    });

    if (due.length === 0) return 0;

    const now = new Date();
    for (const appointment of due) {
      // Per appointment, and transactional: the status change and the ledger
      // release it triggers commit together. An appointment auto-resolved
      // without its money becoming payable would leave a business unpaid with
      // nothing in the record to explain why.
      await this.prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: to, [timestampField]: now },
        });
        await this.ledger.releaseOnResolution(tx, appointment.id);
      });
      // A visit done is a visit to ask about (§287).
      if (to === AppointmentStatus.COMPLETED) {
        await askHowItWent(this.prisma, this.notifications, appointment.id);
      }
      // A missed booking is said to the customer, as the shop's own marking is (§313):
      // a deposit kept is never a silent charge they discover later.
      if (to === AppointmentStatus.NO_SHOW) await this.tellMissed(appointment.id);
      this.logger.log(
        `Auto-transition: appointment ${appointment.id} (location ${appointment.locationId}) ` +
          `${from} -> ${to}; ended ${appointment.endTime.toISOString()}, ` +
          `more than ${AUTO_TRANSITION_GRACE_HOURS}h ago.`,
      );
    }

    return due.length;
  }

  private async tellMissed(appointmentId: string) {
    if (!this.notifications) return;
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        customerId: true,
        startTime: true,
        depositAmountMinor: true,
        currency: true,
        service: { select: { name: true } },
        location: { select: { name: true, business: { select: { name: true } } } },
      },
    });
    if (!a) return;
    await this.notifications.notify({
      recipientId: a.customerId,
      type: NotificationType.APPOINTMENT_NO_SHOW,
      appointmentId,
      context: {
        serviceName: a.service.name,
        locationName: a.location.name,
        businessName: a.location.business.name ?? 'the business',
        startTime: a.startTime,
        depositAmountMinor: a.depositAmountMinor,
        currency: a.currency,
        automatic: true,
      },
    });
  }
}
