import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  OtpRequestedDto,
  SignedInDto,
  StepUpDto,
  TokenPairDto,
} from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { StepUpCodeDto } from './dto/step-up.dto';

@Controller('auth')
@ApiErrors({ validation: true, rateLimited: true })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Five a minute from one address, against the global 120 (§116.2).
   *
   * This endpoint sends an EMAIL to an address the caller picks. The existing
   * cooldown is per recipient, so it stops one person being spammed and does
   * nothing about one machine walking a list of thousands — which costs the
   * platform its sending reputation, not just its bandwidth.
   */
  @Post('otp/request')
  @ApiOkResponse({ type: OtpRequestedDto })
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.email, dto.role as UserRole | undefined);
  }

  /**
   * Ten a minute. A six-digit code is a million guesses; the service counts
   * attempts per code, and this caps how fast anyone can work through codes
   * for DIFFERENT addresses, which per-code counting cannot see.
   */
  @Post('otp/verify')
  @ApiOkResponse({ type: SignedInDto })
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.code);
  }

  @Post('refresh')
  @ApiOkResponse({ type: TokenPairDto })
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /** Emails a signed-in person a code to confirm a risky change (§279). */
  @Post('step-up/request')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: OtpRequestedDto })
  @HttpCode(HttpStatus.OK)
  requestStepUp(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.requestStepUp(user.userId);
  }

  /** The code, for a pass the app sends as `X-Step-Up` for the next few minutes. */
  @Post('step-up/verify')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: StepUpDto })
  @HttpCode(HttpStatus.OK)
  verifyStepUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: StepUpCodeDto) {
    return this.authService.verifyStepUp(user.userId, dto.code);
  }

  @Post('logout')
  @ApiOkResponse({ type: ActionMessageDto })
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
