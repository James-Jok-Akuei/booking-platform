import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { AdminStoriesController, BusinessStoriesController, StoriesController } from './stories.controller';
import { StoriesScheduler } from './stories.scheduler';
import { StoriesService } from './stories.service';

/** Shops' stories (§285). */
@Module({
  imports: [BusinessModule],
  controllers: [BusinessStoriesController, StoriesController, AdminStoriesController],
  providers: [StoriesService, StoriesScheduler],
  exports: [StoriesService],
})
export class StoriesModule {}
