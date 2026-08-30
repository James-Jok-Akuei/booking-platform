import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

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
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: to, [timestampField]: now },
      });
      this.logger.log(
        `Auto-transition: appointment ${appointment.id} (location ${appointment.locationId}) ` +
          `${from} -> ${to}; ended ${appointment.endTime.toISOString()}, ` +
          `more than ${AUTO_TRANSITION_GRACE_HOURS}h ago.`,
      );
    }

    return due.length;
  }
}
