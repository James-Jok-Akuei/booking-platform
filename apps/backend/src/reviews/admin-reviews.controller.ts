import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { HideReviewDto } from './dto/hide-review.dto';

/**
 * Review moderation. API-only, like every other admin surface here (§16.9).
 *
 * Hiding is a soft-hide: the row survives, because a hidden review is usually
 * the evidence in the ticket that got it hidden.
 */
@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id/hide')
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.reviews.hide(user, id, dto);
  }

  @Patch(':id/unhide')
  unhide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.unhide(user, id);
  }
}
