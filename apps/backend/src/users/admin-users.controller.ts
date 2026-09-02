import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
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
  constructor(private readonly users: UsersService) {}

  @Patch(':id/display-name/clear')
  clearDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClearDisplayNameDto,
  ) {
    return this.users.clearDisplayName(user, id, dto);
  }
}
