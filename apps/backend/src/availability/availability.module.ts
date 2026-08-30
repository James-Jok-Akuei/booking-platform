import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { ScheduleManagementController } from './schedule-management.controller';
import { ScheduleManagementService } from './schedule-management.service';
import { BusinessModule } from '../business/business.module';

// BusinessModule is imported for BusinessAccessService — the ownership check is
// deliberately reused rather than reimplemented, so there is exactly one
// definition of "this location belongs to this caller" in the codebase.
@Module({
  imports: [BusinessModule],
  controllers: [AvailabilityController, ScheduleManagementController],
  providers: [AvailabilityService, ScheduleManagementService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
