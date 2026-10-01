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

// ---------------------------------------------------------------------------
// Profile, services, locations (§10)
// ---------------------------------------------------------------------------

export interface BusinessProfile {
  id: string;
  name: string | null;
  description: string | null;
  phone: string | null;
  status: string;
  statusReason: string | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory: { id: string; name: string } | null;
}

/** Where a service is offered, and what it costs there (§72). */
export interface ServiceOffer {
  locationId: string;
  /** Minor units. Format with the server's exponent, never /100. */
  priceMinor: number;
  /** False means paused here — the price is kept, ready to resume (§74). */
  isOffered: boolean;
  location: { id: string; name: string };
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  currency: string;
  /** A decimal string, e.g. "20" — percent of the price taken up front. */
  depositPercentage: string;
  isActive: boolean;
  /**
   * The branches that sell this, with each branch's price.
   *
   * Empty means offered nowhere: still in the catalogue, bookable by nobody.
   */
  locations: ServiceOffer[];
}

export interface Hours {
  id: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  capacity: number;
  ratingAvg: string | null;
  ratingCount: number;
  fromPriceMinor: number | null;
  hours: Hours[];
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  subcategories: Array<{ id: string; name: string }>;
}

export const getProfile = () => api<BusinessProfile>('/business/profile');

export const updateProfile = (body: {
  name?: string;
  description?: string;
  phone?: string;
  categoryId?: string;
  subcategoryId?: string;
}) => api<BusinessProfile>('/business/profile', { method: 'PATCH', body });

export const getCategories = () => api<Category[]>('/categories', { anonymous: true });

export const listServices = () => api<Service[]>('/business/services');

/**
 * `depositPercentage` must be at least the platform fee (§40) — the server
 * refuses otherwise, naming the figure, because a smaller deposit would price
 * the business's own share below zero.
 */
export const createService = (body: {
  name: string;
  description?: string;
  durationMinutes: number;
  depositPercentage: number;
  offers: Array<{ locationId: string; priceMinor: number }>;
}) => api<Service>('/business/services', { method: 'POST', body });

export const updateService = (
  id: string,
  body: Partial<{
    name: string;
    description: string;
    durationMinutes: number;
    depositPercentage: number;
    isActive: boolean;
    /** REPLACES the branch list wholesale, like the week of hours. */
    offers: Array<{ locationId: string; priceMinor: number }>;
  }>,
) => api<Service>(`/business/services/${id}`, { method: 'PATCH', body });

/**
 * Turns a service on or off at ONE branch (§74).
 *
 * A toggle: the price is kept while paused, so resuming costs one tap rather
 * than retyping what the work costs.
 */
export const setServiceOfferedAt = (
  id: string,
  locationId: string,
  isOffered: boolean,
) =>
  api<{
    message: string;
    isOffered: boolean;
    offeredAtCount: number;
    service: Service;
  }>(`/business/services/${id}/locations/${locationId}`, {
    method: 'PATCH',
    body: { isOffered },
  });

/** Retires everywhere. Past appointments still resolve to what was booked. */
export const retireService = (id: string) =>
  api<void>(`/business/services/${id}`, { method: 'DELETE' });

export const listLocations = () => api<Location[]>('/business/locations');

export const setHours = (
  locationId: string,
  hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed?: boolean }>,
) =>
  api<Hours[]>(`/business/locations/${locationId}/hours`, {
    method: 'POST',
    body: { hours },
  });

export const setCapacity = (locationId: string, capacity: number) =>
  api<Location>(`/business/locations/${locationId}/capacity`, {
    method: 'PATCH',
    body: { capacity },
  });

/**
 * Turns a service on or off at EVERY branch (§76).
 *
 * "Everywhere" acts on the branches, not on the service's own retired flag —
 * flipping that instead left a service off sale while every branch still
 * claimed to be selling it.
 */
export const setServiceOfferedEverywhere = (id: string, isOffered: boolean) =>
  api<{
    message: string;
    isOffered: boolean;
    offeredAtCount: number;
    service: Service;
  }>(`/business/services/${id}/offered`, { method: 'PATCH', body: { isOffered } });

// ---------------------------------------------------------------------------
// Getting paid (§48, §35)
// ---------------------------------------------------------------------------

export type PayoutDestinationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface PayoutDestination {
  id: string;
  provider: 'MTN_MOMO' | 'AIRTEL_MONEY';
  status: PayoutDestinationStatus;
  submittedAt: string;
  verifiedAt: string | null;
  verificationMethod: 'ADMIN' | 'OTP' | null;
  rejectionReason: string | null;
  /** Masked for everyone; the full number only for the OWNER who submitted it. */
  msisdnLast3: string;
  msisdn?: string;
}

