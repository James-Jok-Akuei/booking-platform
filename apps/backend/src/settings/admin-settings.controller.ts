import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformFeeDto } from './dto/update-platform-fee.dto';
import { UpdateExchangeRateDto } from './dto/update-exchange-rate.dto';
import { UpdateStalenessDto } from './dto/update-staleness.dto';
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
  getPlatformFee() {
    return this.settings.getSettings();
  }

  /**
   * The manual USD -> provider-currency rate, and how stale it is.
   *
   * Manual by deliberate MVP scope: there is no live FX feed, and pretending
   * otherwise would be worse than an admin knowing they own this number.
   */
  @Get('exchange-rate')
  getExchangeRate() {
    return this.settings.getExchangeRateSettings();
  }

  /**
   * Sets the rate used to convert deposits at charge time.
   *
   * Applies to FUTURE charges only. An appointment already paid keeps the
   * amount and rate it was actually charged at — see the snapshot fields on
   * Appointment.
   */
  @Patch('exchange-rate')
  updateExchangeRate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateExchangeRateDto,
  ) {
    return this.settings.setExchangeRate(
      dto.exchangeRateUsdToProviderCurrency,
      dto.providerCurrency,
      // Recorded so a rate that looks wrong is a question with an answer.
      user.userId,
    );
  }

  /**
   * How old the rate may get before it is reported stale.
   *
   * Reporting only. Nothing here can block a booking or a payment (§37.3).
   */
  @Patch('exchange-rate/staleness')
  updateStaleness(@Body() dto: UpdateStalenessDto) {
    return this.settings.setExchangeRateStalenessHours(dto.exchangeRateStalenessHours);
  }

  /**
   * Changes the fee for FUTURE bookings only. Appointments already booked keep
   * the amounts computed at their booking time — see DECISIONS.md.
   */
  @Patch('platform-fee')
  updatePlatformFee(@Body() dto: UpdatePlatformFeeDto) {
    return this.settings.setPlatformFeePercentage(dto.platformFeePercentage);
  }
}
