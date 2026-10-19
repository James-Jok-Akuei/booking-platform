import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SupportHistoryDto, SupportHistoryQueryDto } from './support.dto';
import { SupportLogService } from './support-log.service';

/** What our support team did — about a booking, a shop, a person or a help request (§297). */
@Controller('admin/support-actions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true })
export class SupportController {
  constructor(private readonly log: SupportLogService) {}

  @Get()
  @ApiOkResponse({ type: SupportHistoryDto })
  history(@CurrentUser() user: AuthenticatedUser, @Query() query: SupportHistoryQueryDto) {
    return this.log.history(user, query);
  }
}
