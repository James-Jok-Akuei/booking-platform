import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import {
  ReviewsBusinessController,
  ReviewsCustomerController,
  ReviewsPublicController,
} from './reviews.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { BusinessModule } from '../business/business.module';

// BusinessModule for BusinessRolesGuard; NotificationsService is @Global().
@Module({
  imports: [BusinessModule],
  controllers: [
    ReviewsCustomerController,
    ReviewsBusinessController,
    ReviewsPublicController,
    AdminReviewsController,
  ],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
