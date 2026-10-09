import type { AppointmentStatus } from '../api/admin';

/**
 * How a booking is described — in the same words and colours as the business
 * app's Appointments (§213), so an administrator and a shop talking about one
 * booking call it the same thing.
 */
export const BOOKING_STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  BOOKED: { label: 'Expected', cls: 'booked' },
  IN_PROGRESS: { label: 'In progress', cls: 'in-progress' },
  COMPLETED: { label: 'Done', cls: 'completed' },
  NO_SHOW: { label: 'No-show', cls: 'no-show' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  PENDING_PAYMENT: { label: 'Unpaid', cls: 'pending-payment' },
};

/**
 * The number the customer's app shows them (§213): the first eight
 * characters of the booking's id, "3F2A-1C9B" — what a customer quotes in a
 * ticket, and what the shop sees on the same booking.
 */
export const reservationNo = (id: string) => {
  const s = id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
