import { Prisma } from '@prisma/client';

export interface AppointmentAmounts {
  depositAmountMinor: number;
  platformFeeAmountMinor: number;
  businessAmountMinor: number;
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
 *   platformFeeAmountMinor + businessAmountMinor === depositAmountMinor
 *
 * has to hold exactly — it is the ledger line that says who is owed what.
 *
 * All arithmetic is Prisma.Decimal. Percentages are decimal fractions and money
 * is integer minor units; routing either through a JS float is how a ledger acquires
 * drift that only shows up months later.
 */
export function computeAppointmentAmounts(
  priceMinor: number,
  depositPercentage: Prisma.Decimal,
  platformFeePercentage: Prisma.Decimal,
): AppointmentAmounts {
  // Unreachable if ServicesService and PlatformSettingsService are both doing
  // their jobs (§40) — which is exactly why it is here. A negative
  // businessAmountMinor means a business owes money for taking a booking, and
  // it must not be possible to write one whatever route a future change opens.
  //
  // Deliberately NOT clamped to zero. A clamp hides the misconfiguration and
  // silently moves money from the business to the platform; an exception stops
  // the booking and names the numbers. This is a server-side invariant
  // violation, not bad user input, so it throws a plain Error and surfaces as a
  // 500 rather than blaming the caller.
  if (platformFeePercentage.greaterThan(depositPercentage)) {
    throw new Error(
      `Platform fee ${platformFeePercentage.toFixed(2)}% exceeds deposit ` +
        `${depositPercentage.toFixed(2)}%, which would make the business's share ` +
        'negative. Refusing to price this appointment. Fix the service or the ' +
        'platform fee setting.',
    );
  }

  const price = new Prisma.Decimal(priceMinor);
  const hundred = new Prisma.Decimal(100);

  // ROUND_HALF_UP: the conventional expectation for money, and applied to both
  // so neither side is systematically favoured.
  const depositAmountMinor = price
    .mul(depositPercentage)
    .div(hundred)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const platformFeeAmountMinor = price
    .mul(platformFeePercentage)
    .div(hundred)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const businessAmountMinor = depositAmountMinor - platformFeeAmountMinor;

  return { depositAmountMinor, platformFeeAmountMinor, businessAmountMinor };
}
