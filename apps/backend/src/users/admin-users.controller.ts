import {
  Body,
  Controller,
  Delete,
  Get,
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
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly invitations: AdminInvitationsService,
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
