import { useQuery } from '@tanstack/react-query';
import { listAdminCountries, type AdminCountry } from '../api/admin';

/** Every country (§315), read once and kept: numbers are read by their own country's rules. */
export function useCountries(): AdminCountry[] {
  return useQuery({ queryKey: ['admin-countries'], queryFn: listAdminCountries, staleTime: 5 * 60_000 }).data ?? [];
}

/** The country a phone number is in, by the longest calling code that starts it. */
export function countryOfNumber(msisdn: string, countries: AdminCountry[]): AdminCountry | null {
  const digits = msisdn.replace(/\D/g, '');
  return [...countries].sort((a, b) => b.callingCode.length - a.callingCode.length).find((c) => digits.startsWith(c.callingCode)) ?? null;
}

/**
 * "+250788100004" → "+250 788 100 004": the calling code, then the rest read
 * aloud in threes (§245). Unchanged for a number in no country we know.
 */
export function phoneInThrees(msisdn: string, countries: AdminCountry[]): string {
  const country = countryOfNumber(msisdn, countries);
  if (!country) return msisdn;
  const national = msisdn.replace(/\D/g, '').slice(country.callingCode.length).match(/.{1,3}/g) ?? [];
  return `+${country.callingCode} ${national.join(' ')}`;
}

/** The network a number most likely belongs to in its own country (§58.1), or null. */
export function networkOfNumber(msisdn: string, countries: AdminCountry[]): 'MTN_MOMO' | 'AIRTEL_MONEY' | null {
  const country = countryOfNumber(msisdn, countries);
  if (!country) return null;
  const prefix = msisdn.replace(/\D/g, '').slice(country.callingCode.length, country.callingCode.length + 2);
  const network = country.networkPrefixes[prefix];
  return network === 'MTN_MOMO' || network === 'AIRTEL_MONEY' ? network : null;
}
