import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';

// Reads only. This module never writes money data — the fee snapshots it sums
// are written once at booking (§16.3) and are historical thereafter. The admin
// console's overview (§243) lives here for the same reason.
@Module({
  controllers: [AnalyticsController, AdminOverviewController],
  providers: [AnalyticsService, AdminOverviewService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
