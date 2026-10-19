import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnnouncementsService } from './announcements.service';

@Injectable()
export class AnnouncementsScheduler {
  private readonly logger = new Logger(AnnouncementsScheduler.name);

  constructor(private readonly announcements: AnnouncementsService) {}

  /** Scheduled announcements, on their minute; a send cut short, finished (§287). */
  @Cron('30 * * * * *', { name: 'announcements-due' })
  async sendDue() {
    const n = await this.announcements.sendDue();
    if (n > 0) this.logger.log(`Announcements: ${n} sent.`);
    return n;
  }
}
