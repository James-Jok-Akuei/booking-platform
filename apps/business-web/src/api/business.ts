import { api } from './client';

/**
 * The business endpoints this app uses.
 *
 * Hand-written over the generated contract, like the admin console: the
 * contract owns the shapes, this file records which of the backend's endpoints
 * this app actually touches.
 */

export type AppointmentStatus =
  | 'PENDING_PAYMENT'
  | 'BOOKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Appointment {
  id: string;
  status: AppointmentStatus;
  startTime: string;
  endTime: string;
  /** Minor units of `currency`. Never divided here; see `Currency` below. */
  depositAmountMinor: number;
  platformFeeAmountMinor: number;
  businessAmountMinor: number;
  servicePriceMinor: number | null;
  currency: string;
  depositPaidAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  verificationCodeSentAt: string | null;
  service: { id: string; name: string; durationMinutes: number };
  customer: { id: string; email: string };
  location: { id: string; name: string; address: string; businessId: string };
}

export interface AppointmentPage {
  total: number;
  limit: number;
  offset: number;
  appointments: Appointment[];
}

export interface Me {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  businessMembership: {
    id: string;
    role: 'OWNER' | 'MANAGER' | 'STAFF';
    status: string;
    businessProfile: { id: string; name: string | null; status: string };
  } | null;
}

/**
 * How to render money (§70.1).
 *
 * Fetched, never assumed. Dividing by 100 is correct in a two-decimal currency
 * and wrong by a factor of a hundred in a currency with no minor unit — the
 * §55.2 mistake, moved to the front end where it is harder to see.
 */
export interface Currency {
  code: string;
  exponent: number;
  minorUnitsPerMajor: number;
  note: string;
}

export const getMe = () => api<Me>('/users/me');

export const getCurrency = () => api<Currency>('/payments/currency', { anonymous: true });

export const listAppointments = (params: {
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) => api<AppointmentPage>('/appointments', { query: params });

/** The code the customer reads out. Moves BOOKED -> IN_PROGRESS (§16.2). */
export const verifyArrival = (id: string, code: string) =>
  api<Appointment>(`/business/appointments/${id}/verify`, {
    method: 'POST',
    body: { code },
  });

/**
 * Verification without the code — OWNER and MANAGER only (§54.3).
 *
 * Recorded against whoever does it, with what the customer recalled, and every
 * admin is told. The note is not checked against the appointment: every fact a
 * server could check is already on this screen.
 */
export const verifyManually = (id: string, note: string) =>
  api<Appointment>(`/business/appointments/${id}/verify-manually`, {
    method: 'POST',
    body: { note },
  });

export const completeAppointment = (id: string) =>
  api<Appointment>(`/business/appointments/${id}/complete`, { method: 'POST' });

export const markNoShow = (id: string) =>
  api<Appointment>(`/business/appointments/${id}/no-show`, { method: 'POST' });

/**
 * A business cancelling a PAID appointment refunds the customer in full,
 * including the platform's own fee (§36) — so the server requires a reason and,
 * where a deposit was taken, what the gateway charged.
 */
export const cancelAppointment = (id: string, reason: string) =>
  api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: { reason } });
