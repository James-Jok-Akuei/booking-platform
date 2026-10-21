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
      values[name] = match[i + 1];
    });
    return format(locale, translated, values);
  }
  return message;
}
