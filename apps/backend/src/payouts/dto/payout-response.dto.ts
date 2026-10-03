import { MobileMoneyProvider, PayoutStatus, Prisma } from '@prisma/client';
import { Serialised } from '../../common/serialised';
import type { PauseReason, RunSummary } from '../payouts.service';

/** One include, shared with the DTO that describes its result (§128.5). */
export const PAYOUT_INCLUDE = {
  businessProfile: { select: { id: true, name: true } },
} as const satisfies Prisma.PayoutInclude;

type PayoutRow = Serialised<Prisma.PayoutGetPayload<object>>;
type AdminPayoutRow = Serialised<
  Prisma.PayoutGetPayload<{ include: typeof PAYOUT_INCLUDE }>
>;

/**
 * A payout row as it goes over the wire.
 *
 * `send`, `mark-paid` and `mark-failed` all answer with the bare row, so this
 * is the shape three routes return and a business's own list is made of.
 */
export class PayoutDto implements PayoutRow {
  id!: string;
  businessId!: string;

  /**
   * The REPORTING figure, in the platform's unit of account. Not what is sent
   * (§45.1) — that is `settlementAmountMinor`, below.
   */
  amountMinor!: number;
  currency!: string;

  /** What is actually transferred, and in what. Summed with no conversion (§46). */
  settlementCurrency!: string;
  settlementAmountMinor!: number;

  status!: PayoutStatus;

  /** OUR reference, written before the operator is called, never after (§64.3). */
  providerReferenceId!: string | null;
  sentAt!: string | null;

  /** The provider's reference. Required to mark a payout PAID — it is the only proof. */
  reference!: string | null;
  failureReason!: string | null;

  runAt!: string;
  paidAt!: string | null;
  createdAt!: string;
}

export class AdminPayoutBusinessDto {
  id!: string;
  name!: string | null;
}

/**
 * A payout as the console reads it (§65.1).
 *
 * A HYBRID: the row is spread whole and the business name and destination are
 * joined on top. So it is checked against the payload like a selected response
 * (§128.1) rather than declared as a return type like a built one (§128.4) —
 * making the service convert seven dates by hand would be noise, and
 * `Serialised<T>` already says what they become.
 *
 * The destination is on the row because without it the screen showed a truncated
 * business id and an amount, which is not enough to pay anybody: an admin had to
 * export the CSV just to read a name and a number the screen could have shown.
 */
export class AdminPayoutDto extends PayoutDto implements AdminPayoutRow {
  /** Spread from the row, so the nested profile is on the wire too. */
  businessProfile!: AdminPayoutBusinessDto;

  businessName!: string | null;

  /**
   * Null when there is no verified destination — which is also why this payout
   * cannot be sent, and what the console says instead of failing quietly (§48.3).
   */
  destinationMsisdn!: string | null;
  destinationProvider!: MobileMoneyProvider | null;
}

export class AdminPayoutPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  payouts!: AdminPayoutDto[];
}

/** A business's own payout history. Carries the id it was scoped to (§66.2). */
export class BusinessPayoutPageDto {
  businessId!: string;
  total!: number;
  limit!: number;
  offset!: number;
  payouts!: PayoutDto[];
}

export class PausedBusinessDto {
  businessId!: string;
  reason!: PauseReason;
}

/** What one payout run did — and, as importantly, what it held back. */
export class PayoutRunSummaryDto implements Serialised<RunSummary> {
  runAt!: string;
  businessesConsidered!: number;
  payoutsCreated!: number;

  /** Minor units of the SETTLEMENT currency, not of the internal one (§51.2). */
  totalMinor!: number;
  /** The currencies that total spans. Plural because a run can pay several. */
  settlementCurrencies!: string[];

  /** Businesses whose available balance was zero or negative (§35.3). */
  skippedNonPositive!: number;
  /** Businesses skipped because they are SUSPENDED (§42.4). */
  pausedForSuspension!: number;
  /** Businesses skipped for having no VERIFIED payout destination (§48.3). */
  pausedForUnverifiedDestination!: number;

  /**
   * Every business held back this run, and why — so an admin has a list to
   * chase rather than a silently smaller payout batch.
   */
  pausedBusinesses!: PausedBusinessDto[];

  /** Entries with no settlement amount, which cannot be paid (§46.3). */
  entriesWithoutSettlement!: number;
}

export class SettlementAmountDto {
  currency!: string;
  amountMinor!: number;
}

export class PendingSettlementAmountDto {
  settlementCurrency!: string;
  amountMinor!: number;
}

/** Payouts created and not yet sent. Money on its way, not lost. */
export class PendingPayoutsDto {
  count!: number;
  reportingInternalMinor!: number;
  bySettlementCurrency!: PendingSettlementAmountDto[];
}

export class LedgerEntryCountsDto {
  available!: number;
  pending!: number;
  unresolved!: number;
}

/**
 * What a business is owed, and what it has been paid.
 *
 * `payoutsPausedReason` names WHICH of the two holds, because reporting only
 * suspension told a business whose payout number was waiting to be checked that
 * payouts were fine while every run skipped it (§48.3, §77).
 */
export class BusinessBalanceDto {
  businessId!: string;

  payoutsPaused!: boolean;
  payoutsPausedReason!: 'BUSINESS_SUSPENDED' | 'DESTINATION_NOT_VERIFIED' | null;

  /** What is payable, per settlement currency, with no conversion (§46). */
  availableBySettlementCurrency!: SettlementAmountDto[];

  /** The reporting currency the four totals below are in (§45.1). */
  currency!: string;
  availableNowMinor!: number;
  pendingMinor!: number;
  /** Deposits on appointments that have not happened yet, or not resolved. */
  unresolvedMinor!: number;
  lifetimePaidMinor!: number;
  payoutCount!: number;

  pendingPayouts!: PendingPayoutsDto;
  entryCounts!: LedgerEntryCountsDto;

  /** Plain-language explanation of the figures above, including why a payout is held. */
  note!: string;
}
