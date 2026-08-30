/**
 * Time helpers for availability computation.
 *
 * Two different kinds of time meet in this module and must not be confused:
 *
 * - **Wall-clock local time** — LocationHours, schedule exceptions and time
 *   blocks. "We open at 08:30" is a recurring rule in the location's own
 *   timezone, not an instant.
 * - **Absolute instants** — Appointment.startTime/endTime, and "now". A booking
 *   happens at one real moment worldwide.
 *
 * All slot arithmetic is done in the first space (minutes since local midnight)
 * because that is what the business actually configured. Instants are converted
 * into that space exactly once, at the point they are subtracted.
 */

/** Appointment start times land on :00, :15, :30, :45 — nothing else. */
export const SLOT_GRID_MINUTES = 15;

export const MINUTES_PER_DAY = 24 * 60;

/** "HH:mm" -> minutes since midnight. Returns null if malformed. */
export function parseHhMm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** minutes since midnight -> "HH:mm". */
export function formatHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * "YYYY-MM-DD" -> a Date at UTC midnight.
 *
 * UTC midnight is the storage convention for a `@db.Date` column: it carries no
 * time and no offset, so it must never be built with `new Date(string)` in a
 * local-time context where the day could shift.
 */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  // Rejects 2026-02-30 and friends, which Date.UTC would silently roll over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** A UTC-midnight Date -> "YYYY-MM-DD". */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, matching LocationHours.dayOfWeek. */
export function dayOfWeekUtc(date: Date): number {
  return date.getUTCDay();
}

/**
 * How far ahead of UTC `timeZone` is at instant `ts`, in milliseconds.
 *
 * Derived by formatting the instant in the target zone and reading the parts
 * back as though they were UTC; the difference is the offset. Uses the platform
 * tz database via Intl, so it stays correct across DST rules and historical
 * offset changes without shipping our own table.
 */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Intl renders midnight as hour 24 in some ICU versions; normalise it.
  const hour = get('hour') % 24;

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUtc - ts;
}

/**
 * Local wall-clock time on a calendar date -> the absolute instant it refers to.
 *
 * Two passes: guess using the offset at the naive timestamp, then re-read the
 * offset at the corrected instant. That second pass is what makes the result
 * correct across a DST boundary, where the offset before and after the guess
 * differ. Africa/Juba has no DST today, but this must not quietly break the day
 * the platform opens somewhere that does.
 */
export function zonedWallTimeToInstant(
  calendarDate: Date,
  minutesSinceMidnight: number,
  timeZone: string,
): Date {
  const naive =
    Date.UTC(
      calendarDate.getUTCFullYear(),
      calendarDate.getUTCMonth(),
      calendarDate.getUTCDate(),
    ) +
    minutesSinceMidnight * 60_000;

  const firstOffset = zoneOffsetMs(naive, timeZone);
  let instant = naive - firstOffset;

  const secondOffset = zoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) {
    instant = naive - secondOffset;
  }

  return new Date(instant);
}

/** A half-open interval [start, end) in minutes since local midnight. */
export interface MinuteInterval {
  start: number;
  end: number;
}

/**
 * True when two half-open intervals share any time at all.
 *
 * Half-open is the whole point: an appointment ending at 14:00 and one starting
 * at 14:00 do NOT overlap, so a slot can begin the moment the previous one
 * ends. That is what "no buffer time" means in practice.
 */
export function overlaps(a: MinuteInterval, b: MinuteInterval): boolean {
  return a.start < b.end && a.end > b.start;
}

/** Rounds up to the next 15-minute grid boundary (a no-op if already on one). */
export function alignUpToGrid(minutes: number): number {
  return Math.ceil(minutes / SLOT_GRID_MINUTES) * SLOT_GRID_MINUTES;
}

/**
 * Splits an absolute instant into the calendar date and minutes-since-midnight
 * it corresponds to in `timeZone`.
 *
 * The inverse of zonedWallTimeToInstant, and the bridge booking needs: a client
 * sends an ISO instant, while every availability rule is expressed in local
 * wall-clock terms.
 */
export function instantToZonedParts(
  instant: Date,
  timeZone: string,
): { date: Date; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Intl renders midnight as hour 24 in some ICU versions; normalise it.
  const hour = get('hour') % 24;

  return {
    date: new Date(Date.UTC(get('year'), get('month') - 1, get('day'))),
    minutesSinceMidnight: hour * 60 + get('minute'),
  };
}
