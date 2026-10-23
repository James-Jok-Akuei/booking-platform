import type { Appointment } from '../api/booking';

/**
 * When a customer may cancel, and when it costs nothing (§313) — a copy of
 * the server's rule (`FREE_CANCELLATION_HOURS`), so the app can say the
 * deadline before anyone presses; the server decides.
 *
 * - Not paid yet: cancel any time, nothing is lost.
 * - Paid: cancel until the start. At least 24 hours before, the whole deposit
 *   comes back; later, it is not refunded.
 * - After the start, not coming is a missed booking.
 */
export const FREE_CANCELLATION_HOURS = 24;

type Rule = Pick<Appointment, 'status' | 'startTime' | 'depositPaidAt'>;

/** Until when cancelling gives the deposit back. */
export const freeUntil = (a: Pick<Appointment, 'startTime'>) =>
  new Date(new Date(a.startTime).getTime() - FREE_CANCELLATION_HOURS * 3_600_000);

/** Whether the customer can still cancel it themselves. */
export const canCancelNow = (a: Rule, now = Date.now()) =>
  a.status === 'PENDING_PAYMENT' || (a.status === 'BOOKED' && now < new Date(a.startTime).getTime());

/** Whether cancelling now would bring the paid deposit back. */
export const freeNow = (a: Rule, now = Date.now()) =>
  a.depositPaidAt !== null && now <= freeUntil(a).getTime();

/** A missed booking the platform marked a day after its end, not the shop (§313). */
export const missedByItself = (a: Pick<Appointment, 'endTime' | 'noShowAt'>) =>
  a.noShowAt !== null && new Date(a.noShowAt).getTime() - new Date(a.endTime).getTime() >= 23 * 3_600_000;
