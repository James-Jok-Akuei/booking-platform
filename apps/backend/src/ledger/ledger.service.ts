import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BillingAdjustmentType,
  CancelledBy,
  LedgerEntryType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADJUSTMENT_INCLUDE,
  ADMIN_LEDGER_INCLUDE,
  HeldTotalsDto,
} from './dto/ledger-response.dto';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { INTERNAL_CURRENCY, toMinorUnits } from '../payments/currency';
import { splitSettlement } from './settlement';

/** Admin-only ledger operations, asserted in the service as well as the guard (§41). */

/**
 * Adds a hold period, in days, to an anchor date.
 *
 * The hold itself is an admin setting (§38), read at resolution time. It is a
 * settling window in which a dispute can still arrive, not a processing delay:
 * paying out inside it would mean clawing money back from a business that has
 * already been given it.
 */
export const addHoldPeriod = (from: Date, holdDays: number) =>
  new Date(from.getTime() + holdDays * 24 * 60 * 60 * 1000);

/**
 * The append-only record of what the platform owes each business (§34).
 *
 * Every method here takes a transaction client rather than opening its own.
 * That is the point: a ledger entry only ever exists because something else
 * happened — a deposit confirmed, an appointment resolved — and if that
 * something is not durable then neither is the entry. Money writes and the
 * events that justify them commit together or not at all.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Records a confirmed deposit as two entries: the money in, and the
   * platform's cut back out.
   *
   * Two rows rather than one net row, because they are two different facts and
   * they reverse independently — a business cancellation gives the deposit back
   * to the customer AND hands the fee back, and those are separate events with
   * separate types (§25). A single netted row could not express that.
   *
   * They sum to `businessAmountMinor` by construction, since that is defined as
   * the deposit minus the fee (§16.3). Asserted by test.
   */
  async recordDepositReceived(
    tx: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<void> {
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        depositAmountMinor: true,
        platformFeeAmountMinor: true,
        currency: true,
        providerCurrency: true,
        providerAmountMinor: true,
        exchangeRateUsed: true,
        location: { select: { businessId: true } },
      },
    });

    const businessId = appointment.location.businessId;

    // The figure the provider ACTUALLY CHARGED, not a recomputation from a rate
    // (§45.2). Null when the appointment never went through the payment
    // initiation that records it; such entries carry no settlement figure and
    // payouts exclude them rather than convert at a guessed rate.
    const charged = appointment.providerAmountMinor;
    const settlement =
      charged === null
        ? null
        : splitSettlement({
            chargedMinor: charged,
            depositAmountMinor: appointment.depositAmountMinor,
            platformFeeAmountMinor: appointment.platformFeeAmountMinor,
          });

    const settlementFields = {
      settlementCurrency: settlement ? appointment.providerCurrency : null,
      bookingExchangeRate: settlement ? appointment.exchangeRateUsed : null,
    };

    await tx.ledgerEntry.createMany({
      data: [
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountMinor: appointment.depositAmountMinor,
          currency: appointment.currency,
          ...settlementFields,
          settlementAmountMinor: settlement?.depositMinor ?? null,
          // Null: the deposit has landed, but nothing is payable until the
          // appointment resolves one way or the other.
          availableAt: null,
        },
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.PLATFORM_FEE,
          amountMinor: -appointment.platformFeeAmountMinor,
          currency: appointment.currency,
          ...settlementFields,
          // Negative, matching amountMinor. The business's settlement share is
          // the remainder by construction, so the pair sums exactly.
          settlementAmountMinor:
            settlement === null ? null : -settlement.feeMinor,
          availableAt: null,
        },
      ],
    });

    this.logger.log(
      `Ledger: appointment ${appointmentId} deposit ${appointment.depositAmountMinor}c ` +
        `less fee ${appointment.platformFeeAmountMinor}c recorded for business ${businessId}.`,
    );
  }

  /**
   * Stamps an appointment's entries with the date they become payable.
   *
   * The rule differs by how the appointment ended, and the difference is not
   * arbitrary (§34.3):
   *
   * - COMPLETED  -> a week after completion. The service happened.
   * - NO_SHOW, or cancelled by the CUSTOMER on a paid deposit -> a week after
   *   the SCHEDULED END TIME. Neither ever reaches COMPLETED, so keying off
   *   `completedAt` would leave the business permanently unpaid for money it is
   *   entitled to keep.
   *
   * A business cancellation is deliberately not handled here: it produces a
   * refund, which is §36's job.
   *
   * Idempotent — it only touches entries that are still unstamped and unsettled,
   * so a repeated resolution changes nothing.
   */
  async releaseOnResolution(
    tx: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<number> {
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        status: true,
        completedAt: true,
        endTime: true,
        cancelledBy: true,
        depositPaidAt: true,
      },
    });

    // Read now, at resolution, and recorded below. Whatever an admin changes it
    // to afterwards applies to the NEXT appointment to resolve, not this one.
    const holdDays = await this.settings.getPayoutHoldDays();

    const availableAt = this.availableAtFor(appointment, holdDays);
    if (!availableAt) return 0;

    const { count } = await tx.ledgerEntry.updateMany({
      where: { appointmentId, availableAt: null, payoutId: null },
      data: { availableAt },
    });

    if (count > 0) {
      // On the appointment, not the entry: a payout date has to be explainable
      // afterwards, and nothing stores the setting's history (§38.2).
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { payoutHoldDaysApplied: holdDays },
      });

      this.logger.log(
        `Ledger: ${count} entr${count === 1 ? 'y' : 'ies'} for appointment ${appointmentId} ` +
          `become payable at ${availableAt.toISOString()} (${holdDays}-day hold).`,
      );
    }

    return count;
  }

  /**
   * Reverses an appointment a business called off, per §25.
   *
   * Three entries, all payable immediately — there is nothing to wait for. The
   * appointment is not happening, so the seven-day settling window has nothing
   * to settle.
   *
   *   DEPOSIT_REFUND        -deposit
   *   PLATFORM_FEE_REVERSAL +fee
   *   GATEWAY_FEE_DEBIT     -whatever the gateway charged
   *
   * The first two net to exactly `-businessAmountMinor`, cancelling the pair
   * appended when the deposit landed and returning the business to zero for
   * this appointment. That is what "the customer is refunded in full, including
   * the platform fee" means in ledger terms: the platform gives back its own
   * cut rather than making the business fund it.
   *
   * The gateway charge is then a separate, third fact — the only part of a
   * business cancellation the business actually bears.
   *
   * `gatewayChargeMinor` is supplied by the caller, in the SETTLEMENT currency,
   * and never derived. The MoMo
   * integration does not report what it charged on a transaction or a refund
   * (§36.2), so a percentage constant here would be a number the ledger
   * asserted and the provider's statement contradicted. A ledger that computes
   * a fee the provider charged differently is a ledger nobody can reconcile.
   */
  async recordBusinessCancellationRefund(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    gatewayChargeMinor: number,
  ): Promise<void> {
    return this.recordRefund(tx, appointmentId, gatewayChargeMinor);
  }

  /**
   * A customer who cancelled at least 24 hours before (§313): the whole
   * deposit back, the platform's fee with it, and nothing on the shop — it
   * did nothing wrong, so the operator's charge for sending it back is not
   * its to carry. The business lands at exactly zero for the booking.
   */
  async recordCustomerRefund(tx: Prisma.TransactionClient, appointmentId: string): Promise<void> {
    return this.recordRefund(tx, appointmentId, null);
  }

  /** The refund entries; the gateway charge on the business only when it is the business's (null: not). */
  private async recordRefund(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    gatewayChargeMinor: number | null,
  ): Promise<void> {
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        depositAmountMinor: true,
        platformFeeAmountMinor: true,
        businessAmountMinor: true,
        currency: true,
        depositPaidAt: true,
        location: { select: { businessId: true } },
      },
    });

    if (!appointment.depositPaidAt) {
      // Nothing was ever collected, so there is nothing to give back. An entry
      // here would be the platform refunding money it never received.
      return;
    }

    // Idempotent: a reclassification of an already-refunded appointment must
    // not refund it twice.
    const existing = await tx.ledgerEntry.count({
      where: { appointmentId, type: LedgerEntryType.DEPOSIT_REFUND },
    });
    if (existing > 0) {
      throw new ConflictException(
        'This appointment has already been refunded.',
      );
    }

    const businessId = appointment.location.businessId;
    const now = new Date();

    // The originals, read back rather than recomputed (§45.3). Copying their
    // exact negatives in BOTH currencies is what guarantees a business
    // cancellation returns the business to precisely zero — a recomputation
    // from today's rate would leave a residue that grows with every rate move.
    const originals = await tx.ledgerEntry.findMany({
      where: {
        appointmentId,
        type: {
          in: [LedgerEntryType.DEPOSIT_RECEIVED, LedgerEntryType.PLATFORM_FEE],
        },
      },
      select: {
        type: true,
        amountMinor: true,
        settlementCurrency: true,
        settlementAmountMinor: true,
        bookingExchangeRate: true,
      },
    });
    const original = (type: LedgerEntryType) =>
      originals.find((entry) => entry.type === type) ?? null;
    const deposit = original(LedgerEntryType.DEPOSIT_RECEIVED);
    const fee = original(LedgerEntryType.PLATFORM_FEE);

    // The gateway charge is supplied in the SETTLEMENT currency, because that is
    // what the provider actually charged (§45.4). Its USD figure is a reporting
    // equivalent at the booking rate, not the authority.
    const rate = deposit?.bookingExchangeRate ?? null;
    const gatewayChargeInternalMinor = gatewayChargeMinor === null
      ? 0
      : rate
      ? new Prisma.Decimal(gatewayChargeMinor)
          .div(rate)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : gatewayChargeMinor;

    await tx.ledgerEntry.createMany({
      data: [
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.DEPOSIT_REFUND,
          amountMinor: -appointment.depositAmountMinor,
          currency: appointment.currency,
          settlementCurrency: deposit?.settlementCurrency ?? null,
          settlementAmountMinor:
            deposit?.settlementAmountMinor === null ||
            deposit?.settlementAmountMinor === undefined
              ? null
              : -deposit.settlementAmountMinor,
          bookingExchangeRate: deposit?.bookingExchangeRate ?? null,
          availableAt: now,
        },
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.PLATFORM_FEE_REVERSAL,
          amountMinor: appointment.platformFeeAmountMinor,
          currency: appointment.currency,
          settlementCurrency: fee?.settlementCurrency ?? null,
          settlementAmountMinor:
            fee?.settlementAmountMinor === null ||
            fee?.settlementAmountMinor === undefined
              ? null
              : -fee.settlementAmountMinor,
          bookingExchangeRate: fee?.bookingExchangeRate ?? null,
          availableAt: now,
        },
        // The operator's charge, only when the business bears it (its own cancellation).
        ...(gatewayChargeMinor === null
          ? []
          : [
              {
                businessId,
                appointmentId,
                type: LedgerEntryType.GATEWAY_FEE_DEBIT,
                amountMinor: -gatewayChargeInternalMinor,
                currency: appointment.currency,
                settlementCurrency: deposit?.settlementCurrency ?? null,
                settlementAmountMinor: deposit?.settlementCurrency ? -gatewayChargeMinor : null,
                bookingExchangeRate: rate,
                availableAt: now,
              },
            ]),
      ],
    });

    // The deposit pair appended at booking is released at the same time: it is
    // now settled, by being reversed. Leaving it unreleased would hide the
    // refund from every payout run, and the debt with it.
    await tx.ledgerEntry.updateMany({
      where: { appointmentId, availableAt: null, payoutId: null },
      data: { availableAt: now },
    });

    this.logger.warn(
      `Ledger: appointment ${appointmentId} refunded in full ` +
        `(-${appointment.depositAmountMinor}c deposit, +${appointment.platformFeeAmountMinor}c fee back), ` +
        (gatewayChargeMinor === null
          ? `cancelled in time by the customer; no charge on business ${businessId}.`
          : `gateway charge ${gatewayChargeMinor} ${deposit?.settlementCurrency ?? 'minor units'} borne by business ${businessId}.`),
    );
  }

  /**
   * Executes a BillingAdjustment: the decision becomes money.
   *
   * §25.2 renamed `appliedInvoiceId` to `settledAt` + `settlementRef` for this
   * moment. Until now nothing wrote them, so every adjustment was unsettled by
   * definition.
   *
   * Executable exactly once, enforced by requiring `settledAt` to still be null
   * inside the transaction. A twice-executed adjustment is a business paid — or
   * charged — twice for one decision.
   */
  async executeAdjustment(
    tx: Prisma.TransactionClient,
    adjustmentId: string,
    settlementRef: string | null,
    actor: { role: UserRole | string },
  ) {
    this.assertAdmin(actor);

    const adjustment = await tx.billingAdjustment.findUnique({
      where: { id: adjustmentId },
      select: {
        id: true,
        businessId: true,
        appointmentId: true,
        type: true,
        amount: true,
        settledAt: true,
      },
    });
    if (!adjustment) throw new NotFoundException('Billing adjustment not found.');
    if (adjustment.settledAt) {
      throw new ConflictException(
        'This adjustment has already been executed. Record a new adjustment instead.',
      );
    }

    // `amount` is a Decimal in MAJOR units (§24); the ledger is integer minor
    // units. Through `toMinorUnits` rather than a hardcoded x100, so the
    // conversion follows the internal currency's own exponent (§55.2).
    const minor = toMinorUnits(adjustment.amount, INTERNAL_CURRENCY);

    // Signed by the adjustment's own type, from the business's perspective:
    // a fee refund puts money back that was taken from them, a gateway debit
    // takes money they owe.
    const amountMinor =
      adjustment.type === BillingAdjustmentType.FEE_REFUND ? minor : -minor;

    // An adjustment is a decision made TODAY, so it settles at today's rate —
    // unlike a deposit, whose settlement is fixed at the booking it belongs to.
    //
    // From `getSettlementContext`, NOT from the display helper. This line read
    // `getExchangeRateForDisplay()` until §67.5: when §66.2 taught that helper
    // to return null in a single-currency deployment — correct, there is
    // nothing to approximate — every adjustment was written with no settlement
    // figure and became permanently unpayable, because a payout run skips
    // entries it cannot send. A money decision must not depend on a function
    // whose name says "display".
    const settlement = await this.settings.getSettlementContext();

    if (!settlement) {
      // Refuse rather than write an entry nobody can be paid. The money would
      // otherwise sit in the ledger looking settled, visible in a balance, and
      // silently skipped by every run forever.
      throw new BadRequestException(
        'This adjustment cannot be settled: the platform collects in a currency ' +
          'it has no exchange rate for, so there is no amount to send. Set the ' +
          'rate before executing adjustments.',
      );
    }

    const settlementAmountMinor = new Prisma.Decimal(amountMinor)
      .mul(settlement.rate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();

    const entry = await tx.ledgerEntry.create({
      data: {
        businessId: adjustment.businessId,
        appointmentId: adjustment.appointmentId,
        billingAdjustmentId: adjustment.id,
        currency: INTERNAL_CURRENCY,
        type: LedgerEntryType.ADJUSTMENT,
        amountMinor,
        settlementCurrency: settlement.settlementCurrency,
        settlementAmountMinor,
        bookingExchangeRate: settlement.rate,
        // Payable at once. An adjustment is a decision already made; there is
        // no appointment outcome left to wait for.
        availableAt: new Date(),
      },
    });

    const settled = await tx.billingAdjustment.update({
      where: { id: adjustmentId },
      data: { settledAt: new Date(), settlementRef },
    });

    this.logger.warn(
      `Adjustment ${adjustmentId} (${adjustment.type} ${adjustment.amount}) executed as ` +
        `ledger entry ${entry.id} for ${amountMinor}c against business ${adjustment.businessId}.`,
    );

    return { adjustment: settled, entry };
  }

  // ---------- Admin reads (§53.3) ----------

  /**
   * The entries behind a balance, a payout or an appointment.
   *
   * READ-ONLY, and deliberately so: the ledger is append-only and corrections
   * are opposing entries (§34.2). There is no reason for a read endpoint to
   * offer anything else, and every reason for it not to.
   *
   * Added because there was no way to see them at all. Reconciling a figure or
   * answering "why is this business owed that?" meant opening a SQL client,
   * which is not something support can do and not something anyone should have
   * to do to explain money.
   */
  async listEntries(
    actor: { role: UserRole | string },
    query: {
      businessId?: string;
      appointmentId?: string;
      payoutId?: string;
      type?: LedgerEntryType;
      q?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    this.assertAdmin(actor);

    const find = query.q?.trim();
    const where: Prisma.LedgerEntryWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.payoutId ? { payoutId: query.payoutId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(find ? { businessProfile: { name: { contains: find, mode: Prisma.QueryMode.insensitive } } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [total, entries, totals] = await Promise.all([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        where,
        // Newest first: reading a ledger almost always starts from "what just
        // happened", not from the beginning of time.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        include: ADMIN_LEDGER_INCLUDE,
      }),
      // Over the WHOLE filter, not the page. A total that changed when you
      // turned the page would be worse than no total.
      this.prisma.ledgerEntry.groupBy({
        by: ['settlementCurrency'],
        where,
        _sum: { settlementAmountMinor: true, amountMinor: true },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      entries,
      totalsBySettlementCurrency: totals.map((row) => ({
        settlementCurrency: row.settlementCurrency,
        amountMinor: row._sum.settlementAmountMinor ?? 0,
        reportingInternalMinor: row._sum.amountMinor ?? 0,
      })),
    };
  }

  /**
   * Billing adjustments, settled or not.
   *
   * There was no way to list these either — the id had to come from the
   * resolving ticket's response or the database, so an adjustment recorded and
   * never executed was invisible. That is the one state where a decision has
   * been taken and no money has moved (§36.5), which is exactly the state
   * somebody needs to find.
   */
  async listAdjustments(
    actor: { role: UserRole | string },
    query: {
      businessId?: string;
      appointmentId?: string;
      ticketId?: string;
      state?: 'outstanding' | 'executed';
      limit?: number;
      offset?: number;
    },
  ) {
    this.assertAdmin(actor);

    const scope: Prisma.BillingAdjustmentWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.ticketId ? { ticketId: query.ticketId } : {}),
    };
    const where: Prisma.BillingAdjustmentWhereInput = {
      ...scope,
      ...(query.state === 'outstanding' ? { settledAt: null } : {}),
      ...(query.state === 'executed' ? { settledAt: { not: null } } : {}),
    };
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [total, adjustments, outstanding] = await Promise.all([
      this.prisma.billingAdjustment.count({ where }),
      this.prisma.billingAdjustment.findMany({
        where,
        // Unsettled first: those are the ones still waiting on somebody.
        orderBy: [{ settledAt: 'asc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        include: ADJUSTMENT_INCLUDE,
      }),
      // Over the scope, whatever the state filter: the number still waiting.
      this.prisma.billingAdjustment.count({ where: { ...scope, settledAt: null } }),
    ]);

    return { total, limit, offset, outstanding, adjustments };
  }

  /**
   * What the platform should currently be holding, by currency.
   *
   * Every entry with no payout, whether or not it has matured — matured money
   * is still in the platform's hands until a transfer goes out. This is the
   * figure to compare against the provider's actual balance.
   *
   * Nothing compares it automatically. Producing the number is the point; a
   * reconciliation that runs itself and reports "fine" is worse than one a
   * human performs, until there is something to reconcile against.
   */
  async heldTotals(actor: { role: UserRole | string }): Promise<HeldTotalsDto> {
    this.assertAdmin(actor);

    // Grouped by SETTLEMENT currency, because that is the money the platform is
    // actually holding (§51.1). Grouping by the USD `currency` column reported
    // a figure in a currency the platform holds none of — and this endpoint's
    // only purpose is to be compared against the provider's statement, so that
    // defeated it entirely.
    const [grouped, unsettled] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['settlementCurrency'],
        where: { payoutId: null },
        _sum: { settlementAmountMinor: true, amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.count({
        where: { payoutId: null, settlementCurrency: null },
      }),
    ]);

    const bySettlementCurrency = grouped
      .filter((row) => row.settlementCurrency !== null)
      .map((row) => ({
        settlementCurrency: row.settlementCurrency!,
        amountMinor: row._sum.settlementAmountMinor ?? 0,
        entryCount: row._count._all,
        /** The USD equivalent, for reporting only. Never what is held. */
        reportingInternalMinor: row._sum.amountMinor ?? 0,
      }));

    return {
      asOf: new Date().toISOString(),
      bySettlementCurrency,
      /**
       * Entries carrying no settlement figure (§45.1). They are money the
       * platform holds but cannot pay out, so they are counted separately
       * rather than folded into a currency they do not belong to.
       */
      entriesWithoutSettlement: unsettled,
      totalEntries:
        bySettlementCurrency.reduce((sum, c) => sum + c.entryCount, 0) + unsettled,
      note:
        'Ledger entries not yet settled by a payout, matured or not, in the ' +
        'currency they will be PAID in. Compare against the payment ' +
        "provider's actual balance by hand — nothing reconciles these " +
        'automatically. reportingInternalMinor is the internal unit of account and ' +
        'is not what is held.',
    };
  }

  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }

  private availableAtFor(
    appointment: {
      status: AppointmentStatus;
      completedAt: Date | null;
      endTime: Date;
      cancelledBy: CancelledBy | null;
      depositPaidAt: Date | null;
    },
    holdDays: number,
  ): Date | null {
    if (appointment.status === AppointmentStatus.COMPLETED) {
      // completedAt is set by the same update that sets the status, but fall
      // back rather than throw: a missing timestamp must not strand money.
      return addHoldPeriod(appointment.completedAt ?? new Date(), holdDays);
    }

    if (appointment.status === AppointmentStatus.NO_SHOW) {
      return addHoldPeriod(appointment.endTime, holdDays);
    }

    if (
      appointment.status === AppointmentStatus.CANCELLED &&
      appointment.cancelledBy === CancelledBy.CUSTOMER &&
      appointment.depositPaidAt
    ) {
      // The deposit is not refunded when the customer calls it off (§2), so the
      // business keeps its share — from the date the appointment would have
      // ended, since it never had a completion date.
      return addHoldPeriod(appointment.endTime, holdDays);
    }

    // A business cancellation (§36), or an expiry that never took a deposit and
    // therefore has no entries at all.
    return null;
  }
}
