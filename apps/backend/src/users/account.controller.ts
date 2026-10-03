import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AccountService } from './account.service';

/**
 * What a person may do to their OWN account (§119).
 *
 * Every route here acts on the caller and takes no id, so there is nothing to
 * tamper with and no authorisation question beyond being signed in. That is why
 * these are not on the admin controller beside the moderation actions, which
 * take an id and are a different kind of power entirely.
 */
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** Everything the platform holds about the caller, as JSON (§119.2). */
  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser) {
    return this.account.exportFor(user.userId);
  }

  /**
   * Closes the caller's own account (§119.1).
   *
   * POST rather than DELETE, and the name says why: nothing is deleted. The row
   * stays so that bookings, reviews and the ledger entries that depend on them
   * survive; the identity on it does not.
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentUser() user: AuthenticatedUser) {
    return this.account.close(user.userId);
  }
}
