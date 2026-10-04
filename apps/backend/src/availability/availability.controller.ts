import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { SLOT_GRID_MINUTES, parseCalendarDate } from './time.util';
import { ApiOkResponse } from '@nestjs/swagger';
import { AvailabilityDto } from './dto/availability-response.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * Availability lookup — reachable without a token, but not the same for
 * everyone.
 *
 * A customer compares open times across businesses long before signing in, so
 * requiring auth would put a login wall in front of browsing. But the answer
 * depends on who is asking:
 *
 * - **Anonymous, or any caller who is not the owner** (customers and rival
 *   businesses alike) only sees locations whose business is APPROVED. Anything
 *   else 404s, so the public cannot distinguish an unapproved location from one
 *   that does not exist.
 * - **The owning business** sees its own location at any status, because a
 *   PENDING business has to preview that its hours produce sensible slots
 *   before an admin ever reviews it.
 *
 * OptionalJwtAuthGuard is what makes both true at once: it attaches the user
 * when a valid token is present and lets the request through anonymously when
 * it is not. The status decision itself lives in AvailabilityService, next to
 * the query that loads the owning business.
 *
 * Nothing here exposes customer or appointment detail — a booked slot is simply
 * absent, indistinguishable from one outside opening hours.
 */
@Controller('locations')
@UseGuards(OptionalJwtAuthGuard)
@ApiErrors({ validation: true, notFound: true })
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get(':id/availability')
  @ApiOkResponse({ type: AvailabilityDto })
  async getAvailability(
    @Param('id', ParseUUIDPipe) locationId: string,
    @Query() query: AvailabilityQueryDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // The DTO proves the shape is YYYY-MM-DD; this proves the day exists, so
    // 2026-02-30 is rejected rather than silently rolling into March.
    const date = parseCalendarDate(query.date);
    if (!date) {
      throw new BadRequestException(`"${query.date}" is not a valid calendar date.`);
    }

    return this.availability.getAvailability(
      locationId,
      date,
      query.durationMinutes ?? SLOT_GRID_MINUTES,
      // undefined for an anonymous caller — the service then applies the
      // APPROVED-only rule.
      user?.userId,
    );
  }
}
