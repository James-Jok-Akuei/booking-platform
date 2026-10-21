import { t } from '@lingui/core/macro';
import { appLocale, type AppLocale } from './index';

/**
 * How dates, times and counts are written (§308): in the app's language, the
 * way Rwanda writes them — the day before the month, a 24-hour clock. Every
 * `toLocaleDateString` / `toLocaleTimeString` in the app passes this, never
 * `undefined` (which would follow the phone's setting, not the app's).
 *
 * Money is the exception, in `money.ts`: "RWF 12,000" in every language, as
 * mobile money writes it on the customer's own phone.
 */
const TAGS: Record<AppLocale, string> = { en: 'en-GB', 'en-XA': 'en-GB', fr: 'fr-RW', rw: 'rw-RW' };

export const dateLocale = () => TAGS[appLocale()];

type DateValue = Date | string | number;
const asDate = (value: DateValue) => (value instanceof Date ? value : new Date(value));

/**
 * Kinyarwanda's names for the days and months, written here (§308.7): most
 * browsers and phones carry no Kinyarwanda dates and quietly fall back to
 * English ("Wednesday 21 October"). These are the names the language's own
 * standard (CLDR) gives, with a capital as a person writes them.
 */
const RW_DAYS = ['Ku cyumweru', 'Kuwa mbere', 'Kuwa kabiri', 'Kuwa gatatu', 'Kuwa kane', 'Kuwa gatanu', 'Kuwa gatandatu'];
const RW_DAYS_SHORT = ['Cyu.', 'Mbe.', 'Kab.', 'Gtu.', 'Kan.', 'Gnu.', 'Gnd.'];
const RW_MONTHS = ['Mutarama', 'Gashyantare', 'Werurwe', 'Mata', 'Gicurasi', 'Kamena', 'Nyakanga', 'Kanama', 'Nzeri', 'Ukwakira', 'Ugushyingo', 'Ukuboza'];
const RW_MONTHS_SHORT = ['Mut.', 'Gas.', 'Wer.', 'Mat.', 'Gic.', 'Kam.', 'Nya.', 'Kan.', 'Nze.', 'Ukw.', 'Ugu.', 'Uku.'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A Kinyarwanda date, the way Rwanda writes it: "Kuwa kane, 22 Ukwakira 2026"
 * — the day first, a 24-hour clock (§308.7).
 */
function inRwandaOrder(date: Date, options: Intl.DateTimeFormatOptions): string {
  const o: Intl.DateTimeFormatOptions = { ...options };
  if (o.dateStyle) {
    const style = o.dateStyle;
    delete o.dateStyle;
    Object.assign(
      o,
      style === 'full'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : style === 'long'
          ? { day: 'numeric', month: 'long', year: 'numeric' }
          : style === 'medium'
            ? { day: 'numeric', month: 'short', year: 'numeric' }
            : { day: '2-digit', month: '2-digit', year: 'numeric' },
    );
  }
  if (o.timeStyle) {
    const style = o.timeStyle;
    delete o.timeStyle;
    Object.assign(o, { hour: '2-digit', minute: '2-digit' }, style === 'short' ? {} : { second: '2-digit' });
  }
  // Taken apart in British English — the same day-first order and 24-hour clock,
  // and present everywhere — then each name said in Kinyarwanda.
  const parts = new Intl.DateTimeFormat('en-GB', o).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const english = { weekday: part('weekday'), month: part('month') };
  const dayAt = english.weekday ? EN_DAYS.findIndex((d) => english.weekday!.startsWith(d)) : -1;
  const monthAt = english.month ? EN_MONTHS.findIndex((m) => english.month!.startsWith(m)) : -1;
  const weekday = dayAt === -1 ? undefined : (o.weekday === 'long' ? RW_DAYS : RW_DAYS_SHORT)[dayAt];
  const month = monthAt === -1 ? english.month : (o.month === 'long' ? RW_MONTHS : RW_MONTHS_SHORT)[monthAt];
  const [day, year] = [part('day'), part('year')];
  const numeric = month !== undefined && /^\d+$/.test(month);
  const when = [day, month, year].filter(Boolean).join(numeric ? '/' : ' ');
  const time = part('hour') !== undefined ? [part('hour'), part('minute'), part('second')].filter(Boolean).join(':') : '';
  return [[weekday, when].filter(Boolean).join(', '), time].filter(Boolean).join(' ');
}

/** A date in the app's language — its words, and the order that language writes them in. */
export function formatDate(value: DateValue, options?: Intl.DateTimeFormatOptions): string {
  const date = asDate(value);
  return dateLocale() === 'rw-RW'
    ? inRwandaOrder(date, options ?? { day: '2-digit', month: '2-digit', year: 'numeric' })
    : date.toLocaleDateString(dateLocale(), options);
}

/** A date and time, as `formatDate`. */
export function formatDateTime(value: DateValue, options?: Intl.DateTimeFormatOptions): string {
  const date = asDate(value);
  return dateLocale() === 'rw-RW'
    ? inRwandaOrder(date, options ?? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(dateLocale(), options);
}

/** A time ("11:15"); with a day in it, the day in the language's order too. */
export function formatTime(value: DateValue, options?: Intl.DateTimeFormatOptions): string {
  const date = asDate(value);
  const withDay = options && (options.weekday || options.day || options.month);
  if (dateLocale() !== 'rw-RW') return date.toLocaleTimeString(dateLocale(), options);
  return inRwandaOrder(date, withDay ? options! : { hour: '2-digit', minute: '2-digit', ...options });
}

/**
 * "a, b and c", the way the app's language joins a list (§308) — never by
 * gluing an English " and " into a sentence. Phones without the browser's
 * list formatter get the commas and the language's own "and".
 */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (appLocale() === 'rw') {
    // Kinyarwanda has no list pattern built in — it would come out with an English "and": "na", n’ before a vowel.
    const last = items[items.length - 1];
    return `${items.slice(0, -1).join(', ')} ${/^[aeiou]/i.test(last) ? `n’${last}` : `na ${last}`}`;
  }
  const ListFormat = (Intl as unknown as { ListFormat?: new (locale: string, options: object) => { format(list: string[]): string } }).ListFormat;
  if (ListFormat && appLocale() !== 'en-XA') {
    try {
      return new ListFormat(dateLocale(), { style: 'long', type: 'conjunction' }).format(items);
    } catch {
      // An unknown language: the fallback below.
    }
  }
  const last = items[items.length - 1];
  const rest = items.slice(0, -1).join(', ');
  return t`${rest} and ${last}`;
}
