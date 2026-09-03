import {
  Body,
  Controller,
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
import { PayoutDestinationsService } from './payout-destinations.service';
import { CreatePayoutDestinationDto } from './dto/create-payout-destination.dto';
import {
  RejectPayoutDestinationDto,
  VerifyPayoutDestinationDto,
} from './dto/verify-payout-destination.dto';
import { ListPayoutDestinationsDto } from './dto/list-payout-destinations.dto';

/**
 * The business's own payout number.
 *
 * BusinessRolesGuard is deliberately NOT used: it enforces a role for a whole
 * handler, and the two routes here need different rules on the same resource —
 * OWNER to write, any ACTIVE member to read, with the READ redacting the number
 * for anyone but the owner. That is a projection decision, not a gate, so it
 * lives in the service where the data is (§48.4).
 */
@Controller('business/payout-destination')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BUSINESS)
export class BusinessPayoutDestinationController {
  constructor(private readonly destinations: PayoutDestinationsService) {}

  @Post()
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutDestinationDto,
  ) {
    return this.destinations.submit(user.userId, dto);
  }

  @Get()
  find(@CurrentUser() user: AuthenticatedUser) {
    return this.destinations.findForBusiness(user.userId);
  }
}

/**
 * The verification queue. API-only, like every other admin surface (§16.9), and
 * two-layer per §41: the guard says who reaches it, the service says it again.
 */
@Controller('admin/payout-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPayoutDestinationsController {
  constructor(private readonly destinations: PayoutDestinationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPayoutDestinationsDto,
  ) {
    return this.destinations.list(user, query);
  }

  @Patch(':id/verify')
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyPayoutDestinationDto,
  ) {
    return this.destinations.verify(user, id, dto);
  }

  @Patch(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayoutDestinationDto,
  ) {
    return this.destinations.reject(user, id, dto);
  }
}
