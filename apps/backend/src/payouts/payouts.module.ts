import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsScheduler } from './payouts.scheduler';
import { PayoutDestinationsService } from './payout-destinations.service';
import {
  AdminPayoutsController,
  BusinessPayoutsController,
} from './payouts.controller';
import {
  AdminPayoutDestinationsController,
  BusinessPayoutDestinationController,
} from './payout-destinations.controller';

@Module({
  controllers: [
    AdminPayoutsController,
    BusinessPayoutsController,
    AdminPayoutDestinationsController,
    BusinessPayoutDestinationController,
  ],
  providers: [PayoutsService, PayoutsScheduler, PayoutDestinationsService],
  exports: [PayoutsService, PayoutDestinationsService],
})
export class PayoutsModule {}
