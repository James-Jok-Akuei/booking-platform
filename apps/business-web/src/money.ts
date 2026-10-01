import { useQuery } from '@tanstack/react-query';
import { getCurrency } from './api/business';

/**
 * Formats minor units using the exponent the SERVER reports (§70.1).
 *
 * Shared, because the alternative is each screen dividing by 100 — right in a
 * two-decimal currency and wrong by a hundred in one with no minor unit. The
 * raw integer is shown while the exponent is still loading: ugly, never wrong.
 */
export function useMoney() {
  const currency = useQuery({ queryKey: ['currency'], queryFn: getCurrency, staleTime: Infinity });

  const format = (minor: number | null | undefined) => {
    if (minor === null || minor === undefined) return '—';
    const c = currency.data;
    if (!c) return String(minor);
    if (c.exponent === 0) return `${c.code} ${minor.toLocaleString()}`;
    return `${c.code} ${(minor / c.minorUnitsPerMajor).toFixed(c.exponent)}`;
  };

  /** Major units typed by a person, back to the integer the API expects. */
  const toMinor = (major: string) => {
    const c = currency.data;
    const value = Number(major);
    if (!Number.isFinite(value)) return NaN;
    return Math.round(value * (c?.minorUnitsPerMajor ?? 1));
  };

  const toMajor = (minor: number) => {
    const c = currency.data;
    return String(minor / (c?.minorUnitsPerMajor ?? 1));
  };

  return { format, toMinor, toMajor, code: currency.data?.code ?? '', exponent: currency.data?.exponent ?? 0 };
}
