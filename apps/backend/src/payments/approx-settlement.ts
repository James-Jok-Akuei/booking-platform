import { Prisma } from '@prisma/client';
import { convertUsdCentsToProviderCents } from './currency';

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
 * Converts one USD amount, rounded to a whole unit of the local currency.
 *
 * Whole units, not minor ones: the rate behind this is set by hand and may be
 * a day old (§37), so presenting piastres would claim a precision the number
 * does not have. `amountMinor` keeps the platform's integer-minor-units
 * convention and is therefore always a multiple of 100 — the rounding is in
 * the value, not in the unit.
 */
export function approxSettlementFor(
  usdCents: number,
  context: RateContext,
): ApproxSettlement {
  const minor = convertUsdCentsToProviderCents(usdCents, context.rate);
  const wholeUnits = Math.round(minor / 100);

  return {
    currency: context.providerCurrency,
    amountMinor: wholeUnits * 100,
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
