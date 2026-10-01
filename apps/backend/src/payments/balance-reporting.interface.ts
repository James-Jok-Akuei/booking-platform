import { MobileMoneyProvider } from '@prisma/client';

/**
 * Asking an operator what it is holding (§87).
 *
 * Its own interface, not methods on `DisbursementProvider`, which says it is
 * "deliberately narrow ... balance enquiry, reversals and statements are
 * separate problems and would each need their own thinking." That still holds.
 * This is the separate thinking, kept separate: a provider that can send money
 * may not be able to report a balance — MTN's sandbox is exactly that, its
 * collection wallet returns 500 to every form of the request — so the ability
 * has to be expressible on its own.
 */
export interface BalanceReporting {
  readonly key: MobileMoneyProvider;
  readonly name: string;

  /** Both wallets, each reported independently because either may fail alone. */
  checkBalances(): Promise<WalletBalance[]>;
}

/** Money IN lands in `COLLECTION`; money OUT leaves from `DISBURSEMENT`. */
export type WalletKind = 'COLLECTION' | 'DISBURSEMENT';

export type WalletBalance =
  | {
      wallet: WalletKind;
      status: 'OK';
      /**
       * As the operator reported it: a decimal string in MAJOR units.
       * Kept verbatim, because it is the only figure we were actually told.
       */
      reportedAmount: string;
      currency: string;
      /**
       * The same figure in minor units, when the exponent for `currency` is
       * known. Null when it is not — a balance we cannot place a decimal point
       * in is reported unconverted rather than guessed at (§55.2).
       */
      amountMinor: number | null;
    }
  | {
      wallet: WalletKind;
      status: 'UNAVAILABLE';
      /** What went wrong, in words, for the screen that shows it. */
      reason: string;
    };
