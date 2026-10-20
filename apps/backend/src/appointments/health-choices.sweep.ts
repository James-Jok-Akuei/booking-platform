import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** How long a booking's private answers are kept after the visit (§300.6). */
export const HEALTH_CHOICES_KEPT_DAYS = 30;

/**
 * Removes the private answers on a booking — allergies, a health matter —
 * 30 days after its visit (§300.6), cancelled or not. Long enough for the
 * shop to look back if something went wrong, and no longer: Rwanda's data
 * law asks that sensitive data is kept only as long as it is needed.
 *
 * The booking keeps `healthChoicesRemovedAt`, so a screen can say why they
 * are gone rather than show nothing. Everything else on the booking — the
 * other answers, the note, the money — stays as it was.
 */
@Injectable()
export class HealthChoicesSweep {
  private readonly logger = new Logger(HealthChoicesSweep.name);

  constructor(private readonly prisma: PrismaService) {}

  // Every hour, seven minutes past — away from the quarter-hour jobs.
  @Cron('0 7 * * * *', { name: 'health-choices-removal' })
  async removeOld(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - HEALTH_CHOICES_KEPT_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.appointment.updateMany({
      where: { healthChoicesSealed: { not: null }, endTime: { lt: cutoff } },
      data: { healthChoicesSealed: null, healthChoicesRemovedAt: now },
    });
    if (count > 0) {
      this.logger.log(
        `Removed the private answers on ${count} booking(s), ${HEALTH_CHOICES_KEPT_DAYS} days after the visit.`,
      );
    }
    return count;
  }
}
