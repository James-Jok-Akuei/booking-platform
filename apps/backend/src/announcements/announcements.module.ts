import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AdminAnnouncementsController, AnnouncementsController } from './announcements.controller';
import { AnnouncementsScheduler } from './announcements.scheduler';

/** Messages from the platform's team to many people (§287). Sending is NotificationsModule's (global). */
@Module({
  controllers: [AdminAnnouncementsController, AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementsScheduler],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
