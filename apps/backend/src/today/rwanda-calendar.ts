/**
 * Rwanda's calendar for shops (§310): the days that change how a shop opens
 * or how busy it is — public holidays, Umuganda, Kwibuka. Pure functions on
 * calendar dates ("YYYY-MM-DD", Kigali), so they are tested without a clock.
 *
 * Public holidays as the presidential order lists them: New Year (1 and 2
 * January), Heroes' Day (1 February), the Genocide against the Tutsi Memorial
 * Day (7 April), Good Friday and Easter Monday, Labour Day (1 May),
 * Independence Day (1 July), Liberation Day (4 July), Umuganura (the first
 * Friday of August), Assumption (15 August), Christmas and Boxing Day — and
 * Eid al-Fitr and Eid al-Adha, whose dates follow the moon and are confirmed
 * by the government each year: the table below holds the expected ones, to
 * be corrected when announced.
 */

export type HolidayKey =
  | 'new-year'
  | 'new-year-2'
  | 'heroes'
  | 'memorial'
  | 'good-friday'
  | 'easter-monday'
  | 'labour'
  | 'independence'
  | 'liberation'
  | 'umuganura'
  | 'assumption'
  | 'christmas'
  | 'boxing'
  | 'eid-al-fitr'
  | 'eid-al-adha';

export type Holiday = { date: string; key: HolidayKey };

/** Expected dates; the government confirms each when the moon is seen. */
const EID: Record<number, { fitr: string; adha: string }> = {
  2026: { fitr: '2026-03-20', adha: '2026-05-27' },
  2027: { fitr: '2027-03-10', adha: '2027-05-17' },
  2028: { fitr: '2028-02-27', adha: '2028-05-05' },
  2029: { fitr: '2029-02-15', adha: '2029-04-24' },
  2030: { fitr: '2030-02-05', adha: '2030-04-14' },
};

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fromYmd = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toYmd = (at: Date) => ymd(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
export const addDays = (date: string, days: number) => {
  const at = fromYmd(date);
  at.setUTCDate(at.getUTCDate() + days);
  return toYmd(at);
};
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => fromYmd(date).getUTCDay();

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** The first `weekdayWanted` (0–6) of a month. */
function firstWeekday(year: number, month: number, weekdayWanted: number): string {
  let date = ymd(year, month, 1);
  while (weekday(date) !== weekdayWanted) date = addDays(date, 1);
  return date;
}

export function holidays(year: number): Holiday[] {
  const sunday = easter(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), key: 'new-year' },
    { date: ymd(year, 1, 2), key: 'new-year-2' },
    { date: ymd(year, 2, 1), key: 'heroes' },
    { date: ymd(year, 4, 7), key: 'memorial' },
    { date: addDays(sunday, -2), key: 'good-friday' },
    { date: addDays(sunday, 1), key: 'easter-monday' },
    { date: ymd(year, 5, 1), key: 'labour' },
    { date: ymd(year, 7, 1), key: 'independence' },
    { date: ymd(year, 7, 4), key: 'liberation' },
    { date: firstWeekday(year, 8, 5), key: 'umuganura' },
    { date: ymd(year, 8, 15), key: 'assumption' },
    { date: ymd(year, 12, 25), key: 'christmas' },
    { date: ymd(year, 12, 26), key: 'boxing' },
  ];
  const eid = EID[year];
  if (eid) list.push({ date: eid.fitr, key: 'eid-al-fitr' }, { date: eid.adha, key: 'eid-al-adha' });
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

export const holidayOn = (date: string): Holiday | null =>
  holidays(Number(date.slice(0, 4))).find((h) => h.date === date) ?? null;

/** The next public holiday from `date` (that day included), within `withinDays`. */
export function nextHoliday(date: string, withinDays: number): Holiday | null {
  const until = addDays(date, withinDays);
  const year = Number(date.slice(0, 4));
  return [...holidays(year), ...holidays(year + 1)].find((h) => h.date >= date && h.date <= until) ?? null;
}

/**
 * Umuganda: the community work of the last Saturday of every month, 08:00 to
 * 11:00, when shops stay closed until it ends.
 */
export const UMUGANDA_HOURS = { from: '08:00', to: '11:00' } as const;

export function umugandaIn(year: number, month: number): string {
  // The last day of the month, back to its Saturday.
  let date = addDays(ymd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  while (weekday(date) !== 6) date = addDays(date, -1);
  return date;
}

/** This month's Umuganda if it is still to come from `date`, else next month's. */
export function nextUmuganda(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const here = umugandaIn(year, month);
  return here >= date ? here : umugandaIn(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
}

/**
 * Kwibuka: the week of remembrance of the Genocide against the Tutsi, from 7
 * April — the app keeps its cards quiet then (§310). The number is the
 * commemoration's own: Kwibuka 32 in 2026.
 */
export function kwibuka(date: string): { number: number; from: string; to: string } | null {
  const year = Number(date.slice(0, 4));
  const from = ymd(year, 4, 7);
  const to = ymd(year, 4, 13);
  return date >= from && date <= to ? { number: year - 1994, from, to } : null;
}

/** Today in Kigali, as a calendar date. */
export const kigaliToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
