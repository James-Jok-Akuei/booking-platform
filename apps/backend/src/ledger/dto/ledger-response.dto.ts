import {
  BillingAdjustmentType,
  LedgerEntryType,
  Prisma,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';
import type { NotComparableReason } from '../reconciliation.service';

// ---------------------------------------------------------------------------
// Entries (§128.21)
// ---------------------------------------------------------------------------

type LedgerEntryRow = Serialised<Prisma.LedgerEntryGetPayload<object>>;

/**
 * One line of the append-only ledger. Returned whole, with no select.
 *
 * `amountMinor` is the REPORTING figure in the unit of account.
 * `settlementAmountMinor` is authoritative for payouts (§45). Both are nullable
 * on the settlement side only because rows written before §45 genuinely have no
 * settlement figure — those are excluded from payouts rather than converted at
 * a guessed rate.
 */
export class LedgerEntryDto implements LedgerEntryRow {
  id!: string;
  businessId!: string;
  appointmentId!: string | null;
  type!: LedgerEntryType;

  amountMinor!: number;
  currency!: string;

  settlementCurrency!: string | null;
  settlementAmountMinor!: number | null;
  /** The rate this entry was fixed at. A string, like every Decimal here. */
  bookingExchangeRate!: string | null;

  /** When the money matures. Null means it is not payable yet (§38.1). */
  availableAt!: string | null;

  payoutId!: string | null;
  billingAdjustmentId!: string | null;
  createdAt!: string;
}

export const __ledgerEntryDtoIsExact: NoExtraFields<
  LedgerEntryDto,
  LedgerEntryRow
> = true;

/** A per-currency total over the WHOLE filter, not the page. */
export class SettlementTotalDto {
  settlementCurrency!: string | null;
  amountMinor!: number;
  /** The unit-of-account equivalent, for reporting only. Never what is held. */
  reportingInternalMinor!: number;
}

export class LedgerEntryPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  entries!: LedgerEntryDto[];

  /**
   * Totals over the whole filter rather than the page. A total that changed
   * when you turned the page would be worse than no total.
   */
  totalsBySettlementCurrency!: SettlementTotalDto[];
}

// ---------------------------------------------------------------------------
// What the platform is holding
// ---------------------------------------------------------------------------

export class HeldCurrencyDto {
  settlementCurrency!: string;
  amountMinor!: number;
  entryCount!: number;
  /** The unit-of-account equivalent, for reporting only. Never what is held. */
  reportingInternalMinor!: number;
}

/**
 * The figure to compare against the operator's statement (§51.1).
 *
 * Grouped by SETTLEMENT currency, because that is the money actually held.
 * Grouping by the reporting currency produced a figure in a currency the
 * platform holds none of, which defeated the endpoint's only purpose.
 */
export class HeldTotalsDto {
  asOf!: string;
  bySettlementCurrency!: HeldCurrencyDto[];

  /**
   * Entries carrying no settlement figure (§45.1). Money the platform holds
   * but cannot pay out, counted separately rather than folded into a currency
   * they do not belong to.
   */
  entriesWithoutSettlement!: number;
  totalEntries!: number;
  note!: string;
}

// ---------------------------------------------------------------------------
// Our figure beside the operator's (§87)
// ---------------------------------------------------------------------------

export class WalletBalanceOkDto {
  wallet!: 'COLLECTION' | 'DISBURSEMENT';
  status!: 'OK';
  /** Verbatim from the operator: a decimal string in MAJOR units. */
  reportedAmount!: string;
  currency!: string;
  /** Null when the exponent for `currency` is unknown — unconverted, not guessed (§55.2). */
  amountMinor!: number | null;
}

export class WalletBalanceUnavailableDto {
  wallet!: 'COLLECTION' | 'DISBURSEMENT';
  status!: 'UNAVAILABLE';
  /** What went wrong, in words, for the screen that shows it. */
  reason!: string;
}

/**
 * The point of the pairing is the DIFFERENCE, which is the only thing that
 * catches a payment that landed and was never recorded. So the hard part is
 * refusing to show a difference that would be a lie: `comparable` is false and
 * `difference` null whenever the two figures cannot honestly be subtracted, and
 * `notComparableReason` says which of the four cases applies.
 */
export class ReconciliationDto {
  asOf!: string;
  /** Sandbox reports a fixed balance no transfer moves, so nothing is comparable. */
  isSandbox!: boolean;

  ledger!: HeldCurrencyDto[];
  entriesWithoutSettlement!: number;

  @ApiProperty({
    description: 'Each wallet reported independently, because either may fail alone.',
    type: 'array',
    items: {
      oneOf: [
        { $ref: '#/components/schemas/WalletBalanceOkDto' },
        { $ref: '#/components/schemas/WalletBalanceUnavailableDto' },
      ],
    },
  })
  wallets!: Array<WalletBalanceOkDto | WalletBalanceUnavailableDto>;

  comparable!: boolean;
  /** Null whenever the figures cannot honestly be subtracted. */
  difference!: number | null;
  notComparableReason!: NotComparableReason | null;
  note!: string;
}

// ---------------------------------------------------------------------------
// Billing adjustments (§25.2)
// ---------------------------------------------------------------------------

/** One include, shared with the DTO describing its result (§128.5). */
export const ADJUSTMENT_INCLUDE = {
  ledgerEntries: {
    select: { id: true, amountMinor: true, settlementAmountMinor: true },
  },
} as const satisfies Prisma.BillingAdjustmentInclude;

type AdjustmentRow = Serialised<
  Prisma.BillingAdjustmentGetPayload<{ include: typeof ADJUSTMENT_INCLUDE }>
>;

export class AdjustmentEntryDto {
  id!: string;
  amountMinor!: number;
  settlementAmountMinor!: number | null;
}

/**
 * A decision recorded, which may or may not have been turned into money yet.
 *
 * `settledAt` + `settlementRef` replaced `appliedInvoiceId` in §25.2 for
 * exactly that distinction: an adjustment exists as a decision first, and
 * executing it writes the ledger entry.
 */
export class AdjustmentDto implements AdjustmentRow {
  id!: string;
  businessId!: string;
  appointmentId!: string | null;
  ticketId!: string | null;

  type!: BillingAdjustmentType;
  /** MAJOR units, as a decimal string (§24). The ledger is integer minor units. */
  amount!: string;
  reason!: string;

  /** Null until executed. Set together, never one without the other. */
  settledAt!: string | null;
  settlementRef!: string | null;

  /** The ledger entries this adjustment produced. Empty until it is executed. */
  ledgerEntries!: AdjustmentEntryDto[];

  createdById!: string;
  createdAt!: string;
}

export const __adjustmentDtoIsExact: NoExtraFields<AdjustmentDto, AdjustmentRow> = true;

export class AdjustmentPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  /** How many are still waiting on somebody. Unsettled are listed first. */
  outstanding!: number;
  adjustments!: AdjustmentDto[];
}

/** The bare adjustment row, with no entries joined — what executing one answers. */
export class SettledAdjustmentDto {
  id!: string;
  businessId!: string;
  appointmentId!: string | null;
  ticketId!: string | null;
  type!: BillingAdjustmentType;
  amount!: string;
  reason!: string;
  settledAt!: string | null;
  settlementRef!: string | null;
  createdById!: string;
  createdAt!: string;
}

/** A decision turned into money: the settled adjustment and the entry it wrote. */
export class ExecutedAdjustmentDto {
  adjustment!: SettledAdjustmentDto;
  entry!: LedgerEntryDto;
}
