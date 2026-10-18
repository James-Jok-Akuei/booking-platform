import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StoriesService } from './stories.service';

/** Clears ended stories, and their pictures, a few days after they end (§285). */
@Injectable()
export class StoriesScheduler {
  private readonly logger = new Logger(StoriesScheduler.name);

  constructor(private readonly stories: StoriesService) {}

  @Cron('0 30 3 * * *', { name: 'stories-clear-old' })
  async clearOld() {
    try {
      const cleared = await this.stories.clearOld();
      if (cleared > 0) this.logger.log(`Cleared ${cleared} ended stories and their pictures.`);
    } catch (error) {
      this.logger.error('Clearing ended stories failed', error as Error);
    }
  }
}
