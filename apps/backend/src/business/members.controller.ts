import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import {
  BusinessContext,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { BusinessRolesGuard } from './guards/business-roles.guard';
import { MembersService } from './members.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MemberBranchesDto } from './dto/member-branches.dto';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  BusinessInvitationDto,
  BusinessMemberDto,
  RemovedMemberDto,
} from './dto/members-response.dto';

/**
 * Managing who works in a business.
 *
 * Almost everything here is OWNER-only. A MANAGER runs the business day to day
 * but cannot change who has access to it — that is the line between the two
 * roles. The one exception is listing members, which any active member can do:
 * seeing your colleagues is not a privilege.
 */
@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Post('members/invite')
  @ApiCreatedResponse({ type: BusinessInvitationDto })
  @BusinessRoles(BusinessMemberRole.OWNER)
  invite(
    @CurrentBusiness() business: BusinessContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.members.invite(business.businessId, user.userId, dto);
  }

  @Get('members')
  @ApiOkResponse({ type: BusinessMemberDto, isArray: true })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listMembers(@CurrentBusiness() business: BusinessContext) {
    return this.members.listMembers(business.businessId, business.scope);
  }

  @Patch('members/:membershipId/role')
  @ApiOkResponse({ type: BusinessMemberDto })
  @BusinessRoles(BusinessMemberRole.OWNER)
  updateMemberRole(
    @CurrentBusiness() business: BusinessContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.members.updateMemberRole(business.businessId, membershipId, dto);
  }

  /** Which branches they look after: every one, or the ones chosen (§277). */
  @Patch('members/:membershipId/branches')
  @ApiOkResponse({ type: BusinessMemberDto })
  @BusinessRoles(BusinessMemberRole.OWNER)
  setMemberBranches(
    @CurrentBusiness() business: BusinessContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: MemberBranchesDto,
  ) {
    return this.members.setMemberBranches(business.businessId, membershipId, dto);
  }

  /** Soft delete — sets status REMOVED, never drops the row. */
  @Delete('members/:membershipId')
  @ApiOkResponse({ type: RemovedMemberDto })
  @BusinessRoles(BusinessMemberRole.OWNER)
  removeMember(
    @CurrentBusiness() business: BusinessContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.members.removeMember(business.businessId, membershipId, user.userId);
  }

  @Get('invitations')
  @ApiOkResponse({ type: BusinessInvitationDto, isArray: true })
  @BusinessRoles(BusinessMemberRole.OWNER)
  listInvitations(@CurrentBusiness() business: BusinessContext) {
    return this.members.listInvitations(business.businessId);
  }

  @Delete('invitations/:invitationId')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER)
  revokeInvitation(
    @CurrentBusiness() business: BusinessContext,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.members.revokeInvitation(business.businessId, invitationId);
  }
}
