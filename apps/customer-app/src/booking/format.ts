import type { Appointment } from '../api/booking';
import type { ViewerPhoto } from '../ui/PhotoViewer';
import { dateLocale } from '../i18n/format';
import { plural } from '@lingui/core/macro';

/**
 * What the customer is buying, as a picture (§137). The appointment carries
 * the service's name and nothing to look at, so this is read from the shop —
 * and every field is optional, because a shop that has since closed answers
 * 404 and the booking still has to be shown.
 */
export type Bought = {
  images: ViewerPhoto[];
  cover: string | null;
  categoryIcon: string | null;
  logoUrl: string | null;
  businessName: string;
  latitude: number | null;
  longitude: number | null;
};

export const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(dateLocale(), { timeStyle: 'short' });

export const timeRange = (a: Pick<Appointment, 'startTime' | 'endTime'>) =>
  `${timeOf(a.startTime)} – ${timeOf(a.endTime)}`;

export const minutesOf = (a: Pick<Appointment, 'startTime' | 'endTime'>) =>
  Math.round((new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60_000);

/** "For 3 people", or nothing for one (§189: a quantity is always people). */
export const howMany = (a: Pick<Appointment, 'quantity'>) =>
  a.quantity <= 1 ? null : plural(a.quantity, { one: 'For # person', other: 'For # people' });

/**
 * A number a person can read out. It is the first eight characters of the
 * booking's real id, not a second identifier — so whoever is helping can find
 * the booking from it, and there is no table of numbers to keep in step.
 */
export const reservationNo = (id: string) => {
  const s = id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

/** What is still owed at the shop; null on bookings older than the price snapshot. */
export const balanceMinor = (a: Pick<Appointment, 'servicePriceMinor' | 'depositAmountMinor'>) =>
  a.servicePriceMinor === null ? null : Math.max(0, a.servicePriceMinor - a.depositAmountMinor);
