import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { ExecuteAdjustmentDto } from './dto/execute-adjustment.dto';

/**
 * Reconciliation, and turning a recorded decision into money.
 *
 * Two-layer, per §27.1: `@Roles(ADMIN)` says who reaches the routes, and the
 * role is asserted again here before anything is written — a decorator on a
 * class is one refactor away from not being there.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * What the platform should currently be holding, by currency.
   *
   * The figure to compare against the provider's actual balance. Nothing
   * compares it automatically; producing the number is the point.
   */
  @Get('ledger/held')
  held(@CurrentUser() user: AuthenticatedUser) {
    this.assertAdmin(user);
    return this.ledger.heldTotals();
  }

  /**
   * Executes a BillingAdjustment — §25.2 renamed `appliedInvoiceId` to
   * `settledAt` + `settlementRef` for exactly this call.
   */
  @Patch('billing-adjustments/:id/execute')
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteAdjustmentDto,
  ) {
    this.assertAdmin(user);
    return this.prisma.$transaction((tx) =>
      this.ledger.executeAdjustment(tx, id, dto.settlementRef ?? null),
    );
  }

  private assertAdmin(user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }
}
