import type { LedgerEntryType } from '../api/admin';

/**
 * The ledger's words, in one place (§85, §86, §251).
 *
 * The labels are the domain's own — they match the enum, the API and
 * DECISIONS — because §85 renamed them into sentences and was reversed: "plain
 * words when I explain, the domain's words on screen". What a label cannot say
 * (who gained or lost the money) is said beside it, in `ENTRY_MEANING`.
 */
export const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  DEPOSIT_RECEIVED: 'Deposit received',
  PLATFORM_FEE: 'Platform fee',
  DEPOSIT_REFUND: 'Deposit refunded',
  PLATFORM_FEE_REVERSAL: 'Platform fee returned',
  GATEWAY_FEE_DEBIT: 'Gateway fee',
  ADJUSTMENT: 'Manual adjustment',
};

/** What each line means, and — the part the label cannot carry — WHO gained or lost the money (§86). */
export const ENTRY_MEANING: Record<LedgerEntryType, string> = {
  DEPOSIT_RECEIVED: "The customer's payment at booking. Owed to the business.",
  PLATFORM_FEE: 'Our cut of that payment, taken from the business.',
  DEPOSIT_REFUND: 'The customer got their payment back, because the business cancelled.',
  PLATFORM_FEE_REVERSAL:
    'We hand our own cut back too, so the business is not left funding our fee on a booking it earned nothing from. ' +
    'The money reaches the customer, who is refunded in full.',
  GATEWAY_FEE_DEBIT: 'What the operator charged to move the refund. Borne by the business that cancelled, because it caused it.',
  ADJUSTMENT: 'A correction recorded and executed under Adjustments.',
};

export const ADJUSTMENT_LABEL = {
  FEE_REFUND: 'Fee refund',
  GATEWAY_FEE_DEBIT: 'Gateway fee charged back',
} as const;
