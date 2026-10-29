import { MobileMoneyProvider } from '@prisma/client';
import { LOCALES } from '../i18n/locales';
import { INTERNAL_CURRENCY, MINOR_UNIT_EXPONENT } from '../payments/currency';
import { packFor } from './packs';
import type { CountryRow } from './countries.service';

export type CountryCheckKey = 'pack' | 'currency' | 'clock' | 'phone' | 'networks' | 'languages' | 'places';

export type CountryCheck = { key: CountryCheckKey; ok: boolean; words: string };

/** Names for the console, not codes. */
const NETWORK_NAME: Record<string, string> = { MTN_MOMO: 'MTN MoMo', AIRTEL_MONEY: 'Airtel Money' };
const LANGUAGE_NAME: Record<string, string> = { en: 'English', rw: 'Kinyarwanda', fr: 'French' };
const named = (codes: string[], names: Record<string, string>) => codes.map((c) => names[c] ?? c).join(', ');

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * What a country needs before it can be switched on (§315), each said so the
 * console can show it. The same list `CountryGuard` checks at boot for every
 * live country, so a country cannot be on with any of these wrong.
 *
 * `currency` is the one that is not about the country: until money in more
 * than one currency is built (§315.3), a country can be live only when its
 * money is the platform's unit of account.
 */
export function countryChecks(country: CountryRow, places: number): CountryCheck[] {
  const pack = packFor(country.code);
  const knownLocales = new Set<string>(LOCALES);
  return [
    {
      key: 'pack',
      ok: pack !== null && pack.callingCode === country.callingCode,
      words: !pack
        ? `No country pack: add src/countries/packs/${country.code.toLowerCase()}.ts.`
        : pack.callingCode !== country.callingCode
          ? `Its pack says +${pack.callingCode} and its row +${country.callingCode}: one of them is wrong.`
          : 'The code knows its phone numbers, papers and calendar.',
    },
    {
      key: 'currency',
      ok: country.currency === INTERNAL_CURRENCY && MINOR_UNIT_EXPONENT[country.currency] !== undefined,
      words:
        country.currency === INTERNAL_CURRENCY
          ? `Prices, deposits and payouts in ${country.currency}, the platform's money.`
          : `Its money is ${country.currency}, and the platform keeps its books in ${INTERNAL_CURRENCY}. ` +
            'Money in more than one currency is not built yet (DECISIONS §315.3).',
    },
    {
      key: 'clock',
      ok: validZone(country.timeZone),
      words: validZone(country.timeZone) ? `Shops keep ${country.timeZone} time.` : `"${country.timeZone}" is not a time zone.`,
    },
    {
      key: 'phone',
      ok: /^\d{1,3}$/.test(country.callingCode) && country.phoneExample.replace(/\D/g, '').startsWith(country.callingCode),
      words: `Phone numbers start +${country.callingCode} (${country.phoneExample}).`,
    },
    {
      key: 'networks',
      ok: country.networks.length > 0 && country.networks.every((n) => Object.values(MobileMoneyProvider).includes(n)),
      words: country.networks.length > 0 ? `Paid through ${named(country.networks, NETWORK_NAME)}.` : 'No mobile money network.',
    },
    {
      key: 'languages',
      ok: country.locales.length > 0 && country.locales.every((l) => knownLocales.has(l)),
      words:
        country.locales.every((l) => knownLocales.has(l)) && country.locales.length > 0
          ? `The apps speak ${named(country.locales, LANGUAGE_NAME)}.`
          : `The apps do not speak ${country.locales.filter((l) => !knownLocales.has(l)).join(', ') || 'any of its languages'} yet.`,
    },
    {
      key: 'places',
      ok: places > 0,
      words: places > 0 ? `${places} districts to pick from.` : 'No places: its areas are not in the reference data.',
    },
  ];
}
