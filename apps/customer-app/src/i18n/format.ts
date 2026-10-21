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

/**
 * "a, b and c", the way the app's language joins a list (§308) — never by
 * gluing an English " and " into a sentence. Phones without the browser's
 * list formatter get the commas and the language's own "and".
 */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
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
