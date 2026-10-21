import { IntlMessageFormat } from 'intl-messageformat';
import { CATALOGS, ERROR_PATTERNS } from './catalogs';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

/**
 * The server's sentences, in the reader's language (§308).
 *
 * Every sentence a customer or a seller reads from the server — an email, a
 * notice, a refusal — is written in English in the code, in ICU form
 * ("Cancelled: {serviceName}, {short}"; "{n, plural, one {# day} other {# days}}"),
 * and goes through `say`. The English is the key translators see in
 * `src/i18n/locales/<language>.po` (`npm run i18n` pulls it out); a sentence
 * not yet translated is said in English. The administrators' console stays
 * English, so what only it reads is left as it is.
 */

export type Values = Record<string, string | number | null | undefined>;

/** How each language writes dates and numbers: the day before the month, a 24-hour clock. */
export const DATE_TAGS: Record<Locale, string> = { en: 'en-GB', fr: 'fr-RW', rw: 'rw-RW' };

export const asLocale = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

/**
 * A date in `locale` — its words, and the order that language writes them in
 * (§308.7). Kinyarwanda's built-in pattern puts the month or the year first
 * ("Ukwakira 22, Kuwa kane"); Rwanda writes "Kuwa kane, 22 Ukwakira 2026".
 */
export function formatDateIn(locale: Locale, date: Date, options: Intl.DateTimeFormatOptions): string {
  if (locale !== 'rw') return new Intl.DateTimeFormat(DATE_TAGS[locale], options).format(date);
  const parts = new Intl.DateTimeFormat(DATE_TAGS.rw, options).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    return value && (type === 'weekday' || type === 'month') ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  };
  const [weekday, day, month, year] = [part('weekday'), part('day'), part('month'), part('year')];
  const when = [day, month, year].filter(Boolean).join(month !== undefined && /^\d+$/.test(month) ? '/' : ' ');
  const time = part('hour') !== undefined ? [part('hour'), part('minute')].filter(Boolean).join(':') : '';
  return [[weekday, when].filter(Boolean).join(', '), time].filter(Boolean).join(' ');
}

const compiled = new Map<string, IntlMessageFormat>();
const catalogOf = (locale: Locale): Record<string, string> | undefined =>
  locale === 'rw' || locale === 'fr' ? CATALOGS[locale] : undefined;

function format(locale: Locale, message: string, values?: Values): string {
  const key = `${locale}\u0000${message}`;
  let formatter = compiled.get(key);
  if (!formatter) {
    try {
      formatter = new IntlMessageFormat(message, DATE_TAGS[locale], undefined, { ignoreTag: true });
    } catch {
      // A broken translation must never stop a message: the words as written.
      return message;
    }
    compiled.set(key, formatter);
  }
  const clean: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values ?? {})) clean[name] = value ?? '';
  try {
    return String(formatter.format(clean));
  } catch {
    return message;
  }
}

/**
 * Marks a sentence kept in a list or a table and said later, with
 * `say(locale, value)`, once the reader is known — as Lingui's `msg` does in
 * the apps. It returns the English unchanged; `npm run i18n` finds it.
 */
export const msg = (english: string): string => english;

/** One sentence, in `locale` when it has been translated, else in English. */
export function say(locale: Locale | string | null | undefined, message: string, values?: Values): string {
  const lang = asLocale(locale);
  const translated = catalogOf(lang)?.[message];
  return translated ? format(lang, translated, values) : format(DEFAULT_LOCALE, message, values);
}

/**
 * A refusal the server already wrote in English, said in `locale` (§308).
 *
 * The thousand-odd `throw new BadRequestException('…')` across the server stay
 * as they are: the error filter passes each message through here. A message
 * written whole is found as it is; one with values in it ("Please wait 42s
 * before…") is recognised by the shape of its English, its values taken out
 * and put into the translation.
 */
/**
 * "a, b and c" as `locale` joins a list (§308.7). Kinyarwanda has no list
 * pattern built in — it would come out with an English "and" — so its "na"
 * (n’ before a vowel) is written here.
 */
export function listIn(locale: Locale, items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (locale !== 'rw') return new Intl.ListFormat(DATE_TAGS[locale], { type: 'conjunction' }).format(items);
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')} ${/^[aeiou]/i.test(last) ? `n’${last}` : `na ${last}`}`;
}

/**
 * A value taken out of an English refusal, in `locale` too when it is one of
 * our own words ("accepted", "opening hours") or a list of them — so a
 * translated sentence never carries an English word inside it (§308.7). A
 * name, a number or anything else is left as it came.
 */
function piece(locale: Locale, catalog: Record<string, string>, value: string | undefined): string | undefined {
  if (!value) return value;
  if (catalog[value]) return format(locale, catalog[value], {});
  const parts = value.split(/, (?:and )?| and /);
  if (parts.length > 1 && parts.every((part) => catalog[part])) {
    return listIn(locale, parts.map((part) => format(locale, catalog[part], {})));
  }
  return value;
}

export function sayError(locale: Locale, message: string): string {
  if (locale === DEFAULT_LOCALE) return message;
  const catalog = catalogOf(locale);
  if (!catalog) return message;
  const whole = catalog[message];
  if (whole) return format(locale, whole, {});
  for (const pattern of ERROR_PATTERNS) {
    const match = pattern.regex.exec(message);
    if (!match) continue;
    const translated = catalog[pattern.id];
    if (!translated) return message;
    const values: Values = {};
    pattern.names.forEach((name, i) => {
      values[name] = piece(locale, catalog, match[i + 1]);
    });
    return format(locale, translated, values);
  }
  return message;
}
