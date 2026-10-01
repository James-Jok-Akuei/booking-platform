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
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { ExecuteAdjustmentDto } from './dto/execute-adjustment.dto';
import {
  ListAdjustmentsDto,
  ListLedgerEntriesDto,
} from './dto/list-ledger.dto';

/**
 * Reconciliation, and turning a recorded decision into money.
 *
 * Two-layer, per §27.1: `@Roles(ADMIN)` says who reaches the routes, and
 * LedgerService asserts the role again before anything is read or written — a
 * decorator on a class is one refactor away from not being there.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /**
   * What the platform should currently be holding, by currency.
   *
   * The figure to compare against the provider's actual balance. Nothing
   * compares it automatically; producing the number is the point.
   */
  /** The entries behind a balance, a payout or an appointment. Read-only. */
  @Get('ledger/entries')
  entries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLedgerEntriesDto,
  ) {
    return this.ledger.listEntries(user, query);
  }

  /** Billing adjustments, unsettled first. Read-only. */
  @Get('billing-adjustments')
  adjustments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdjustmentsDto,
  ) {
    return this.ledger.listAdjustments(user, query);
  }

  /**
   * Our figure beside the operator's, and whether they can honestly be
   * compared at all (§87).
   */
  @Get('ledger/reconciliation')
  reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.compare(user);
  }

  @Get('ledger/held')
  held(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.heldTotals(user);
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
    return this.prisma.$transaction((tx) =>
      this.ledger.executeAdjustment(tx, id, dto.settlementRef ?? null, user),
    );
  }
}
