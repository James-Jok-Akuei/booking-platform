import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RecentAuth } from '../common/decorators/recent-auth.decorator';
import { RecoveryCodesDto, TwoStepEnabledDto, TwoStepSetupDto, TwoStepStatusDto } from './dto/auth-response.dto';
import { StepUpCodeDto } from './dto/step-up.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TwoStepService } from './two-step.service';

/**
 * An administrator's two-step sign-in (§298). Not behind RolesGuard: until it
 * is set up, that guard turns administrators away from everything else — so
 * the role is checked in the service instead, from the database.
 */
@Controller('auth/two-step')
@UseGuards(JwtAuthGuard)
@ApiErrors({ auth: true, validation: true })
export class TwoStepController {
  constructor(private readonly twoStep: TwoStepService) {}

  @Get()
  @ApiOkResponse({ type: TwoStepStatusDto })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.twoStep.status(user);
  }

  /** A new secret for the app — the start of setting it up, or of moving it to a new phone. */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RecentAuth()
  @ApiOkResponse({ type: TwoStepSetupDto })
  start(@CurrentUser() user: AuthenticatedUser) {
    return this.twoStep.start(user);
  }

  /** The app's first code: turns it on. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TwoStepEnabledDto })
  confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: StepUpCodeDto) {
    return this.twoStep.confirm(user, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @RecentAuth()
  @ApiOkResponse({ type: RecoveryCodesDto })
  recoveryCodes(@CurrentUser() user: AuthenticatedUser) {
    return this.twoStep.newRecoveryCodes(user);
  }
}
