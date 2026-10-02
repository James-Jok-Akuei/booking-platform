import { api } from './client';

export interface Appointment {
  id: string;
  status:
    | 'PENDING_PAYMENT'
    | 'BOOKED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  startTime: string;
  endTime: string;
  currency: string;
  depositAmountMinor: number;
  platformFeeAmountMinor: number;
  businessAmountMinor: number;
  servicePriceMinor: number | null;
  depositPaidAt: string | null;
  verificationCode?: string | null;
  service: { id: string; name: string; durationMinutes: number };
  location: { id: string; name: string; address: string; businessId: string };
}

/**
 * Holds the slot. The appointment starts PENDING_PAYMENT and is not confirmed
 * until the deposit lands — §2's non-refundable deposit is what makes the
 * commitment real, so nothing is reserved on a promise.
 */
export const createAppointment = (input: {
  locationId: string;
  serviceId: string;
  startTime: string;
}) => api<Appointment>('/appointments', { method: 'POST', body: input });

export const listMyAppointments = (params: { status?: string; limit?: number } = {}) =>
  api<{ total: number; appointments: Appointment[] }>('/appointments', { query: params });

export const getAppointment = (id: string) => api<Appointment>(`/appointments/${id}`);

export const cancelAppointment = (id: string, reason: string) =>
  api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: { reason } });

export interface PaymentStatus {
  appointmentId: string;
  status: string;
  depositPaidAt: string | null;
  paymentInitiatedAt: string | null;
  paymentProviderReferenceId: string | null;
  /** What the operator says now. Polled, because approval happens off-device. */
  providerStatus?: string | null;
  message?: string | null;
}

/**
 * Asks the operator to charge the customer's phone.
 *
 * Returns as soon as the request is accepted, NOT when it is paid: the customer
 * approves on their own handset, which may take a minute or never happen. The
 * outcome is only knowable by polling `getPaymentStatus`.
 */
export const initiateDeposit = (
  appointmentId: string,
  phoneNumber: string,
  provider?: string,
) =>
  api<PaymentStatus>(`/appointments/${appointmentId}/initiate-deposit-payment`, {
    method: 'POST',
    body: { phoneNumber, ...(provider ? { provider } : {}) },
  });

export const getPaymentStatus = (appointmentId: string) =>
  api<PaymentStatus>(`/appointments/${appointmentId}/payment-status`);

export const resendVerificationCode = (appointmentId: string) =>
  api<{ message: string }>(`/appointments/${appointmentId}/resend-verification-code`, {
    method: 'POST',
  });

/** Which operators this deployment can take money through, and a guess from the number. */
export const getPaymentProviders = (phoneNumber?: string) =>
  api<{ providers: string[]; suggested: string | null; choiceRequired: boolean }>(
    '/payments/providers',
    { query: phoneNumber ? { phoneNumber } : {}, anonymous: true },
  );
