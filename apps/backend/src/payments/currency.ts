import { Prisma } from '@prisma/client';

/**
 * The platform's internal unit of account (§18.1, §55.1).
 *
 * Every price, deposit and fee is computed and stored in the MINOR UNITS of
 * this currency, regardless of what currency actually changes hands.
 *
 * ## Why it is configurable, and why it is an env var
 *
 * It was hardcoded to USD because South Sudan's SSP has run at roughly 97%
 * annual inflation, so pricing services natively in it would mean businesses
 * repricing their entire catalogue every few weeks. That reasoning is about one
 * currency, not about USD, and it does not hold everywhere: a stable currency
 * is a better unit of account than a foreign one, because a customer then sees
 * an exact price rather than an approximation of one (§55.1).
 *
 * It is a DEPLOYMENT constant, not an admin setting, and deliberately not
 * changeable at runtime. Every stored amount is denominated in it, so changing
 * it once money exists would silently reinterpret every row in the ledger. The
 * boot check in `CurrencyGuard` refuses to start rather than allow that.
 */
export const INTERNAL_CURRENCY = (process.env.INTERNAL_CURRENCY ?? 'USD')
  .trim()
  .toUpperCase();

/**
 * How many decimal places each currency's minor unit has.
 *
 * This table is the thing whose absence was flagged as a known gap: the old
 * conversion assumed both sides used two decimal places, which is true of USD,
 * EUR and SSP and false of RWF, UGX and JPY. A zero-decimal currency run
 * through a two-decimal assumption is wrong by a factor of 100 — in the
 * direction of charging a customer a hundred times the price.
 *
 * ISO 4217 exponents. Extend it as currencies are added; an unrecognised code
 * is refused rather than defaulted (see `minorUnitExponent`).
 */
export const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  // Two decimal places
  USD: 2,
  EUR: 2,
  GBP: 2,
  SSP: 2,
  KES: 2,
  TZS: 2,
  ETB: 2,
  ZAR: 2,
  NGN: 2,
  CDF: 2,
  // No minor unit in practice
  RWF: 0,
  UGX: 0,
  BIF: 0,
  DJF: 0,
  XOF: 0,
  XAF: 0,
  JPY: 0,
  KRW: 0,
  // Three decimal places
  KWD: 3,
  BHD: 3,
  TND: 3,
};

/**
 * The exponent for a currency, or a thrown error.
 *
 * Deliberately NOT defaulting to 2. A default would make an unknown currency
 * look like it worked while mis-stating every amount in it by a factor of 100
 * or 1000 — and it would do so quietly, in the one part of the system where
 * quiet wrongness is most expensive. Refusing is loud, immediate, and fixed by
 * adding one line to the table above.
 */
export function minorUnitExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  const exponent = MINOR_UNIT_EXPONENT[code];
  if (exponent === undefined) {
    throw new Error(
      `Unknown currency "${code}": its minor-unit exponent is not recorded. ` +
        'Add it to MINOR_UNIT_EXPONENT in src/payments/currency.ts. It is not ' +
        'assumed to be 2, because assuming wrongly misstates money by 100x.',
    );
  }
  return exponent;
}

/** 10^exponent, as a Decimal — the minor units in one major unit. */
export function minorUnitsPerMajor(currency: string): Prisma.Decimal {
  return new Prisma.Decimal(10).pow(minorUnitExponent(currency));
}

/**
 * Converts an amount between two currencies, in minor units, at a given rate.
 *
 * `rate` is how many units of `to` one MAJOR unit of `from` buys — the same
 * meaning the admin-set exchange rate has always had, so the stored rate needs
 * no reinterpretation.
 *
 * The exponents are applied on the way through, which is the whole point:
 *
 *     900 USD minor (= 9.00 USD) at 1300 RWF/USD
 *       -> 9.00 x 1300 = 11700 RWF
 *       -> 11700 RWF minor, because RWF has no minor unit.
 *
 * The old implementation multiplied minor units by the rate directly, which is
 * correct only when both exponents match. Here it would have produced
 * 1,170,000 — a hundred times the price.
 *
 * Prisma.Decimal throughout, with ROUND_HALF_UP at the single point of
 * rounding: this is the number a customer is actually charged, so it gets the
 * same treatment as every other money calculation in the codebase.
 */
export function convertMinorUnits(
  amountMinor: number,
  from: string,
  to: string,
  rate: Prisma.Decimal,
): number {
  return new Prisma.Decimal(amountMinor)
    .div(minorUnitsPerMajor(from))
    .mul(rate)
    .mul(minorUnitsPerMajor(to))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Minor units rendered as major units, with the right number of decimals.
 *
 * `1234` is "12.34" in USD and "1234" in RWF. Anywhere money is shown to a
 * person — an email, a CSV, a provider request body — has to go through this
 * rather than dividing by 100, which is what three separate call sites did
 * before §55.
 */
export function formatMajorUnits(amountMinor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  return new Prisma.Decimal(amountMinor)
    .div(minorUnitsPerMajor(currency))
    .toFixed(exponent);
}

/**
 * Money as a person reads it, "RWF 5,200" or "USD 12.50" (§292): the code,
 * then the amount with its thousands marked. `formatMajorUnits` stays bare
 * for files and sums; this is for words.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const major = Number(formatMajorUnits(Math.abs(amountMinor), currency));
  const words = major.toLocaleString('en-US', { minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  return `${amountMinor < 0 ? '−' : ''}${currency} ${words}`;
}

/** Major units back to minor, for values that arrive as decimals (§24). */
export function toMinorUnits(amountMajor: Prisma.Decimal | number, currency: string): number {
  return new Prisma.Decimal(amountMajor)
    .mul(minorUnitsPerMajor(currency))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Whether money changing hands needs converting at all.
 *
 * When the platform's unit of account IS the currency the provider charges in —
 * a Rwanda deployment priced in RWF and collecting RWF — there is no conversion,
 * no rate to go stale, and no approximate figure worth showing. The machinery
 * stays (a second country will need it again) but it idles, and this is the one
 * predicate that decides so, rather than each caller guessing (§55.3).
 */
export function isSettlementCurrency(currency: string): boolean {
  return currency.trim().toUpperCase() === INTERNAL_CURRENCY;
}
