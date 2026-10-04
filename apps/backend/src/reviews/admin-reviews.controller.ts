import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
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
import { ListAdminReviewsDto } from './dto/list-admin-reviews.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { AdminReviewPageDto, ReviewDto } from './dto/review-read.dto';

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

  /**
   * The moderation queue (§93) — the only listing that returns hidden reviews.
   *
   * Without it `hide` and `unhide` were unreachable in practice: nothing told
   * an admin which reviews existed, and a hidden one was invisible everywhere.
   */
  @Get()
  @ApiOkResponse({ type: AdminReviewPageDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminReviewsDto,
  ) {
    return this.reviews.listForModeration(user, query);
  }

  @Patch(':id/hide')
  @ApiOkResponse({ type: ReviewDto })
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.reviews.hide(user, id, dto);
  }

  @Patch(':id/unhide')
  @ApiOkResponse({ type: ReviewDto })
  unhide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.unhide(user, id);
  }
}
