import type { AvailabilitySource } from '../availability.service';

/**
 * Bookable start times for one location on one date (§103).
 *
 * `date`, `openTime`, `closeTime` and every entry in `slots` are WALL-CLOCK
 * strings in `timeZone`, not instants: "09:00" in Kigali. A booking resolves
 * them against the same zone, so nothing in this response needs an offset and
 * nothing may be parsed as UTC.
 */
export class AvailabilityDto {
  locationId!: string;
  /** A calendar day, `YYYY-MM-DD`. Not an instant. */
  date!: string;
  /** 0 = Sunday, matching JavaScript rather than ISO (§12). */
  dayOfWeek!: number;
  /** The zone every time here is expressed in. */
  timeZone!: string;

  durationMinutes!: number;
  /** Concurrent appointments this branch can run; a slot survives until this many overlap. */
  capacity!: number;

  /**
   * WHY the answer is what it is — which of the weekly template, a date-specific
   * exception, or the absence of either decided it.
   *
   * Published so a screen can say "closed for a public holiday" rather than
   * showing an empty list that reads as a bug.
   */
  source!: AvailabilitySource;

  /** Both null when closed. Both set otherwise — never one without the other. */
  openTime!: string | null;
  closeTime!: string | null;

  /** The words to show when closed, when there are any. */
  reason!: string | null;

  /** `HH:mm` start times. Empty when closed or fully booked. */
  slots!: string[];
}

/**
 * One date that does not follow the weekly template (§102).
 *
 * `isClosed` true means shut that day. Otherwise `customOpenTime` and
 * `customCloseTime` are both set and replace the template's hours. Both null
 * with `isClosed` false cannot occur — the database refuses it.
 */
export class ScheduleExceptionDto {
  id!: string;
  locationId!: string;
  /** A calendar day, `YYYY-MM-DD`. */
  date!: string;
  isClosed!: boolean;
  customOpenTime!: string | null;
  customCloseTime!: string | null;
  /** e.g. "Public holiday", "Staff training". */
  reason!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

/** A single stretch of one day taken out of the diary — a lunch break, a meeting. */
export class TimeBlockDto {
  id!: string;
  locationId!: string;
  /** A calendar day, `YYYY-MM-DD`. */
  date!: string;
  /** `HH:mm`, wall clock, same zone as availability. */
  startTime!: string;
  endTime!: string;
  reason!: string | null;
  createdAt!: string;
}
