import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformFeeDto } from './dto/update-platform-fee.dto';
import { UpdateExchangeRateDto } from './dto/update-exchange-rate.dto';
import { UpdateStalenessDto } from './dto/update-staleness.dto';
import { UpdatePayoutHoldDto } from './dto/update-payout-hold.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  ExchangeRateSettingsDto,
  PayoutHoldDto,
  PlatformFeeDto,
} from './dto/settings-response.dto';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Admin-only platform configuration.
 *
 * Guarded by JwtAuthGuard + @Roles(ADMIN). Per DECISIONS.md §3, ADMIN accounts
 * are never self-service — the auth DTOs accept only BUSINESS or CUSTOMER — so
 * reaching this today requires a manually seeded admin user.
 *
 * NOTE: there is no admin portal yet. These endpoints exist so the platform fee
 * is a live database value rather than a constant baked into a deploy; the UI
 * that drives them is a future module. They are protected correctly now so that
 * building that UI is the only remaining work.
 */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get('platform-fee')
  @ApiOkResponse({ type: PlatformFeeDto })
  getPlatformFee(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getSettings(user);
  }

  /**
   * The manual USD -> provider-currency rate, and how stale it is.
   *
   * Manual by deliberate MVP scope: there is no live FX feed, and pretending
   * otherwise would be worse than an admin knowing they own this number.
   */
  @Get('exchange-rate')
  @ApiOkResponse({ type: ExchangeRateSettingsDto })
  getExchangeRate(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getExchangeRateSettings(user);
  }

  /**
   * Sets the rate used to convert deposits at charge time.
   *
   * Applies to FUTURE charges only. An appointment already paid keeps the
   * amount and rate it was actually charged at — see the snapshot fields on
   * Appointment.
   */
  @Patch('exchange-rate')
  @ApiOkResponse({ type: ExchangeRateSettingsDto })
  updateExchangeRate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateExchangeRateDto,
  ) {
    return this.settings.setExchangeRate(
      dto.exchangeRateUsdToProviderCurrency,
      dto.providerCurrency,
      // The actor both authorises the change and is recorded as its author, so
      // a rate that looks wrong is a question with an answer.
      user,
    );
  }

  /**
   * How old the rate may get before it is reported stale.
   *
   * Reporting only. Nothing here can block a booking or a payment (§37.3).
   */
  @Patch('exchange-rate/staleness')
  @ApiOkResponse({ type: ExchangeRateSettingsDto })
  updateStaleness(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStalenessDto,
  ) {
    return this.settings.setExchangeRateStalenessHours(
      dto.exchangeRateStalenessHours,
      user,
    );
  }

  /**
   * How long after an appointment resolves before its money may be paid out.
   *
   * The hold in force AT RESOLUTION TIME is the one that applies. Changing this
   * affects appointments resolved afterwards; it never rewrites a date already
   * set on an entry (§38.1).
   */
  @Get('payout-hold')
  @ApiOkResponse({ type: PayoutHoldDto })
  getPayoutHold(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getPayoutHoldSettings(user);
  }

  @Patch('payout-hold')
  @ApiOkResponse({ type: PayoutHoldDto })
  updatePayoutHold(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePayoutHoldDto,
  ) {
    return this.settings.setPayoutHoldDays(dto.payoutHoldDays, user);
  }

  /**
   * Changes the fee for FUTURE bookings only. Appointments already booked keep
   * the amounts computed at their booking time — see DECISIONS.md.
   */
  @Patch('platform-fee')
  @ApiOkResponse({ type: PlatformFeeDto })
  updatePlatformFee(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePlatformFeeDto,
  ) {
    return this.settings.setPlatformFeePercentage(dto.platformFeePercentage, user);
  }
}
