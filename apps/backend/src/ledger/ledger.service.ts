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
import { PlatformSettingsService } from '../settings/platform-settings.service';
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
   * They sum to `businessAmountCents` by construction, since that is defined as
   * the deposit minus the fee (§16.3). Asserted by test.
   */
  async recordDepositReceived(
    tx: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<void> {
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        depositAmountCents: true,
        platformFeeAmountCents: true,
        currency: true,
        providerCurrency: true,
        providerCurrencyAmountCents: true,
        exchangeRateUsed: true,
        location: { select: { businessId: true } },
      },
    });

    const businessId = appointment.location.businessId;

    // The figure the provider ACTUALLY CHARGED, not a recomputation from a rate
    // (§45.2). Null when the appointment never went through the payment
    // initiation that records it; such entries carry no settlement figure and
    // payouts exclude them rather than convert at a guessed rate.
    const charged = appointment.providerCurrencyAmountCents;
    const settlement =
      charged === null
        ? null
        : splitSettlement({
            chargedMinor: charged,
            depositAmountCents: appointment.depositAmountCents,
            platformFeeAmountCents: appointment.platformFeeAmountCents,
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
          amountCents: appointment.depositAmountCents,
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
          amountCents: -appointment.platformFeeAmountCents,
          currency: appointment.currency,
          ...settlementFields,
          // Negative, matching amountCents. The business's settlement share is
          // the remainder by construction, so the pair sums exactly.
          settlementAmountMinor:
            settlement === null ? null : -settlement.feeMinor,
          availableAt: null,
        },
      ],
    });

    this.logger.log(
      `Ledger: appointment ${appointmentId} deposit ${appointment.depositAmountCents}c ` +
        `less fee ${appointment.platformFeeAmountCents}c recorded for business ${businessId}.`,
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
   * The first two net to exactly `-businessAmountCents`, cancelling the pair
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
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        depositAmountCents: true,
        platformFeeAmountCents: true,
        businessAmountCents: true,
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
        amountCents: true,
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
    const gatewayUsdCents = rate
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
          amountCents: -appointment.depositAmountCents,
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
          amountCents: appointment.platformFeeAmountCents,
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
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.GATEWAY_FEE_DEBIT,
          amountCents: -gatewayUsdCents,
          currency: appointment.currency,
          settlementCurrency: deposit?.settlementCurrency ?? null,
          settlementAmountMinor: deposit?.settlementCurrency
            ? -gatewayChargeMinor
            : null,
          bookingExchangeRate: rate,
          availableAt: now,
        },
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
        `(-${appointment.depositAmountCents}c deposit, +${appointment.platformFeeAmountCents}c fee back), ` +
        `gateway charge ${gatewayChargeMinor} ${deposit?.settlementCurrency ?? 'minor units'} ` +
        `borne by business ${businessId}.`,
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

    // `amount` is a Decimal in MAJOR units (§24), and the ledger is integer
    // cents. Converted through Prisma.Decimal rather than float arithmetic,
    // like every other money conversion here.
    const cents = new Prisma.Decimal(adjustment.amount)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();

    // Signed by the adjustment's own type, from the business's perspective:
    // a fee refund puts money back that was taken from them, a gateway debit
    // takes money they owe.
    const amountCents =
      adjustment.type === BillingAdjustmentType.FEE_REFUND ? cents : -cents;

    // An adjustment is a decision made TODAY, so it settles in today's provider
    // currency at today's rate — unlike a deposit, whose settlement is fixed at
    // the booking it belongs to. The admin's figure is in settlement currency
    // (§45.5); the USD amount above is the reporting equivalent.
    const display = await this.settings.getExchangeRateForDisplay();
    const settlementAmountMinor = display
      ? new Prisma.Decimal(amountCents)
          .mul(display.rate)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : null;

    const entry = await tx.ledgerEntry.create({
      data: {
        businessId: adjustment.businessId,
        appointmentId: adjustment.appointmentId,
        billingAdjustmentId: adjustment.id,
        type: LedgerEntryType.ADJUSTMENT,
        amountCents,
        settlementCurrency: display?.providerCurrency ?? null,
        settlementAmountMinor,
        bookingExchangeRate: display?.rate ?? null,
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
        `ledger entry ${entry.id} for ${amountCents}c against business ${adjustment.businessId}.`,
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
      limit?: number;
      offset?: number;
    },
  ) {
    this.assertAdmin(actor);

    const where: Prisma.LedgerEntryWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.payoutId ? { payoutId: query.payoutId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [total, entries, totals] = await Promise.all([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        where,
        // Newest first: reading a ledger almost always starts from "what just
        // happened", not from the beginning of time.
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      // Over the WHOLE filter, not the page. A total that changed when you
      // turned the page would be worse than no total.
      this.prisma.ledgerEntry.groupBy({
        by: ['settlementCurrency'],
        where,
        _sum: { settlementAmountMinor: true, amountCents: true },
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
        reportingUsdCents: row._sum.amountCents ?? 0,
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
      limit?: number;
      offset?: number;
    },
  ) {
    this.assertAdmin(actor);

    const where: Prisma.BillingAdjustmentWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.ticketId ? { ticketId: query.ticketId } : {}),
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
        include: {
          ledgerEntries: {
            select: { id: true, amountCents: true, settlementAmountMinor: true },
          },
        },
      }),
      this.prisma.billingAdjustment.count({ where: { ...where, settledAt: null } }),
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
  async heldTotals(actor: { role: UserRole | string }) {
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
        _sum: { settlementAmountMinor: true, amountCents: true },
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
        reportingUsdCents: row._sum.amountCents ?? 0,
      }));

    return {
      asOf: new Date(),
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
        'automatically. reportingUsdCents is the internal unit of account and ' +
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
