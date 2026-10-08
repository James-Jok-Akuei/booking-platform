import type { Appointment, AppointmentStatus, Location, ScheduleException, TimeBlock } from '../../api/business';
import { addDays, startOfDay } from '../../lib/time';

/*
 * The calendar's sums (§229), kept apart from how it is drawn: a day's open
 * hours at a branch, its breaks and closures, which bookings overlap, where
 * the free time is, and how full the time shown is.
 *
 * The rules are the server's (availability.service): a booking holds one
 * place per person while it is unpaid, expected, with you or done; a break
 * shuts the whole branch; a closure replaces the day's hours.
 */

export type CalView = 'day' | 'week' | 'month';

/** Statuses that take a place at the branch — availability's CAPACITY_CONSUMING_STATUSES. */
export const HOLDS_A_PLACE: AppointmentStatus[] = ['PENDING_PAYMENT', 'BOOKED', 'IN_PROGRESS', 'COMPLETED'];

export const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dateOf = (ymd: string) => new Date(`${ymd}T12:00:00`);
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Monday of the week a day is in. */
export const weekStart = (d: Date) => {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
};
export const monthGridStart = (d: Date) => weekStart(new Date(d.getFullYear(), d.getMonth(), 1));

/** The days a view shows, and the instants to fetch bookings between. */
export function rangeOf(view: CalView, anchor: Date) {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), days: [from] };
  }
  const from = view === 'week' ? weekStart(anchor) : monthGridStart(anchor);
  const count = view === 'week' ? 7 : 42;
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, count), days };
}

export type Interval = { start: number; end: number };
export type BreakInterval = Interval & { reason: string | null };

/** One branch on one day: when it is open, its breaks, and why it differs. */
export type DayPlan = {
  open: Interval[];
  breaks: BreakInterval[];
  /** Closed all day, and why: "Closed — Public holiday", "Usually closed". */
  closed: string | null;
  /** Open, but not at the usual hours (a closure with custom hours). */
  special: string | null;
};

