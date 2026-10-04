import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { BusinessAnalyticsDto } from './dto/analytics-response.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * Business performance reporting.
 *
 * Guarded twice, as everywhere here. `@Roles(BUSINESS, ADMIN)` establishes who
 * may reach the route; `AnalyticsService.assertMayRead` establishes *which*
 * business they may read — an admin any, a business user only their own.
 *
 * BusinessRolesGuard is deliberately not used: it requires an active
 * membership, which an admin does not have, and admins must be able to read
 * any business's figures.
 */
@Controller('businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BUSINESS, UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id/analytics')
  @ApiOkResponse({ type: BusinessAnalyticsDto })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) businessId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.getAnalytics(user, businessId, query);
  }
}
