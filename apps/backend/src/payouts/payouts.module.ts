import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsScheduler } from './payouts.scheduler';
import {
  AdminPayoutsController,
  BusinessPayoutsController,
} from './payouts.controller';

@Module({
  controllers: [AdminPayoutsController, BusinessPayoutsController],
  providers: [PayoutsService, PayoutsScheduler],
  exports: [PayoutsService],
})
export class PayoutsModule {}
