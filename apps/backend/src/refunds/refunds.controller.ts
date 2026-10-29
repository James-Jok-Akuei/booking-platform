import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { RefundsService } from './refunds.service';
import { ListRefundsDto, MarkRefundSentDto } from './dto/refund-request.dto';
import { AdminRefundPageDto, RefundOutcomeDto } from './dto/refund-response.dto';
import { MoneyAccess } from '../common/decorators/money-access.decorator';

/** Deposits going back to customers (§313): watched, tried again, or sent by hand. */
@Controller('admin/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
// Money access (§317): only the primary administrator and those they trust with money.
@MoneyAccess()
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @ApiOkResponse({ type: AdminRefundPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRefundsDto) {
    return this.refunds.list(user, query);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RefundOutcomeDto })
  retry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.retry(user, id);
  }

  @Post(':id/mark-sent')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RefundOutcomeDto })
  markSent(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkRefundSentDto) {
    return this.refunds.markSent(user, id, dto);
  }
}
