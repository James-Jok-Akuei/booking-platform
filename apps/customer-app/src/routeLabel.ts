import type { Route } from './api/discovery';
import { distanceLabel } from './distance';
import { t } from '@lingui/core/macro';

/**
 * "4.1 km by road · about 12 min by car" (§157), or the straight line when the
 * road is not known — said as such, so a straight-line figure is never
 * mistaken for a drive.
 */
export const routeLabel = (route: Route | undefined, fallbackKm?: number | null): string | null => {
  if (route?.by === 'road' && route.minutes !== null) {
    const distance = distanceLabel(route.distanceKm) ?? '';
    const minutes = route.minutes;
    return t`${distance} by road · about ${minutes} min by car`;
  }
  const km = route?.distanceKm ?? fallbackKm;
  const away = distanceLabel(km);
  return away ? t`${away} away in a straight line` : null;
};
