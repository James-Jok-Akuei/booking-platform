import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * The console's statistics (§316): the whole platform added up — every shop
 * and every customer — for pitching and for seeing how the business is doing.
 *
 * Every figure is counted by the database from the records themselves;
 * nothing is sampled, estimated or converted. Money is in minor units of
 * `currency`, the platform's one unit of account (§315.3). Test shops and test
 * customers (§316) and everything they did are left out unless `includeTest`.
 */

// ---------------------------------------------------------------------------
// What is asked
// ---------------------------------------------------------------------------

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Narrowing the numbers to part of the platform. Every endpoint takes these. */
export class StatisticsScopeQueryDto {
  /** One country's shops (§315). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a two-letter country code.' })
  country?: string;

  /** Shops whose MAIN category this is (§265). */
  @IsOptional()
  @IsUUID()
  category?: string;

  /** Branches in this district. */
  @IsOptional()
  @IsUUID()
  district?: string;

  /** Count test shops and test customers too (§316). Query strings are text. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeTest?: boolean = false;
}

export class StatisticsPeriodQueryDto extends StatisticsScopeQueryDto {
  /** The first day, YYYY-MM-DD, on each shop's own clock. Left out: since the beginning. */
  @IsOptional()
  @Matches(YMD, { message: 'from must be a date, YYYY-MM-DD.' })
  from?: string;

  /** The last day, YYYY-MM-DD, included. Left out: today. */
  @IsOptional()
  @Matches(YMD, { message: 'to must be a date, YYYY-MM-DD.' })
  to?: string;
}

export class StatisticsMonthsQueryDto extends StatisticsScopeQueryDto {
  /** How many months back, this one included. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number = 12;
}

export class MarkTestDto {
  @IsBoolean()
  isTest!: boolean;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Do the bookings and the money book agree (§87, §316)? For the same paid
 * bookings, the deposits and fees each booking recorded against the entries
 * the ledger wrote for them. They must be equal; when they are not, the page
 * says so rather than showing numbers that might be wrong.
 */
export class StatisticsMoneyCheckDto {
  ok!: boolean;
  /** Paid bookings checked. */
  bookings!: number;
  bookingDepositsMinor!: number;
  ledgerDepositsMinor!: number;
  bookingFeesMinor!: number;
  ledgerFeesMinor!: number;
  /** Paid bookings with no "Deposit received" entry at all. */
  missingEntries!: number;
}

export class StatisticsCountDto {
  key!: string;
  count!: number;
}

// ---------------------------------------------------------------------------
// All time
// ---------------------------------------------------------------------------

export class StatisticsRatingDto {
  /** Visible reviews' average, 1–5, to two places; null with none. */
  average!: number | null;
  count!: number;
}

export class StatisticsLeftOutCountDto {
  shops!: number;
  customers!: number;
}

export class StatisticsSummaryDto {
  asOf!: string;
  currency!: string;
  /** The day of the first paid booking, YYYY-MM-DD; null before there is one. */
  since!: string | null;

  /**
   * What the platform has made, all time: platform fees taken, less every fee
   * handed back — when a shop cancelled (§25) or by a fee refund (§53). Before
   * any of our own costs.
   */
  madeMinor!: number;
  /** Paid bookings, all time. */
  bookings!: number;
  /** The full price of those not cancelled — deposit and the rest paid at the shop. */
  bookingValueMinor!: number;
  /** Deposits paid through the app, all time. */
  depositsMinor!: number;

  /** Customer accounts open now — the whole platform. */
  customers!: number;
  /** Customers who have ever paid for a booking. */
  customersWhoBooked!: number;
  /** Of those, how many booked twice or more. */
  cameBack!: number;

  liveShops!: number;
  openBranches!: number;
  /** Districts with at least one open branch of a live shop. */
  areas!: number;
  /** Categories with at least one live shop. */
  categories!: number;
  rating!: StatisticsRatingDto;

