import { useQuery } from '@tanstack/react-query';
import { getCurrency } from './api/admin';

/**
 * Formats minor units using the exponent the SERVER reports (§70.1).
 *
 * ~~§56.4: this app prints "RWF 8302 minor" and never divides, because a
 * currency's decimal places are a property of the currency and the admin app
 * does not carry that table.~~ Superseded in §84: it does not need the table,
 * because `GET /payments/currency` reports the exponent. Reading it is not the
 * mistake §55 and §56 exist to prevent — *assuming* two decimals is, and this
 * never assumes.
 *
 * The raw integer is shown while the exponent is still loading: ugly, never
 * wrong. Mirrors business-web's helper deliberately, so the two consoles cannot
 * disagree about what a number means.
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
    if (!c) return `${label} ${minor.toLocaleString()}`.trim();
    if (c.exponent === 0) return `${label} ${minor.toLocaleString()}`;
    return `${label} ${(minor / c.minorUnitsPerMajor).toFixed(c.exponent)}`;
  };

  /**
   * A signed figure, always carrying its sign.
   *
   * Ledger entries are signed from the business's point of view (§34.2), and a
   * negative that renders as "RWF 240" with the minus swallowed by a column
   * boundary is the one formatting bug that matters here.
   */
  const signed = (minor: number, code?: string | null) =>
    `${minor > 0 ? '+' : ''}${format(minor, code)}`;

  return {
    format,
    signed,
    code: currency.data?.code ?? '',
    exponent: currency.data?.exponent ?? 0,
    ready: currency.isSuccess,
  };
}
