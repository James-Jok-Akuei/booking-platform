import { Prisma } from '@prisma/client';

/**
 * The settlement split of a confirmed deposit (§45.2).
 *
 * The fee is a PROPORTION OF THE AMOUNT ACTUALLY CHARGED, never
 * `platformFeePercentage` applied to something converted independently. The fee
 * percentage applies to the service price, which was never denominated in the
 * provider's currency — converting it separately would drift from the money the
 * provider really collected, and the ledger would then disagree with the
 * provider's statement by a few units on every booking.
 *
 *     fee = round(charged × platformFeeAmountCents / depositAmountCents)
 *
 * Rounded ONCE, on the fee. The business's share is the REMAINDER, never its own
 * rounded percentage — exactly the reasoning behind `businessAmountCents` being
 * computed by subtraction in USD (§16.3). Rounding both independently would let
 * them disagree by a unit, and the invariant
 *
 *     DEPOSIT_RECEIVED + PLATFORM_FEE === the business's share
 *
 * has to hold exactly in BOTH currencies.
 *
 * The deposit >= fee rule (§40) guarantees the proportion is between 0 and 1
 * inclusive. At deposit == fee it is exactly 1, the fee takes the whole charged
 * amount, and the business's settlement share is exactly zero.
 */
export function splitSettlement(params: {
  chargedMinor: number;
  depositAmountCents: number;
  platformFeeAmountCents: number;
}): { depositMinor: number; feeMinor: number; businessMinor: number } {
  const { chargedMinor, depositAmountCents, platformFeeAmountCents } = params;

  if (depositAmountCents <= 0) {
    // Nothing was charged, so there is nothing to apportion. Dividing by it
    // would be a silent NaN travelling into a payout.
    return { depositMinor: chargedMinor, feeMinor: 0, businessMinor: chargedMinor };
  }

  const feeMinor = new Prisma.Decimal(chargedMinor)
    .mul(platformFeeAmountCents)
    .div(depositAmountCents)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  return {
    depositMinor: chargedMinor,
    feeMinor,
    businessMinor: chargedMinor - feeMinor,
  };
}
