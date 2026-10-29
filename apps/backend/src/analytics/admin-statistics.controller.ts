import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminStatisticsService } from './admin-statistics.service';
import {
  MarkTestDto,
  StatisticsLeftOutDto,
  StatisticsMonthsDto,
  StatisticsMonthsQueryDto,
  StatisticsPeriodDto,
  StatisticsPeriodQueryDto,
  StatisticsScopeQueryDto,
  StatisticsSummaryDto,
  TestMarkDto,
} from './dto/admin-statistics.dto';
import { MoneyAccess } from '../common/decorators/money-access.decorator';

/**
 * The console's statistics (§316): the whole platform added up. Reads only,
 * except for marking a shop or a customer as a test one, which changes what
 * the numbers count and nothing else.
 *
 * Guarded twice, as every admin surface is: `@Roles(ADMIN)` here, and the
 * service asserts the role again (§27.1).
 */
@Controller('admin/statistics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
// Money access (§317): only the primary administrator and those they trust with money.
@MoneyAccess()
export class AdminStatisticsController {
  constructor(private readonly statistics: AdminStatisticsService) {}

  /** All time: what the platform has made, and how big it is. */
  @Get('summary')
  @ApiOkResponse({ type: StatisticsSummaryDto })
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: StatisticsScopeQueryDto) {
    return this.statistics.summary(user, query);
  }

  /** A stretch of days, against the stretch of the same length before it. */
  @Get('period')
  @ApiOkResponse({ type: StatisticsPeriodDto })
  period(@CurrentUser() user: AuthenticatedUser, @Query() query: StatisticsPeriodQueryDto) {
    return this.statistics.period(user, query);
  }

  /** Month by month, and how many customers came back after their first booking. */
  @Get('months')
  @ApiOkResponse({ type: StatisticsMonthsDto })
  months(@CurrentUser() user: AuthenticatedUser, @Query() query: StatisticsMonthsQueryDto) {
    return this.statistics.months(user, query);
  }

  /** The test shops and test customers the numbers leave out (§316). */
  @Get('left-out')
  @ApiOkResponse({ type: StatisticsLeftOutDto })
  leftOut(@CurrentUser() user: AuthenticatedUser) {
    return this.statistics.leftOut(user);
  }

  @Patch('test-shops/:id')
  @ApiOkResponse({ type: TestMarkDto })
  markShop(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkTestDto) {
    return this.statistics.markShop(user, id, dto.isTest);
  }

  @Patch('test-customers/:id')
  @ApiOkResponse({ type: TestMarkDto })
  markCustomer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkTestDto) {
    return this.statistics.markCustomer(user, id, dto.isTest);
  }
}
