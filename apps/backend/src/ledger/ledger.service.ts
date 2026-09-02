import { Injectable, Logger } from '@nestjs/common';
import {
  AppointmentStatus,
  CancelledBy,
  LedgerEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long after an appointment resolves before its money can be paid out.
 *
 * A settling period, not a processing delay: it is the window in which a
 * dispute can still arrive, and paying out inside it would mean clawing money
 * back from a business that has already been given it.
 */
export const PAYOUT_HOLD_DAYS = 7;

export const addHoldPeriod = (from: Date) =>
  new Date(from.getTime() + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000);

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

  constructor(private readonly prisma: PrismaService) {}

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

    const availableAt = this.availableAtFor(appointment);
    if (!availableAt) return 0;

    const { count } = await tx.ledgerEntry.updateMany({
      where: { appointmentId, availableAt: null, payoutId: null },
      data: { availableAt },
    });

    if (count > 0) {
      this.logger.log(
        `Ledger: ${count} entr${count === 1 ? 'y' : 'ies'} for appointment ${appointmentId} ` +
          `become payable at ${availableAt.toISOString()}.`,
      );
    }

    return count;
  }

  private availableAtFor(appointment: {
    status: AppointmentStatus;
    completedAt: Date | null;
    endTime: Date;
    cancelledBy: CancelledBy | null;
    depositPaidAt: Date | null;
  }): Date | null {
    if (appointment.status === AppointmentStatus.COMPLETED) {
      // completedAt is set by the same update that sets the status, but fall
      // back rather than throw: a missing timestamp must not strand money.
      return addHoldPeriod(appointment.completedAt ?? new Date());
    }

    if (appointment.status === AppointmentStatus.NO_SHOW) {
      return addHoldPeriod(appointment.endTime);
    }

    if (
      appointment.status === AppointmentStatus.CANCELLED &&
      appointment.cancelledBy === CancelledBy.CUSTOMER &&
      appointment.depositPaidAt
    ) {
      // The deposit is not refunded when the customer calls it off (§2), so the
      // business keeps its share — from the date the appointment would have
      // ended, since it never had a completion date.
      return addHoldPeriod(appointment.endTime);
    }

    // A business cancellation (§36), or an expiry that never took a deposit and
    // therefore has no entries at all.
    return null;
  }
}
