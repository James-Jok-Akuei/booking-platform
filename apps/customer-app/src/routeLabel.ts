import type { Route } from './api/discovery';
import { distanceLabel } from './distance';

/**
 * "4.1 km by road · about 12 min by car" (§157), or the straight line when the
 * road is not known — said as such, so a straight-line figure is never
 * mistaken for a drive.
 */
export const routeLabel = (route: Route | undefined, fallbackKm?: number | null): string | null => {
  if (route?.by === 'road' && route.minutes !== null) {
    return `${distanceLabel(route.distanceKm)} by road · about ${route.minutes} min by car`;
  }
  const km = route?.distanceKm ?? fallbackKm;
  const away = distanceLabel(km);
  return away ? `${away} away in a straight line` : null;
};
