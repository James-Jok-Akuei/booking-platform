import { Prisma } from '@prisma/client';

/**
 * The platform's internal unit of account.
 *
 * Every price, deposit and fee is computed and stored in USD cents regardless
 * of what currency actually changes hands. See DECISIONS.md for why — briefly,
 * South Sudan's SSP has run at roughly 97% annual inflation, so pricing
 * services natively in it would mean businesses repricing their entire
 * catalogue every few weeks.
 */
export const INTERNAL_CURRENCY = 'USD';

/**
 * Converts an internal USD amount into the provider's currency.
 *
 * `rate` is how many units of the provider's currency one USD buys, so the
 * conversion is a plain multiplication. Both sides are minor units (cents), and
 * because the rate applies equally to major and minor units there is no need to
 * scale in and out of major units on the way through.
 *
 * Prisma.Decimal throughout, and ROUND_HALF_UP at the single point of rounding:
 * this is the number a customer is actually charged, so it gets the same
 * treatment as every other money calculation in the codebase.
 *
 * ASSUMPTION worth stating: both currencies use two decimal places. True for
 * USD, EUR and SSP. A zero-decimal currency (JPY, KRW) or a three-decimal one
 * (KWD, BHD) would need the minor-unit exponent taken into account, and that is
 * not modelled — there is nowhere to record an exponent per currency yet.
 */
export function convertUsdCentsToProviderCents(
  usdCents: number,
  rate: Prisma.Decimal,
): number {
  return new Prisma.Decimal(usdCents)
    .mul(rate)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}
