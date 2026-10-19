import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { ClearDisplayNameDto } from './dto/clear-display-name.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { AdminInvitationsService } from './admin-invitations.service';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { RecentAuth } from '../common/decorators/recent-auth.decorator';
import { TwoStepService } from '../auth/two-step.service';
import {
  AdminInvitationDto,
  AdminUserPageDto,
  ClearedDisplayNameDto,
} from './dto/user-response.dto';

/**
 * User moderation. API-only, like every other admin surface here (§16.9).
 *
 * Only the byline is clearable. There is no admin edit — replacing a
 * customer's name with wording an administrator preferred would publish words
 * under that customer's byline that they never wrote.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly invitations: AdminInvitationsService,
    private readonly twoStep: TwoStepService,
  ) {}

  /**
   * The directory (§94). Without it, the PATCH below took an id that nothing
   * in the platform produced.
   */
  @Get()
  @ApiOkResponse({ type: AdminUserPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListUsersDto) {
    return this.users.list(user, query);
  }

  // ---------- Administrators inviting administrators (§99) ----------
  //
  // Declared before the ':id' routes: Nest matches in order, and
  // 'invitations' would otherwise be read as a user id and fail the UUID pipe.

  @Post('invite')
  @ApiCreatedResponse({ type: AdminInvitationDto })
  invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteAdminDto) {
    return this.invitations.invite(user, dto);
  }

  @Get('invitations')
  @ApiOkResponse({ type: AdminInvitationDto, isArray: true })
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listInvitations(user);
  }

  @Delete('invitations/:invitationId')
  @ApiOkResponse({ type: ActionMessageDto })
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revokeInvitation(user, invitationId);
  }

  /** An administrator lost their phone and recovery codes: the primary administrator turns two-step off for them (§298). */
  @Post(':id/two-step/reset')
  @HttpCode(200)
  @RecentAuth()
  @ApiOkResponse({ type: ActionMessageDto })
  resetTwoStep(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.twoStep.reset(user, id);
  }

  @Delete(':id/admin-access')
  @ApiOkResponse({ type: ActionMessageDto })
  revokeAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.revokeAdmin(user, id);
  }

  @Patch(':id/display-name/clear')
  @ApiOkResponse({ type: ClearedDisplayNameDto })
  clearDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClearDisplayNameDto,
  ) {
    return this.users.clearDisplayName(user, id, dto);
  }
}
