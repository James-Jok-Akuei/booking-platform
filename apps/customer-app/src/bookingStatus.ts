import type { Appointment } from './api/booking';

/**
 * What each status means to the person who booked it.
 *
 * The enum is the platform's vocabulary and belongs in the API; this is the
 * customer's. `PENDING_PAYMENT` in particular is not a state to describe but a
 * thing to do, so it is the one that gets the warning colour and a nudge.
 *
 * In its own file since §133: the list and the booking's own screen both show
 * it, and the second copy is the one that would have said something different.
 */
export const BOOKING_STATUS: Record<
  Appointment['status'],
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'; nudge?: string }
> = {
  PENDING_PAYMENT: {
    label: 'Not paid yet',
    tone: 'warn',
    nudge: 'Pay the deposit to confirm this slot',
  },
  BOOKED: { label: 'Confirmed', tone: 'ok' },
  IN_PROGRESS: { label: 'Happening now', tone: 'accent' },
  COMPLETED: { label: 'Done', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  NO_SHOW: { label: 'Missed', tone: 'danger' },
};
