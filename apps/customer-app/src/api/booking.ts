import { api } from './client';
import type { components, paths } from './schema';

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
  /**
   * When a code was last emailed (§53.2) — not how many times.
   *
   * Enough for the screen to keep its own one-minute cooldown rather than
   * offering a button the server answers with "a code was just sent".
   */
  verificationCodeSentAt?: string | null;
  service: { id: string; name: string; durationMinutes: number };
  location: { id: string; name: string; address: string; businessId: string };
  /**
   * The customer's own review, when they have left one.
   *
   * Only ever present on the customer's own reads (§111). Its absence is what
   * the screen uses to offer "write a review"; without it the app could not
   * tell an unreviewed visit from a reviewed one, because the public listing
   * carries no `customerId` to find yourself in.
   */
  review?: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    editedAt: string | null;
  } | null;
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

/**
 * The caller's own bookings. The query shape comes from the contract, so a
 * parameter the backend does not have is a compile error rather than a 400 the
 * screen discovers (§110).
 *
 * `sort` matters more than it looks: the endpoint's default is `latest`, which
 * for a list of UPCOMING bookings puts the furthest-away one first — and on page
 * one, so reversing the page client-side would not fix it.
 */
type ListAppointmentsQuery = NonNullable<
  NonNullable<paths['/appointments']['get']['parameters']['query']>
>;

export const listMyAppointments = (params: ListAppointmentsQuery = {}) =>
  api<{ total: number; limit: number; offset: number; appointments: Appointment[] }>(
    '/appointments',
    { query: params },
  );

export const getAppointment = (id: string) => api<Appointment>(`/appointments/${id}`);

export const cancelAppointment = (id: string, reason: string) =>
  api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: { reason } });

/**
 * Both payment shapes come from the generated contract, not from here.
 *
 * They were hand-written once, and every field name was wrong: the screen polled
 * happily, read `undefined` for all of them, and so never noticed a deposit
 * being paid (§109). Importing them means the backend changing its mind breaks
 * this build rather than one screen on somebody's phone.
 */
export type PaymentStatus = components['schemas']['PaymentStatusResponseDto'];
export type InitiatedDeposit =
  components['schemas']['InitiateDepositPaymentResponseDto'];

/** Just the payment half, for a screen that only needs to know what to show. */
export type DepositStage = PaymentStatus['paymentStatus'];

/**
 * A failed deposit, in words a customer can act on.
 *
 * `failureReason` is the operator's own string and is meant for support, not for
 * reading: MTN's four failure states collapse into one `FAILED`, and what
 * survives is text like `FAILED: APPROVAL_REJECTED`. Confirmed against the
 * sandbox, whose payer numbers force each one (§109.3).
 *
 * The three cases genuinely differ in what the customer should do next, which is
 * why they are not one apology: a rejection was their own choice, an expiry means
 * they were too slow, and an internal error is nobody's fault but the operator's.
 */
export const explainFailedDeposit = (failureReason?: string): string => {
  const reason = failureReason ?? '';
  if (reason.includes('APPROVAL_REJECTED'))
    return 'The payment was declined on your phone. Nothing was taken.';
  if (reason.includes('EXPIRED') || reason.includes('TIMEOUT'))
    return 'The request timed out before it was approved. Nothing was taken.';
  if (reason.includes('not configured'))
    return 'Mobile money is not available right now. Nothing was taken.';
  return 'The payment did not go through. Nothing was taken.';
};

/**
 * What a person types, as MSISDN: digits only, no `+`, no spaces.
 *
 * The backend accepts `^\d{8,15}$` and nothing else, while the field a customer
 * types into is labelled `07xx xxx xxx` — spaces and all. The app was teaching
 * people to type exactly the format it would then reject (§109.2). Normalising
 * here rather than loosening the DTO: the operator wants MSISDN, and one
 * stripper next to the keyboard beats a regex that also accepts prettiness.
 */
export const toMsisdn = (typed: string) => typed.replace(/\D/g, '');

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
  api<InitiatedDeposit>(`/appointments/${appointmentId}/initiate-deposit-payment`, {
    method: 'POST',
    body: { phoneNumber: toMsisdn(phoneNumber), ...(provider ? { provider } : {}) },
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
