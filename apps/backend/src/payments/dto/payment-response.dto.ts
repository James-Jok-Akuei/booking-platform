import { MobileMoneyProvider } from '@prisma/client';

/**
 * How to render money (§70.1).
 *
 * Fetched, never assumed. Dividing by 100 is correct in a two-decimal currency
 * and wrong by a factor of a hundred in a currency with no minor unit — the
 * §55.2 mistake, moved to the front end where it is harder to see.
 *
 * Unauthenticated, because a client needs it before anyone signs in and it
 * reveals nothing.
 */
export class CurrencyDto {
  code!: string;
  /** Decimal places. Divide a minor-unit amount by 10^exponent to display it. */
  exponent!: number;
  minorUnitsPerMajor!: number;
  /** The rule in words, including the no-minor-unit case. */
  note!: string;
}

/**
 * Which operators can actually be charged right now, and which one to offer.
 *
 * `providers` is what the platform can act on, not what exists in the country:
 * pre-selecting an operator that is unavailable would put a customer one tap
 * from a 503.
 */
export class PaymentProvidersDto {
  providers!: MobileMoneyProvider[];

  /**
   * A GUESS from the phone number, or null. Prefixes follow operators loosely
   * and a ported number keeps its old one, so a client should pre-select this
   * and still let the customer change it (§58.1).
   */
  suggested!: MobileMoneyProvider | null;

  /** True when the number looks like one the platform cannot route on its own. */
  choiceRequired!: boolean;
}
