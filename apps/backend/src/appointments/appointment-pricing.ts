import { Prisma } from '@prisma/client';

export interface AppointmentAmounts {
  depositAmountCents: number;
  platformFeeAmountCents: number;
  businessAmountCents: number;
}

/**
 * Splits a service price into the three amounts stored on an appointment.
 *
 * Both percentages apply to the **service price**, not to each other:
 *
 *   deposit    = round(price x depositPercentage / 100)
 *   platformFee= round(price x platformFeePercentage / 100)
 *   business   = deposit - platformFee
 *
 * Sharing a base is what makes the "deposit% >= fee%" rule meaningful — it is
 * precisely the condition under which the fee fits inside the deposit. At the
 * floor the two are equal and the business receives nothing from the deposit,
 * collecting its entire take as the balance owed offline. This preserves the
 * mechanics of DECISIONS.md §2 (fee comes out of the deposit first, remainder
 * to the business) with a percentage fee in place of a flat one.
 *
 * `business` is computed by SUBTRACTION rather than by its own rounded
 * percentage. Rounding each of the three independently would let them disagree
 * by a cent, and the invariant
 *
 *   platformFeeAmountCents + businessAmountCents === depositAmountCents
 *
 * has to hold exactly — it is the ledger line that says who is owed what.
 *
 * All arithmetic is Prisma.Decimal. Percentages are decimal fractions and money
 * is integer cents; routing either through a JS float is how a ledger acquires
 * drift that only shows up months later.
 */
export function computeAppointmentAmounts(
  priceCents: number,
  depositPercentage: Prisma.Decimal,
  platformFeePercentage: Prisma.Decimal,
): AppointmentAmounts {
  const price = new Prisma.Decimal(priceCents);
  const hundred = new Prisma.Decimal(100);

  // ROUND_HALF_UP: the conventional expectation for money, and applied to both
  // so neither side is systematically favoured.
  const depositAmountCents = price
    .mul(depositPercentage)
    .div(hundred)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const platformFeeAmountCents = price
    .mul(platformFeePercentage)
    .div(hundred)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const businessAmountCents = depositAmountCents - platformFeeAmountCents;

  return { depositAmountCents, platformFeeAmountCents, businessAmountCents };
}
