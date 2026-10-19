import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RecentAuth } from '../common/decorators/recent-auth.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  SupportDoneDto,
  SupportPausedDto,
  SupportPersonDto,
  SupportReasonDto,
  SupportShopDto,
  SupportTransferOwnershipDto,
} from './support.dto';
import { SupportAccountsService } from './support-accounts.service';

/**
 * What support can do for a shop or a person (§297) — each the same change
 * they could make themselves, with a reason and a line in the log. Handing a
 * shop over and closing an account need a code typed in the last few minutes
 * (§279): one gives away the money and the keys, the other cannot be undone.
 */
@Controller('admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class SupportAccountsController {
  constructor(private readonly accounts: SupportAccountsService) {}

  @Get('businesses/:id')
  @ApiOkResponse({ type: SupportShopDto })
  shop(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.shop(user, id);
  }

  @Post('businesses/:id/pause')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportPausedDto })
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportReasonDto) {
    return this.accounts.setPaused(user, id, true, dto);
  }

  @Post('businesses/:id/resume')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportPausedDto })
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.setPaused(user, id, false, dto);
  }

  @Post('businesses/:id/invitations/:invitationId/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.revokeInvitation(user, id, invitationId, dto);
  }

  @Post('businesses/:id/invitations/:invitationId/resend')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.resendInvitation(user, id, invitationId, dto);
  }

  @Post('businesses/:id/members/:membershipId/remove')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.removeMember(user, id, membershipId, dto);
  }

  @Post('businesses/:id/transfer-ownership')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  @RecentAuth()
  transferOwnership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportTransferOwnershipDto,
  ) {
    return this.accounts.transferOwnership(user, id, dto.membershipId, dto);
  }

  @Get('people/:id')
  @ApiOkResponse({ type: SupportPersonDto })
  person(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.person(user, id);
  }

  @Post('people/:id/sign-out-everywhere')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  signOutEverywhere(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.signOutEverywhere(user, id, dto);
  }

  @Post('people/:id/stop-marketing')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  stopMarketing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.stopMarketing(user, id, dto);
  }

  @Post('people/:id/close')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  @RecentAuth()
  closeAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.accounts.closeAccount(user, id, dto);
  }
}
