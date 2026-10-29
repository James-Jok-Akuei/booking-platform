import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCountries, getProfile, type Country, type ShopCountry } from '../api/business';
import { requestCountry } from '../api/client';
import { countryLocales } from '../i18n';

/** The shop's country, with how its phone numbers are read (§315). */
export type ShopCountryInfo = ShopCountry & Partial<Pick<Country, 'mobileDigits' | 'networkPrefixes'>>;

/**
 * The shop's country (§315) — its clock, money, phone numbers and networks —
 * from its profile, with how its numbers are read from the countries list.
 * Also tells the server which country the app is in, on every request, and
 * narrows the languages offered to the country's own.
 */
export function useShopCountry(): ShopCountryInfo | null {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, staleTime: 5 * 60_000 });
  const countries = useQuery({ queryKey: ['countries'], queryFn: getCountries, staleTime: Infinity });
  const own = profile.data?.country ?? null;
  useEffect(() => {
    if (!own) return;
    requestCountry.current = own.code;
    countryLocales.current = own.locales;
  }, [own]);
  if (!own) return null;
  const listed = countries.data?.find((c) => c.code === own.code);
  return { ...own, mobileDigits: listed?.mobileDigits, networkPrefixes: listed?.networkPrefixes };
}

/**
 * "+250788100001" → "+250 788 100 001": the calling code, then the national
 * number read in threes, as people say it (§245). Unchanged when it is not a
 * number in that country.
 */
export function phoneInThrees(msisdn: string, callingCode: string | undefined): string {
  const digits = msisdn.replace(/\D/g, '');
  if (!callingCode || !digits.startsWith(callingCode) || digits.length <= callingCode.length + 3) return msisdn;
  const national = digits.slice(callingCode.length).match(/.{1,3}/g) ?? [];
  return `+${callingCode} ${national.join(' ')}`;
}
