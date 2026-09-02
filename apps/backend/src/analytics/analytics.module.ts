import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

// Reads only. This module never writes money data — the fee snapshots it sums
// are written once at booking (§16.3) and are historical thereafter.
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
