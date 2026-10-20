import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ApiOkResponse } from '@nestjs/swagger';
import { BusinessModerationService } from './business-moderation.service';
import {
  AdminBusinessDetailDto,
  AdminBusinessDto,
  AdminBusinessPageDto,
} from './dto/admin-business-response.dto';
import { ApproveBusinessDto } from './dto/approve-business.dto';
import { ChangeBusinessStatusDto } from './dto/change-business-status.dto';
import { ListBusinessesDto } from './dto/list-businesses.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * The approval queue. API-only, like every other admin surface here (§16.9).
 *
 * Two-layer throughout: `@Roles(ADMIN)` says who reaches the routes, and
 * `BusinessModerationService` asserts the role again before anything moves
 * (§41).
 */
@Controller('admin/businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminBusinessController {
  constructor(private readonly moderation: BusinessModerationService) {}

  @Get()
  @ApiOkResponse({ type: AdminBusinessPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBusinessesDto) {
    return this.moderation.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminBusinessDetailDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.findOne(user, id);
  }

  /** With advice for the shop, if the reviewer sends some (§303). */
  @Patch(':id/approve')
  @ApiOkResponse({ type: AdminBusinessDto })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveBusinessDto,
  ) {
    return this.moderation.approve(user, id, { keys: dto.advice, note: dto.note });
  }

  @Patch(':id/reject')
  @ApiOkResponse({ type: AdminBusinessDto })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBusinessStatusDto,
  ) {
    return this.moderation.reject(user, id, dto.reason);
  }

  @Patch(':id/suspend')
  @ApiOkResponse({ type: AdminBusinessDto })
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBusinessStatusDto,
  ) {
    return this.moderation.suspend(user, id, dto.reason);
  }

  @Patch(':id/reinstate')
  @ApiOkResponse({ type: AdminBusinessDto })
  reinstate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.reinstate(user, id);
  }
}
