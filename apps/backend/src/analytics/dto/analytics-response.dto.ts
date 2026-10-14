import { AppointmentStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * What a business is told about itself (§128.36).
 *
 * Every rate and average in here is NULL rather than 0 on an empty period. "No
 * appointments" and "0% completed" are different claims, and a dashboard that
 * conflates them tells a new business it is failing (§28.5).
 *
 * Every total that can be incomplete says so in a `complete` flag AND a `note`.
 * A partial figure that does not announce itself is the number a business acts
 * on once and then stops trusting.
 */
export class AnalyticsRangeDto {
  from!: string;
  to!: string;
  days!: number;
}

export class AppointmentAnalyticsDto {
  total!: number;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  byStatus!: Record<AppointmentStatus, number>;

  /** Null on an empty period, never 0. */
  completionRate!: number | null;
  cancellationRate!: number | null;
  noShowRate!: number | null;
}

export class CollectedThroughPlatformDto {
  depositsMinor!: number;
  /** What the business actually received of those deposits, after the fee. */
  businessShareOfDepositsMinor!: number;
  appointmentCount!: number;

  /**
   * Cancellations from before payment state was recorded, whose deposits may or
   * may not have been taken. Counted rather than guessed at.
   */
  cancelledWithUnknownPaymentState!: number;
  /** False when the figure above is non-zero. Branch on this, not on the note. */
  complete!: boolean;
  note!: string;
}

/**
 * What the customer still owes the business directly.
 *
 * The platform never sees this money and cannot confirm it was paid, which is
 * what the note says. Appointments booked before pricing was snapshotted are
 * excluded, because their original price is not recoverable.
 */
export class BalanceOwedDto {
  amountMinor!: number;
  fromAppointments!: number;
  appointmentsMissingSnapshot!: number;
  complete!: boolean;
  note!: string;
}

export class MoneyAnalyticsDto {
  /** The unit of account every figure here is in (§96). Never hardcoded. */
  currency!: string;
  collectedThroughPlatform!: CollectedThroughPlatformDto;
  platformFeesPaidMinor!: number;
  balanceOwedToBusiness!: BalanceOwedDto;
}

export class ReviewAnalyticsDto {
  count!: number;
  /** Null when nothing has been reviewed. Two decimal places otherwise. */
  averageRating!: number | null;
}

export class BusiestDayDto {
  /** 0 = Sunday, matching `LocationHours.dayOfWeek` (§10.4). */
  day!: number;
  appointments!: number;
}

export class BusiestHourDto {
  hour!: number;
  appointments!: number;
}

/** Both null when there is nothing in the period to find a peak in. */
export class BusiestPeriodsDto {
  dayOfWeek!: BusiestDayDto | null;
  hour!: BusiestHourDto | null;
  /** The zone the day and hour are expressed in (§103). */
  timeZone!: string;
}

export class BusinessAnalyticsDto {
  businessId!: string;
  /** Null when the figures cover the whole business rather than one branch. */
  locationId!: string | null;
  scope!: 'BUSINESS' | 'LOCATION';
  /**
   * The branches counted when the caller looks after only some (§277) and
   * asked for no one branch: the figures are for those branches together.
   * Null for one branch or the whole business.
   */
  locationIds!: string[] | null;
  range!: AnalyticsRangeDto;

  appointments!: AppointmentAnalyticsDto;
  money!: MoneyAnalyticsDto;
  reviews!: ReviewAnalyticsDto;
  busiest!: BusiestPeriodsDto;
}
