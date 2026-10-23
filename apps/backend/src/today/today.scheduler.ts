import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Searches are kept 90 days (§310): enough for "this week", nothing more. */
export const SEARCH_KEEP_DAYS = 90;

@Injectable()
export class TodayScheduler {
  private readonly logger = new Logger(TodayScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'search-queries-retention', timeZone: 'Africa/Kigali' })
  async forgetOldSearches(now = new Date()): Promise<number> {
    const { count } = await this.prisma.searchQuery.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - SEARCH_KEEP_DAYS * 86_400_000) } },
    });
    if (count) this.logger.log(`Forgot ${count} searches older than ${SEARCH_KEEP_DAYS} days.`);
    return count;
  }
}
