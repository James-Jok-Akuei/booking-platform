/**
 * How far, as a person would say it (§139).
 *
 * Kilometres, because that is what Rwanda measures in. Under a kilometre reads
 * as "600 m" — nobody says "0.6 km" — and past ten the decimal is noise.
 */
export const distanceLabel = (km: number | null | undefined): string | null => {
  if (km === undefined || km === null) return null;
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
};
