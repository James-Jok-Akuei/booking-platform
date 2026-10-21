import { useQuery } from '@tanstack/react-query';
import { getCurrency } from './api/discovery';

/**
 * Formats minor units using the exponent the SERVER reports.
 *
 * The third copy of this helper, and deliberately identical to the two web
 * ones: a currency's decimal places are a property of the currency, and this
 * app has no business deciding them. Assuming two is what §67.4 and §96 were
 * both about.
 *
 * The raw integer shows while the exponent is still loading — ugly, never
 * wrong.
 */
export function useMoney() {
  const currency = useQuery({
    queryKey: ['currency'],
    queryFn: getCurrency,
    staleTime: Infinity,
  });

  const format = (minor: number | null | undefined, code?: string | null) => {
    if (minor === null || minor === undefined) return '—';
    const c = currency.data;
    const label = code ?? c?.code ?? '';
    // Grouped the same in every language (§308): "RWF 12,000", as mobile money writes it.
    if (!c) return `${label} ${minor.toLocaleString('en-US')}`.trim();
    if (c.exponent === 0) return `${label} ${minor.toLocaleString('en-US')}`;
    return `${label} ${(minor / c.minorUnitsPerMajor).toFixed(c.exponent)}`;
  };

  return { format, code: currency.data?.code ?? '', exponent: currency.data?.exponent ?? 0 };
}
