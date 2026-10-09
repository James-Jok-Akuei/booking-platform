import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminOverviewService } from './admin-overview.service';
import { AdminOverviewDto } from './dto/admin-overview.dto';

/**
 * The admin console's home page, in one request (§243). Reads only.
 *
 * Guarded twice, as every admin surface is: `@Roles(ADMIN)` here, and the
 * service asserts the role again (§27.1).
 */
@Controller('admin/overview')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true })
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @Get()
  @ApiOkResponse({ type: AdminOverviewDto })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.overview(user);
  }
}