export function planFor(location: Location, day: Date, exceptions: ScheduleException[], blocks: TimeBlock[]): DayPlan {
  const ymd = ymdOf(day);
  const breaks = blocks
    .filter((b) => b.date.slice(0, 10) === ymd)
    .map((b) => ({ start: minutesOf(b.startTime), end: minutesOf(b.endTime), reason: b.reason }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const exception = exceptions.find((e) => e.date.slice(0, 10) === ymd);
  if (exception) {
    if (exception.isClosed) return { open: [], breaks, closed: exception.reason ? `Closed — ${exception.reason}` : 'Closed', special: null };
    if (exception.customOpenTime && exception.customCloseTime) {
      return {
        open: [{ start: minutesOf(exception.customOpenTime), end: minutesOf(exception.customCloseTime) }],
        breaks,
        closed: null,
        special: exception.reason ? `Special hours — ${exception.reason}` : 'Special hours',
      };
    }
  }
  const hours = location.hours.find((h) => h.dayOfWeek === day.getDay());
  // A day with no saved hours is shut too (§12.4).
  if (!hours || hours.isClosed) return { open: [], breaks, closed: 'Usually closed', special: null };
  return { open: [{ start: minutesOf(hours.openTime), end: minutesOf(hours.closeTime) }], breaks, closed: null, special: null };
}

/** Several branches as one: open when any is open; breaks are per branch, so none. */
export function mergePlans(plans: DayPlan[]): DayPlan {
  if (plans.length === 1) return plans[0];
  const all = plans.flatMap((p) => p.open).sort((a, b) => a.start - b.start);
  const open: Interval[] = [];
  for (const i of all) {
    const last = open[open.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else open.push({ ...i });
  }
  return { open, breaks: [], closed: open.length ? null : 'Closed', special: null };
}

/** Where a booking sits on its day, in minutes from midnight, clamped to the day. */
export function spanOf(a: Appointment, day: Date): Interval | null {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(0, (new Date(a.startTime).getTime() - dayStart) / 60_000);
  const end = Math.min(1440, (new Date(a.endTime).getTime() - dayStart) / 60_000);
  return end > start ? { start: Math.round(start), end: Math.round(end) } : null;
}

/** Bookings that touch one another in time, drawn together as a pile (§229). */
export type Cluster = Interval & { items: Appointment[] };

export function clusters(bookings: Appointment[], day: Date): Cluster[] {
  const placed = bookings
    .map((a) => ({ a, span: spanOf(a, day) }))
    .filter((x): x is { a: Appointment; span: Interval } => x.span !== null)
    .sort((x, y) => x.span.start - y.span.start || y.span.end - x.span.end);
  const out: Cluster[] = [];
  for (const { a, span } of placed) {
    const last = out[out.length - 1];
    if (last && span.start < last.end) {
      last.items.push(a);
      last.end = Math.max(last.end, span.end);
    } else out.push({ start: span.start, end: span.end, items: [a] });
  }
  return out;
}

/** Places taken minute by minute at one branch on one day. */
export function placesTaken(bookings: Appointment[], day: Date) {
  const used = new Int16Array(1440);
  for (const a of bookings) {
    if (!HOLDS_A_PLACE.includes(a.status)) continue;
    const span = spanOf(a, day);
    if (!span) continue;
    const units = Math.max(1, a.quantity);
    for (let m = span.start; m < span.end; m++) used[m] += units;
  }
  return used;
}

/** Most places taken at once between two minutes. */
export const peak = (used: Int16Array, from: number, to: number) => {
  let most = 0;
  for (let m = Math.max(0, from); m < Math.min(1440, to); m++) if (used[m] > most) most = used[m];
  return most;
};

/**
 * The stretches of a day where nothing is booked and the branch is open —
 * from now on, on the 15-minute grid customers book on, at least 30 minutes
 * long. A partly-full time is not "free"; its pile says how many places are left.
 */
export function freeWindows(plan: DayPlan, used: Int16Array, day: Date, now: Date): Interval[] {
  const today = startOfDay(now).getTime();
  const dayStart = startOfDay(day).getTime();
  if (dayStart < today) return [];
  const from = dayStart === today ? Math.ceil(minuteOfDay(now) / 15) * 15 : 0;
  const out: Interval[] = [];
  for (const open of plan.open) {
    let runStart: number | null = null;
    const end = open.end;
    for (let m = Math.max(open.start, from); m <= end; m++) {
      const blocked = m === end || used[m] > 0 || plan.breaks.some((b) => m >= b.start && m < b.end);
      if (!blocked && runStart === null) runStart = m;
      if (blocked && runStart !== null) {
        if (m - runStart >= 30) out.push({ start: runStart, end: m });
        runStart = null;
      }
    }
  }
  return out;
}

/** How full the time shown is: place-minutes booked against place-minutes open. */
export function fullness(
  scope: Location[],
  days: Date[],
  plans: (location: Location, day: Date) => DayPlan,
  bookings: Appointment[],
) {
  let open = 0;
  let booked = 0;
  for (const location of scope) {
    for (const day of days) {
      const plan = plans(location, day);
      const minutes = plan.open.reduce((sum, i) => sum + (i.end - i.start), 0) - plan.breaks.reduce((sum, b) => sum + (b.end - b.start), 0);
      open += Math.max(0, minutes) * Math.max(1, location.capacity);
      for (const a of bookings) {
        if (a.location.id !== location.id || !HOLDS_A_PLACE.includes(a.status)) continue;
        const span = spanOf(a, day);
        if (span) booked += (span.end - span.start) * Math.max(1, a.quantity);
      }
    }
  }
  return { openHours: open / 60, bookedHours: booked / 60, share: open ? Math.min(1, booked / open) : 0 };
}
