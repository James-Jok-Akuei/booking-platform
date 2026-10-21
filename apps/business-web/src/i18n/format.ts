import { t } from '@lingui/core/macro';
import { appLocale, type AppLocale } from './index';

/**
 * How dates, times and counts are written (§308): in the app's language, the
 * way Rwanda writes them — the day before the month, a 24-hour clock. Every
 * `toLocaleDateString` / `toLocaleTimeString` passes this, never `undefined`
 * (which would follow the browser's setting, not the app's).
 *
 * Money is the exception: "RWF 12,000" in every language, as mobile money
 * writes it.
 */
const TAGS: Record<AppLocale, string> = { en: 'en-GB', 'en-XA': 'en-GB', fr: 'fr-RW', rw: 'rw-RW' };

export const dateLocale = () => TAGS[appLocale()];

/** "a, b and c", the way the app's language joins a list — never by gluing an English " and ". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (appLocale() !== 'en-XA') {
    try {
      return new Intl.ListFormat(dateLocale(), { style: 'long', type: 'conjunction' }).format(items);
    } catch {
      // An unknown language: the fallback below.
    }
  }
  const last = items[items.length - 1];
  const rest = items.slice(0, -1).join(', ');
  return t`${rest} and ${last}`;
}

/**
 * A day of the week by its number (0 = Sunday), in the app's language — the
 * names the language itself uses (§308), not words a translator has to make.
 */
export const dayName = (day: number, width: 'long' | 'short' = 'long') =>
  // 2023-01-01 was a Sunday.
  new Date(Date.UTC(2023, 0, 1 + day, 12)).toLocaleDateString(dateLocale(), { weekday: width, timeZone: 'UTC' });
