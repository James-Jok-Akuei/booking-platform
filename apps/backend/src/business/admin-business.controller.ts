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
import { BusinessModerationService } from './business-moderation.service';
import { ChangeBusinessStatusDto } from './dto/change-business-status.dto';
import { ListBusinessesDto } from './dto/list-businesses.dto';

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
export class AdminBusinessController {
  constructor(private readonly moderation: BusinessModerationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBusinessesDto) {
    return this.moderation.list(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.findOne(user, id);
  }

  @Patch(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.approve(user, id);
  }

  @Patch(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBusinessStatusDto,
  ) {
    return this.moderation.reject(user, id, dto.reason);
  }

  @Patch(':id/suspend')
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBusinessStatusDto,
  ) {
    return this.moderation.suspend(user, id, dto.reason);
  }

  @Patch(':id/reinstate')
  reinstate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.reinstate(user, id);
  }
}
