import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminStatisticsController } from './admin-statistics.controller';
import { AdminStatisticsService } from './admin-statistics.service';

// Reads only. This module never writes money data — the fee snapshots it sums
// are written once at booking (§16.3) and are historical thereafter. The admin
// console's overview (§243) and statistics (§316) live here for the same
// reason; the statistics' one write is the test mark, which moves no money.
@Module({
  controllers: [AnalyticsController, AdminOverviewController, AdminStatisticsController],
  providers: [AnalyticsService, AdminOverviewService, AdminStatisticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