export interface Balance {
  payoutsPaused: boolean;
  /** Which of the two reasons a run would skip this business (§77). */
  payoutsPausedReason: 'BUSINESS_SUSPENDED' | 'DESTINATION_NOT_VERIFIED' | null;
  currency: string;
  availableBySettlementCurrency: Array<{ currency: string; amountMinor: number }>;
  /** Matured and ready for the next run. */
  availableNowMinor: number;
  /** Earned, still inside the hold period. */
  pendingMinor: number;
  /** Appointments with no outcome yet — not yours until they resolve. */
  unresolvedMinor: number;
  lifetimePaidMinor: number;
  payoutCount: number;
  pendingPayouts: { count: number; reportingInternalMinor: number };
  note: string;
}

export interface Payout {
  id: string;
  settlementCurrency: string;
  settlementAmountMinor: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  reference: string | null;
  failureReason: string | null;
  runAt: string;
  paidAt: string | null;
}

export const getPayoutDestination = () =>
  api<{ destination: PayoutDestination | null }>('/business/payout-destination');

/**
 * Submitting SUPERSEDES the current number and starts again as UNVERIFIED
 * (§48.2) — payouts pause until an admin checks it. That is deliberate: a
 * business that has lost control of its SIM must be able to change the number
 * immediately, and the pause is what stops money going to whoever took it.
 */
export const submitPayoutDestination = (msisdn: string) =>
  api<PayoutDestination>('/business/payout-destination', {
    method: 'POST',
    body: { msisdn },
  });

export const getBalance = (businessId: string) =>
  api<Balance>(`/businesses/${businessId}/balance`);

export const listMyPayouts = (businessId: string) =>
  api<{ total: number; payouts: Payout[] }>(`/businesses/${businessId}/payouts`);

// ---------------------------------------------------------------------------
// Support tickets (§80)
//
// The reporter side of the same tickets the admin console answers. Internal
// admin notes are excluded by the server's query, so nothing here can leak one.
// ---------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type TicketCategory =
  | 'APPOINTMENT_DISPUTE'
  | 'PAYMENT_ISSUE'
  | 'TECHNICAL_ISSUE'
  | 'ACCOUNT_ISSUE'
  | 'OTHER';

/** The wording a business sees. The enum is shared; these labels are not. */
export const TICKET_CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: 'PAYMENT_ISSUE', label: 'Getting paid' },
  { value: 'APPOINTMENT_DISPUTE', label: 'A booking or a customer' },
  { value: 'ACCOUNT_ISSUE', label: 'My account or business profile' },
  { value: 'TECHNICAL_ISSUE', label: 'Something is broken' },
  { value: 'OTHER', label: 'Something else' },
];

export interface TicketAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TicketMessage {
  id: string;
  body: string;
  authorType: 'REPORTER' | 'ADMIN' | 'SYSTEM';
  createdAt: string;
  attachments: TicketAttachment[];
}

export interface Ticket {
  id: string;
  reference: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  reopenCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  /**
   * A file sent when the ticket was RAISED hangs off the ticket, not off the
   * opening message — verified against the running server. A reply's file
   * hangs off that message instead, so both places have to be rendered.
   */
  attachments: TicketAttachment[];
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
}

/** How long after being resolved a ticket can still be reopened (§24.3). */
export const REOPEN_WINDOW_DAYS = 14;

export const listMyTickets = (params: { status?: TicketStatus } = {}) =>
  api<{ total: number; tickets: Ticket[] }>('/tickets', { query: params });

export const getMyTicket = (id: string) => api<TicketDetail>(`/tickets/${id}`);

/**
 * Multipart, because the screenshot is optional but the endpoint is the same
 * either way — sending FormData with no file is a valid request.
 */
export const raiseTicket = (input: {
  category: TicketCategory;
  subject: string;
  body: string;
  attachment?: File | null;
}) => {
  const form = new FormData();
  form.set('category', input.category);
  form.set('subject', input.subject);
  form.set('body', input.body);
  if (input.attachment) form.set('attachment', input.attachment);
  return api<Ticket>('/tickets', { method: 'POST', body: form });
};

export const replyToMyTicket = (id: string, body: string, attachment?: File | null) => {
  const form = new FormData();
  form.set('body', body);
  if (attachment) form.set('attachment', attachment);
  return api<TicketMessage>(`/tickets/${id}/messages`, { method: 'POST', body: form });
};

export const reopenMyTicket = (id: string) =>
  api<Ticket>(`/tickets/${id}/reopen`, { method: 'POST' });
