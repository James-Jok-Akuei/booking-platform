import { Prisma } from '@prisma/client';
import { instantToZonedParts, zonedWallTimeToInstant } from '../availability/time.util';

/** The smallest and largest sale a shop may run, in whole percent (§186). */
export const MIN_DISCOUNT_PERCENT = 1;
export const MAX_DISCOUNT_PERCENT = 90;

/** The two columns a sale is stored in. `discountEndsOn` is a calendar date. */
export type DiscountColumns = {
  discountPercent: number | null;
  discountEndsOn: Date | null;
};

/**
 * A sale running today: how much off, the last day it runs (YYYY-MM-DD), and
 * the moment it ends — midnight after that day, where the platform is (§283).
 */
export type LiveDiscount = { percent: number; endsOn: string | null; endsAt: string | null };

/** What a customer is shown for a price: what they pay, and the sale if there is one. */
export type Priced = {
  priceMinor: number;
  discount: { percent: number; endsOn: string | null; endsAt: string | null; listPriceMinor: number } | null;
};

/** A calendar date as the YYYY-MM-DD it is stored as (a @db.Date reads back as UTC midnight). */
export const ymd = (date: Date) => date.toISOString().slice(0, 10);

/** Today's date where the platform is, as the UTC midnight a @db.Date compares against. */
export const platformToday = (timeZone: string, now = new Date()) =>
  instantToZonedParts(now, timeZone).date;

/**
 * Whether a sale is on today (§186): a percentage is set, and either it has
 * no end or its last day has not passed. The last day counts in full — a sale
 * "until Sunday" can be booked all of Sunday, in the platform's own time zone.
 */
export function liveDiscount(service: DiscountColumns, today: Date, timeZone: string): LiveDiscount | null {
  const percent = service.discountPercent;
  if (percent === null || percent < MIN_DISCOUNT_PERCENT || percent > MAX_DISCOUNT_PERCENT) {
    return null;
  }
  const last = service.discountEndsOn;
  if (last && last.getTime() < today.getTime()) return null;
  return {
    percent,
    endsOn: last ? ymd(last) : null,
    // The instant the last day is over, so a countdown reaches zero exactly
    // when the price changes back (§283) — not when the customer's own
    // clock thinks the day ends.
    endsAt: last ? zonedWallTimeToInstant(new Date(last.getTime() + 86_400_000), 0, timeZone).toISOString() : null,
  };
}

/**
 * One unit's price after the sale: rounded half up to a whole minor unit, in
 * Decimal arithmetic like every other amount (§40). The discount is taken off
 * ONE, and a booking of three is three of those — so the price on the card
 * times three is exactly what the booking costs.
 */
export function discountedPrice(priceMinor: number, percent: number): number {
  return new Prisma.Decimal(priceMinor)
    .mul(100 - percent)
    .div(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** A branch's price as a customer sees it today. */
export function priceFor(listPriceMinor: number, discount: LiveDiscount | null): Priced {
  if (!discount) return { priceMinor: listPriceMinor, discount: null };
  return {
    priceMinor: discountedPrice(listPriceMinor, discount.percent),
    discount: { percent: discount.percent, endsOn: discount.endsOn, endsAt: discount.endsAt, listPriceMinor },
  };
}
