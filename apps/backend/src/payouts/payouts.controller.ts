import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { PayoutsService } from './payouts.service';
import { ListPayoutsDto } from './dto/list-payouts.dto';
import { MarkFailedDto, MarkPaidDto } from './dto/mark-payout.dto';

/**
 * Running payouts and recording their outcome. API-only, like every other admin
 * surface here (§16.9).
 *
 * There is no provider transfer to call: the MoMo integration is collections
 * only (§34.1). A run creates PENDING payouts, a human sends the money, and
 * these endpoints record what happened.
 */
@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.payouts.runAsAdmin(user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPayoutsDto) {
    return this.payouts.list(user, query);
  }

  @Patch(':id/mark-paid')
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.payouts.markPaid(user, id, dto);
  }

  @Patch(':id/mark-failed')
  markFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkFailedDto,
  ) {
    return this.payouts.markFailed(user, id, dto);
  }
}

/**
 * What a business is owed, and what it has been paid.
 *
 * Same posture as the analytics controller: `@Roles(BUSINESS, ADMIN)` says who
 * may reach the route, and the service says WHICH business they may read.
 * BusinessRolesGuard is not used, because it requires an active membership and
 * an admin has none.
 */
@Controller('businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BUSINESS, UserRole.ADMIN)
export class BusinessPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get(':id/balance')
  balance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) businessId: string,
  ) {
    return this.payouts.balance(user, businessId);
  }

  @Get(':id/payouts')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) businessId: string,
    @Query() query: ListPayoutsDto,
  ) {
    return this.payouts.listForBusiness(user, businessId, query);
  }
}
