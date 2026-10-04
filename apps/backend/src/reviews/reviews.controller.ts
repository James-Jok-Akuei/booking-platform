import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { BusinessRolesGuard } from '../business/guards/business-roles.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { LocationReviewsDto, ReviewDto } from './dto/review-read.dto';

/**
 * Writing and editing a review. CUSTOMER only — a business cannot review
 * itself, and an admin moderating is a separate controller.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class ReviewsCustomerController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('appointments/:id/reviews')
  @ApiCreatedResponse({ type: ReviewDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user.userId, appointmentId, dto);
  }

  /** Rating and comment only, within the 7-day window. There is no delete. */
  @Patch('reviews/:id')
  @ApiOkResponse({ type: ReviewDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user.userId, id, dto);
  }
}

/**
 * The business's single reply to a review.
 *
 * BusinessRolesGuard with no @BusinessRoles means any ACTIVE member may
 * respond — replying to a customer is day-to-day work, not configuration, so
 * it sits with the STAFF-permitted actions rather than the OWNER-only ones.
 */
@Controller('reviews')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
export class ReviewsBusinessController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/response')
  @ApiCreatedResponse({ type: ReviewDto })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewResponseDto,
  ) {
    return this.reviews.respond(user.userId, id, dto);
  }

  @Patch(':id/response')
  @ApiOkResponse({ type: ReviewDto })
  updateResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewResponseDto,
  ) {
    return this.reviews.updateResponse(user.userId, id, dto);
  }
}

/**
 * The public listing.
 *
 * Mirrors the auth posture of the only other public `/locations` route,
 * `GET /locations/:id/availability`: OptionalJwtAuthGuard, so it is reachable
 * without a token, while a non-APPROVED business stays invisible to anyone but
 * its own members (§13.2). No new posture was invented.
 */
@Controller('locations')
@UseGuards(OptionalJwtAuthGuard)
export class ReviewsPublicController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  @ApiOkResponse({ type: LocationReviewsDto })
  list(
    @Param('id', ParseUUIDPipe) locationId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: ListReviewsDto,
  ) {
    return this.reviews.listForLocation(locationId, user, query);
  }
}
