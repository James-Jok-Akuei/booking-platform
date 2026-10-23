import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { RequestLocale } from '../i18n/request-locale.decorator';
import type { Locale } from '../i18n/locales';
import { PublicTodayDto, TodayDto } from './dto/today.dto';
import { TodayService } from './today.service';

/** "Rwanda today" for a shop's For you (§310): what changes its day. Every member, each their own branches. */
@Controller('business/today')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true })
export class BusinessTodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  @ApiOkResponse({ type: TodayDto })
  get(@CurrentUser() user: AuthenticatedUser, @RequestLocale() locale: Locale) {
    return this.today.forShop(user.userId, locale);
  }
}

/** For the customer app (§310): mobile money's health, and whether a day is Umuganda or a holiday. Anyone. */
@Controller('today')
@ApiErrors({ validation: true })
export class PublicTodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  @ApiOkResponse({ type: PublicTodayDto })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD, Kigali; today when not given.' })
  get(@Query('date') date?: string) {
    return this.today.publicToday(date);
  }
}
