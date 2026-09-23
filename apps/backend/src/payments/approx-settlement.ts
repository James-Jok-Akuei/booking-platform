import { Prisma } from '@prisma/client';
import {
  INTERNAL_CURRENCY,
  convertMinorUnits,
  minorUnitsPerMajor,
} from './currency';

/**
 * An indicative local-currency figure shown beside a USD amount (§39).
 *
 * Display only. It is never persisted, never compared, never used in any
 * calculation, and never accepted as input. `approximate: true` is a literal
 * rather than a computed flag because it is never false: the platform cannot
 * promise a rate it does not control between browsing and paying.
 */
export interface ApproxSettlement {
  currency: string;
  amountMinor: number;
  exchangeRate: string;
  rateAsOf: Date | null;
  approximate: true;
}

/** The USD fields on an appointment that a customer is shown. */
export type ApproxSettlementMap = Record<string, ApproxSettlement>;

export interface RateContext {
  providerCurrency: string;
  rate: Prisma.Decimal;
  updatedAt: Date | null;
}

/**
 * Converts one internal amount, rounded to a whole unit of the local currency.
 *
 * Whole units, not minor ones: the rate behind this is set by hand and may be
 * a day old (§37), so presenting piastres would claim a precision the number
 * does not have. `amountMinor` keeps the platform's integer-minor-units
 * convention — the rounding is in the value, not in the unit.
 *
 * Since §55 the rounding is exponent-aware rather than a hardcoded 100. In a
 * currency with no minor unit, such as RWF, "rounded to whole units" is already
 * what conversion produces and this step changes nothing — which is the correct
 * behaviour, and was not the previous behaviour.
 */
export function approxSettlementFor(
  amountMinor: number,
  context: RateContext,
): ApproxSettlement {
  const per = minorUnitsPerMajor(context.providerCurrency);
  const converted = convertMinorUnits(
    amountMinor,
    INTERNAL_CURRENCY,
    context.providerCurrency,
    context.rate,
  );
  const wholeUnits = new Prisma.Decimal(converted)
    .div(per)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return {
    currency: context.providerCurrency,
    amountMinor: wholeUnits.mul(per).toNumber(),
    exchangeRate: context.rate.toFixed(8),
    rateAsOf: context.updatedAt,
    approximate: true,
  };
}

/**
 * Builds the per-amount map for one response object.
 *
 * Keyed by the USD field it converts, so a client reading `depositAmountCents`
 * finds its counterpart at `approxSettlement.depositAmountCents` and never has
 * to convert anything itself. Amounts that are null are skipped rather than
 * converted to zero — a missing price and a free one are different claims.
 */
export function approxSettlementMap(
  amounts: Record<string, number | null | undefined>,
  context: RateContext,
): ApproxSettlementMap {
  const map: ApproxSettlementMap = {};
  for (const [field, value] of Object.entries(amounts)) {
    if (typeof value !== 'number') continue;
    map[field] = approxSettlementFor(value, context);
  }
  return map;
}
