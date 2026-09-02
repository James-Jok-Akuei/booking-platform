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
        location: { select: { businessId: true } },
      },
    });

    const businessId = appointment.location.businessId;

    await tx.ledgerEntry.createMany({
      data: [
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountCents: appointment.depositAmountCents,
          currency: appointment.currency,
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
   * `gatewayChargeCents` is supplied by the caller and never derived. The MoMo
   * integration does not report what it charged on a transaction or a refund
   * (§36.2), so a percentage constant here would be a number the ledger
   * asserted and the provider's statement contradicted. A ledger that computes
   * a fee the provider charged differently is a ledger nobody can reconcile.
   */
  async recordBusinessCancellationRefund(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    gatewayChargeCents: number,
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

    await tx.ledgerEntry.createMany({
      data: [
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.DEPOSIT_REFUND,
          amountCents: -appointment.depositAmountCents,
          currency: appointment.currency,
          availableAt: now,
        },
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.PLATFORM_FEE_REVERSAL,
          amountCents: appointment.platformFeeAmountCents,
          currency: appointment.currency,
          availableAt: now,
        },
        {
          businessId,
          appointmentId,
          type: LedgerEntryType.GATEWAY_FEE_DEBIT,
          amountCents: -gatewayChargeCents,
          currency: appointment.currency,
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
        `gateway charge ${gatewayChargeCents}c borne by business ${businessId}.`,
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

    const entry = await tx.ledgerEntry.create({
      data: {
        businessId: adjustment.businessId,
        appointmentId: adjustment.appointmentId,
        billingAdjustmentId: adjustment.id,
        type: LedgerEntryType.ADJUSTMENT,
        amountCents,
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

    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['currency'],
      where: { payoutId: null },
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    const byCurrency = grouped.map((row) => ({
      currency: row.currency,
      amountCents: row._sum.amountCents ?? 0,
      entryCount: row._count._all,
    }));

    return {
      asOf: new Date(),
      byCurrency,
      totalEntries: byCurrency.reduce((sum, c) => sum + c.entryCount, 0),
      note:
        'Ledger entries not yet settled by a payout, matured or not. Compare ' +
        "against the payment provider's actual balance by hand — nothing " +
        'reconciles these automatically.',
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
