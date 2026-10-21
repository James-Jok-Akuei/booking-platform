import type { Appointment } from './api/booking';
import { t } from '@lingui/core/macro';

/**
 * What each status means to the person who booked it.
 *
 * The enum is the platform's vocabulary and belongs in the API; this is the
 * customer's. `PENDING_PAYMENT` in particular is not a state to describe but a
 * thing to do, so it is the one that gets the warning colour and a nudge.
 *
 * In its own file since §133: the list and the booking's own screen both show
 * it, and the second copy is the one that would have said something different.
 *
 * Read when used (getters), so the words are in the app's language (§308).
 */
export const BOOKING_STATUS: Record<
  Appointment['status'],
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'; nudge?: string }
> = {
  PENDING_PAYMENT: {
    get label() { return t({ message: t`Not paid yet`, context: 'booking status' }); },
    tone: 'warn',
    get nudge() { return t`Pay the deposit to confirm this slot`; },
  },
  BOOKED: { get label() { return t({ message: t`Confirmed`, context: 'booking status' }); }, tone: 'ok' },
  IN_PROGRESS: { get label() { return t({ message: t`Happening now`, context: 'booking status' }); }, tone: 'accent' },
  COMPLETED: { get label() { return t({ message: t`Done`, context: 'booking status' }); }, tone: 'neutral' },
  CANCELLED: { get label() { return t({ message: t`Cancelled`, context: 'booking status' }); }, tone: 'neutral' },
  NO_SHOW: { get label() { return t({ message: t`Missed`, context: 'booking status' }); }, tone: 'danger' },
};
