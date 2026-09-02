import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';
import { TicketsScheduler } from './tickets.scheduler';

// StorageService and NotificationsService come from @Global() modules — the
// point is that tickets reuse them rather than standing up their own upload or
// delivery path.
@Module({
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService, TicketsScheduler],
  exports: [TicketsService],
})
export class TicketsModule {}
