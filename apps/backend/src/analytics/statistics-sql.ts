import { Prisma } from '@prisma/client';

/**
 * The pieces every statistic is counted with (§316), in one place, so two
 * numbers on the page can never mean different things by the same word.
 */

/** Part of the platform, and whether test accounts are counted (§316). */
export type StatisticsScope = {
  country?: string;
  category?: string;
  district?: string;
  includeTest: boolean;
};

const DAY = 86_400_000;

/** "2026-10-09" moved by some days — calendar arithmetic, no clock. */
export const shiftDay = (ymd: string, by: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

/** "2026-10" moved by some months. */
export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

/** How many days from `from` to `to`, both counted. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.UTC(...ymdParts(to)) - Date.UTC(...ymdParts(from))) / DAY) + 1;

const ymdParts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m - 1, d];
};

/** The Monday of the week a day is in. */
export const mondayOf = (ymd: string) => {
  const weekday = new Date(Date.UTC(...ymdParts(ymd))).getUTCDay(); // 0 Sunday
  return shiftDay(ymd, -((weekday + 6) % 7));
};

/**
 * The instants that surely hold every moment of these days, on any clock: a
 * day either side covers every zone's offset. It lets an index narrow the rows
 * before each one's own day is worked out on its own clock.
 */
export const roughly = (from: string, to: string) => ({
  lo: new Date(Date.UTC(...ymdParts(from)) - DAY),
  hi: new Date(Date.UTC(...ymdParts(to)) + 2 * DAY),
});

/** A moment's day on the clock of its row's shop (`c`, its country). */
export const shopDay = (column: string) => Prisma.raw(`((${column}) AT TIME ZONE 'UTC' AT TIME ZONE c."timeZone")::date`);

/** A moment's day on one given clock — for what belongs to no shop, like a sign-up. */
export const dayOn = (column: string, zone: string) =>
  Prisma.sql`((${Prisma.raw(column)}) AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date`;

/** Rows whose `column` falls on these days of their shop's clock. */
export const onShopDays = (column: string, from: string, to: string) => {
  const { lo, hi } = roughly(from, to);
  return Prisma.sql`AND ${Prisma.raw(column)} >= ${lo} AND ${Prisma.raw(column)} < ${hi}
    AND ${shopDay(column)} BETWEEN ${from}::date AND ${to}::date`;
};

/** Rows whose `column` falls on these days of one clock. */
export const onDays = (column: string, zone: string, from: string, to: string) => {
  const { lo, hi } = roughly(from, to);
  return Prisma.sql`AND ${Prisma.raw(column)} >= ${lo} AND ${Prisma.raw(column)} < ${hi}
    AND ${dayOn(column, zone)} BETWEEN ${from}::date AND ${to}::date`;
};

/**
 * Every booking, with its branch `l`, shop `b`, the shop's country `c` and
 * its customer `u`.
 */
export const BOOKINGS = Prisma.sql`
  FROM "appointments" a
  JOIN "locations" l ON l."id" = a."locationId"
  JOIN "business_profiles" b ON b."id" = l."businessId"
  JOIN "countries" c ON c."code" = b."countryCode"
  JOIN "users" u ON u."id" = a."customerId"`;

/** A booking is real once its deposit is paid; an unpaid hold that lapses never counts. */
export const PAID = Prisma.sql`AND a."depositPaidAt" IS NOT NULL`;

/** What a shop has to be for customers to find it (`PUBLIC_BUSINESS`, §268). */
export const LIVE = Prisma.sql`AND b."status" = 'APPROVED' AND b."publishedAt" IS NOT NULL AND b."pausedAt" IS NULL`;

/**
 * Platform fees kept: every fee taken (negative, from the shop's side of the
 * ledger, §34) and every fee handed back — automatically when a shop cancelled
 * (§25), or by an executed fee refund (§53). Summed and turned round, what the
 * platform kept. With the shop `b`, its country `c`, and — when the entry came
 * from a booking — the booking `a`, its branch `l` and customer `u`.
 */
export const FEES = Prisma.sql`
  FROM "ledger_entries" e
  JOIN "business_profiles" b ON b."id" = e."businessId"
  JOIN "countries" c ON c."code" = b."countryCode"
  LEFT JOIN "appointments" a ON a."id" = e."appointmentId"
  LEFT JOIN "locations" l ON l."id" = a."locationId"
  LEFT JOIN "users" u ON u."id" = a."customerId"
  LEFT JOIN "billing_adjustments" ba ON ba."id" = e."billingAdjustmentId"
  WHERE (e."type" IN ('PLATFORM_FEE', 'PLATFORM_FEE_REVERSAL') OR (e."type" = 'ADJUSTMENT' AND ba."type" = 'FEE_REFUND'))`;

export const FEES_KEPT = Prisma.sql`(-COALESCE(SUM(e."amountMinor"), 0))::bigint`;

/**
 * The scope, on a row with a shop `b`, its customer `u` (perhaps none) and its
 * branch `l` (perhaps none — then a district leaves it out).
 */
export const bookingScope = (s: StatisticsScope) => Prisma.sql`
  ${s.includeTest ? Prisma.empty : Prisma.sql`AND NOT b."isTest" AND NOT COALESCE(u."isTest", false)`}
  ${s.country ? Prisma.sql`AND b."countryCode" = ${s.country}` : Prisma.empty}
  ${s.category ? Prisma.sql`AND b."categoryId" = ${s.category}` : Prisma.empty}
  ${s.district ? Prisma.sql`AND l."districtId" = ${s.district}` : Prisma.empty}`;

/** The scope, on a shop `b`: in a district when one of its open branches is. */
export const shopScope = (s: StatisticsScope) => Prisma.sql`
  ${s.includeTest ? Prisma.empty : Prisma.sql`AND NOT b."isTest"`}
  ${s.country ? Prisma.sql`AND b."countryCode" = ${s.country}` : Prisma.empty}
  ${s.category ? Prisma.sql`AND b."categoryId" = ${s.category}` : Prisma.empty}
  ${
    s.district
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "locations" dl WHERE dl."businessId" = b."id" AND dl."districtId" = ${s.district} AND dl."isActive")`
      : Prisma.empty
  }`;

/** The scope, on an open branch `l` of a shop `b`. */
export const branchScope = (s: StatisticsScope) => Prisma.sql`
  ${s.includeTest ? Prisma.empty : Prisma.sql`AND NOT b."isTest"`}
  ${s.country ? Prisma.sql`AND b."countryCode" = ${s.country}` : Prisma.empty}
  ${s.category ? Prisma.sql`AND b."categoryId" = ${s.category}` : Prisma.empty}
  ${s.district ? Prisma.sql`AND l."districtId" = ${s.district}` : Prisma.empty}`;

/** A customer `u` who is not a test account, unless test accounts are counted. */
export const customerScope = (s: StatisticsScope) =>
  s.includeTest ? Prisma.empty : Prisma.sql`AND NOT u."isTest"`;

/** A database count or sum, as a number. Money in RWF stays far below 2^53. */
export const num = (value: bigint | number | string | null | undefined) => Number(value ?? 0);
