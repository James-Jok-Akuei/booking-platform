import { dateLocale } from './i18n/format';
/**
 * How far, as a person would say it (§139).
 *
 * Kilometres, because that is what Rwanda measures in. Under a kilometre reads
 * as "600 m" — nobody says "0.6 km" — and past ten the decimal is noise.
 */
export const distanceLabel = (km: number | null | undefined): string | null => {
  if (km === undefined || km === null) return null;
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  // "4.1 km", or "4,1 km" in French (§308).
  return km < 10 ? `${new Intl.NumberFormat(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km)} km` : `${Math.round(km)} km`;
};
