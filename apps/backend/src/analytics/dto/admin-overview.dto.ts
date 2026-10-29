/**
 * The admin console's home page in one answer (§243): what is waiting, how the
 * platform is doing, and how big it is.
 *
 * Every figure is counted by the database; nothing here is sampled or
 * estimated. Money is in minor units of `currency` (the ledger's internal
 * currency), except a payout queue's amounts, which are in the currency each
 * payout will actually be sent in.
 */

/** One queue: how much is in it, and since when the oldest has waited. */
export class OverviewQueueDto {
  count!: number;
  /** When the longest-waiting item arrived, or null when the queue is empty. */
  oldestAt!: string | null;
}

export class OverviewAmountDto {
  currency!: string;
  amountMinor!: number;
}

export class OverviewPayoutQueueDto extends OverviewQueueDto {
  /** What the waiting payouts add up to, per settlement currency. */
  amounts!: OverviewAmountDto[];
}

export class OverviewTicketQueueDto extends OverviewQueueDto {
  /** Open or in-progress tickets nobody has taken. */
  unassigned!: number;
}

export class OverviewWaitingDto {
  /** Applications waiting for a decision (§42). */
  businesses!: OverviewQueueDto;
  /** Payout numbers waiting to be checked (§48). */
  destinations!: OverviewQueueDto;
  /** Payouts created and not yet sent (§36). */
  payouts!: OverviewPayoutQueueDto;
  /** New tickets (§24). */
  tickets!: OverviewTicketQueueDto;
}

/** One day on the platform, in its own time zone. Test shops and customers left out (§316). */
export class OverviewDayDto {
  /** YYYY-MM-DD, in `timeZone`. */
  day!: string;
  /** Bookings whose deposit was paid that day. */
  bookings!: number;
  /** Those deposits, added up. */
  depositsMinor!: number;
  /** The platform's fees that day, less any handed back (§25, §316). */
  feesMinor!: number;
  newBusinesses!: number;
  newCustomers!: number;
}

/** Seven days added up. */
export class OverviewPeriodDto {
  bookings!: number;
  depositsMinor!: number;
  feesMinor!: number;
  newBusinesses!: number;
  newCustomers!: number;
}

/** Test shops and test customers left out (§316), as on the statistics page. */
export class OverviewTotalsDto {
  /** Approved and not paused: what customers can find. */
  liveBusinesses!: number;
  /** Open branches of those businesses. */
  liveBranches!: number;
  /** Customer accounts that are not closed. */
  customers!: number;
}

export class AdminOverviewDto {
  asOf!: string;
  timeZone!: string;
  currency!: string;
  waiting!: OverviewWaitingDto;
  /** The last 14 days, oldest first; today is the last. */
  days!: OverviewDayDto[];
  /** The last seven of those days, today included. */
  thisWeek!: OverviewPeriodDto;
  /** The seven before them. */
  lastWeek!: OverviewPeriodDto;
  totals!: OverviewTotalsDto;
}
