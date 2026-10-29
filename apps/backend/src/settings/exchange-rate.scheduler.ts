import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from './platform-settings.service';
import { MONEY_ADMINS } from '../users/money-access';

/** Hours between reminders while the rate stays stale. */
export const STALE_REMINDER_INTERVAL_HOURS = 24;

/**
 * Tells admins their manual exchange rate has gone off (§37.3).
 *
 * Loud, never fatal. Nothing here blocks a booking or a payment: a platform
 * that stops taking money because nobody updated a setting is worse than one
 * charging a slightly old rate. The sweep only ever sends a message.
 *
 * Hourly, but debounced to one notification a day per stale spell. A warning
 * that arrives every hour is one people filter, and then the real one arrives
 * into a folder nobody reads.
 */
@Injectable()
export class ExchangeRateScheduler {
  private readonly logger = new Logger(ExchangeRateScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'exchange-rate-staleness' })
  async checkStaleness(): Promise<{ stale: boolean; notified: number }> {
    const staleness = await this.settings.getExchangeRateStaleness();

    if (!staleness.stale) return { stale: false, notified: 0 };

    const lastNotified = await this.settings.getStaleNotifiedAt();
    const dueAgain =
      !lastNotified ||
      Date.now() - lastNotified.getTime() >=
        STALE_REMINDER_INTERVAL_HOURS * 3_600_000;

    if (!dueAgain) return { stale: true, notified: 0 };

    // Only those who can set the rate (§317).
    const admins = await this.prisma.user.findMany({
      where: MONEY_ADMINS,
      select: { id: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.EXCHANGE_RATE_STALE,
          context: {
            serviceName: 'Exchange rate',
            locationName: 'the platform',
            businessName: 'the platform',
            startTime: undefined as unknown as Date,
            reason:
              `Last set ${staleness.ageInHours} hours ago, past the ` +
              `${staleness.stalenessHours}-hour threshold.`,
          },
        }),
      ),
    );

    await this.settings.markStaleNotified();

    this.logger.warn(
      `Exchange rate is ${staleness.ageInHours}h old (threshold ` +
        `${staleness.stalenessHours}h). ${admins.length} admin(s) notified. ` +
        'Deposits are still being charged at it.',
    );

    return { stale: true, notified: admins.length };
  }
}
