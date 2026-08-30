import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import { BusinessRolesGuard } from '../business/guards/business-roles.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ScheduleManagementService } from './schedule-management.service';
import { CreateScheduleExceptionDto } from './dto/create-schedule-exception.dto';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';

/**
 * Business-side schedule overrides. Same four-layer guarding as
 * BusinessController: JwtAuthGuard, then @Roles(BUSINESS), then
 * @BusinessRoles(...), then per-row ownership scoping inside the service.
 * OWNER and MANAGER may change the schedule; STAFF may only read it.
 */
@Controller('business/locations')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
export class ScheduleManagementController {
  constructor(private readonly schedule: ScheduleManagementService) {}

  // ---------- Schedule exceptions (whole-day overrides) ----------

  /** Creates or replaces the exception for the given date. */
  @Post(':id/schedule-exceptions')
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  createException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
    @Body() dto: CreateScheduleExceptionDto,
  ) {
    return this.schedule.createException(user.userId, locationId, dto);
  }

  @Get(':id/schedule-exceptions')
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listExceptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
  ) {
    return this.schedule.listExceptions(user.userId, locationId);
  }

  @Delete(':id/schedule-exceptions/:exceptionId')
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  deleteException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ) {
    return this.schedule.deleteException(user.userId, locationId, exceptionId);
  }

  // ---------- Time blocks (partial-day) ----------

  @Post(':id/time-blocks')
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  createTimeBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
    @Body() dto: CreateTimeBlockDto,
  ) {
    return this.schedule.createTimeBlock(user.userId, locationId, dto);
  }

  @Get(':id/time-blocks')
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listTimeBlocks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
  ) {
    return this.schedule.listTimeBlocks(user.userId, locationId);
  }

  @Delete(':id/time-blocks/:blockId')
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  deleteTimeBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) locationId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.schedule.deleteTimeBlock(user.userId, locationId, blockId);
  }
}