  /** Open customer accounts by the language they chose (§308) — the whole platform. */
  languages!: StatisticsCountDto[];
  /** Test shops and customers left out (§316) — counted whether or not they are. */
  leftOut!: StatisticsLeftOutCountDto;
  check!: StatisticsMoneyCheckDto;
}

// ---------------------------------------------------------------------------
// A stretch of time
// ---------------------------------------------------------------------------

/** The figures compared with the stretch before. */
export class StatisticsTotalsDto {
  /** Bookings paid in the stretch, on the day the deposit came in. */
  bookings!: number;
  /** The full price of those not cancelled. */
  bookingValueMinor!: number;
  /** The full price of those already done. */
  doneValueMinor!: number;
  depositsMinor!: number;
  /** Platform fees taken less fees handed back, on the day each was written. */
  feesKeptMinor!: number;
  /** Average full price of a booking not cancelled; null with none. */
  averageBookingMinor!: number | null;
  /** Average deposit; null with none. */
  averageDepositMinor!: number | null;
  /** Customer accounts opened — the whole platform. */
  newCustomers!: number;
  /** Customers who paid for at least one booking. */
  customersBooked!: number;
  /** Shops that posted themselves for customers (§268). */
  shopsWentLive!: number;
}

export class StatisticsBucketDto {
  /** The bucket's first day and last day, YYYY-MM-DD. */
  start!: string;
  end!: string;
  bookings!: number;
  bookingValueMinor!: number;
  depositsMinor!: number;
  feesKeptMinor!: number;
  newCustomers!: number;
  shopsWentLive!: number;
}

export class StatisticsOutcomesDto {
  done!: number;
  missed!: number;
  cancelledByCustomer!: number;
  cancelledByShop!: number;
  /** Called off another way — by our team, say. */
  cancelledOther!: number;
  /** Paid and not happened yet, or happening now. */
  upcoming!: number;
}

export class StatisticsLeadTimeDto {
  sameDay!: number;
  nextDay!: number;
  /** Two to seven days ahead. */
  withinWeek!: number;
  later!: number;
}

export class StatisticsHeatCellDto {
  /** 1 Monday … 7 Sunday, on the shop's clock. */
  weekday!: number;
  /** 0–23, on the shop's clock. */
  hour!: number;
  count!: number;
}

export class StatisticsBookingsDto {
  outcomes!: StatisticsOutcomesDto;
  /** Bookings started in the stretch — paid or not. */
  started!: number;
  /** Of those, how many were paid. */
  startedPaid!: number;
  leadTime!: StatisticsLeadTimeDto;
  /** When booked visits happen: weekday by hour, cancelled ones left out. */
  heat!: StatisticsHeatCellDto[];
  refunds!: number;
  refundsMinor!: number;
  payouts!: number;
  payoutsMinor!: number;
}

export class StatisticsCustomersDto {
  /** Of the customers who booked, those whose first booking ever was in this stretch. */
  firstTime!: number;
  /** Those who had booked before it. */
  returning!: number;
  /** Paid bookings per customer who booked; null with none. */
  bookingsPerCustomer!: number | null;
  /** Of the accounts opened in the stretch, how many have booked since. */
  joinedAndBooked!: number;
  /** Shops followed (§288). */
  follows!: number;
}

export class StatisticsTopShopDto {
  id!: string;
  name!: string | null;
  category!: string | null;
  bookings!: number;
  bookingValueMinor!: number;
  rating!: number | null;
}

export class StatisticsSliceDto {
  /** The category or district; null for shops with none. */
  id!: string | null;
  name!: string;
  bookings!: number;
  bookingValueMinor!: number;
  /** Live shops there now. */
  liveShops!: number;
}

export class StatisticsShopsDto {
  joined!: number;
  /** Sent for review in the stretch (§255) — the last time each one did. */
  applied!: number;
  /** With at least one paid booking in the stretch. */
  withBookings!: number;
  liveNow!: number;
  pausedNow!: number;
  suspendedNow!: number;
  /** For those that went live: the middle number of days from signing up. */
  medianDaysToLive!: number | null;
  topByBookings!: StatisticsTopShopDto[];
  topByValue!: StatisticsTopShopDto[];
  byCategory!: StatisticsSliceDto[];
  byDistrict!: StatisticsSliceDto[];
}

export class StatisticsServiceDto {
  name!: string;
  bookings!: number;
  /** How many shops offer a service by that name and were booked for it. */
  shops!: number;
}

export class StatisticsTermDto {
  term!: string;
  count!: number;
}

export class StatisticsSearchesDto {
  total!: number;
  /** Searches that found nothing — what customers want and we do not have. */
  empty!: number;
  top!: StatisticsTermDto[];
  emptyTop!: StatisticsTermDto[];
}

export class StatisticsWantsDto {
  topServices!: StatisticsServiceDto[];
  searches!: StatisticsSearchesDto;
  reviews!: StatisticsRatingDto;
}

export class StatisticsPeriodDto {
  asOf!: string;
  currency!: string;
  from!: string;
  to!: string;
  days!: number;
  /** How the chart is cut: by day up to three months, by week up to two years, then by month. */
  bucket!: 'day' | 'week' | 'month';
  /** Whether `previous` is the stretch of the same length just before; false for "since the beginning". */
  compared!: boolean;
  totals!: StatisticsTotalsDto;
  previous!: StatisticsTotalsDto | null;
  series!: StatisticsBucketDto[];
  /**
   * The stretch before, cut the same way, for the chart's faint bars: bar i
   * of each is the same place in its stretch. Null when nothing is compared.
   */
  previousSeries!: StatisticsBucketDto[] | null;
  bookings!: StatisticsBookingsDto;
  customers!: StatisticsCustomersDto;
  shops!: StatisticsShopsDto;
  wants!: StatisticsWantsDto;
  check!: StatisticsMoneyCheckDto;
}

// ---------------------------------------------------------------------------
// Month by month
// ---------------------------------------------------------------------------

export class StatisticsMonthDto {
  /** YYYY-MM. */
  month!: string;
  bookings!: number;
  bookingValueMinor!: number;
  depositsMinor!: number;
  feesKeptMinor!: number;
  newCustomers!: number;
  shopsWentLive!: number;
  /** Customers who paid for at least one booking that month. */
  activeCustomers!: number;
}

/** Customers whose first booking was in `month`, and how many booked again each month after. */
export class StatisticsCohortDto {
  month!: string;
  customers!: number;
  /** `back[0]` is one month later, `back[1]` two, up to this month. */
  back!: number[];
}

export class StatisticsMonthsDto {
  asOf!: string;
  currency!: string;
  months!: StatisticsMonthDto[];
  cohorts!: StatisticsCohortDto[];
}

// ---------------------------------------------------------------------------
// Left out
// ---------------------------------------------------------------------------

export class LeftOutShopDto {
  id!: string;
  name!: string | null;
  markedAt!: string | null;
  /** An administrator's email, or "automatic". */
  markedBy!: string | null;
}

export class LeftOutCustomerDto {
  id!: string;
  email!: string;
  displayName!: string | null;
  markedAt!: string | null;
  markedBy!: string | null;
}

export class StatisticsLeftOutDto {
  shops!: LeftOutShopDto[];
  customers!: LeftOutCustomerDto[];
}

export class TestMarkDto {
  id!: string;
  isTest!: boolean;
  markedAt!: string | null;
  markedBy!: string | null;
}

