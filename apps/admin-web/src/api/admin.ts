import { api } from './client';

/**
 * The admin endpoints this app uses.
 *
 * Hand-written signatures over the generated `schema.d.ts`, rather than a
 * generated client. The contract is the source of truth for the SHAPES; this
 * file is where the app says which of those ninety endpoints it actually
 * touches, so an endpoint disappearing from the backend shows up here as a
 * compile error in one file rather than in a dozen components.
 */

export type BusinessStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface AdminBusiness {
  id: string;
  name: string | null;
  description: string | null;
  phone: string | null;
  status: BusinessStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedById: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  category: { id: string; name: string } | null;
  subcategory: { id: string; name: string } | null;
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  businesses: T[];
}

export const listBusinesses = (params: {
  status?: BusinessStatus;
  limit?: number;
  offset?: number;
}) => api<Page<AdminBusiness>>('/admin/businesses', { query: params });

export const getBusiness = (id: string) => api<AdminBusiness>(`/admin/businesses/${id}`);

export const approveBusiness = (id: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/approve`, { method: 'PATCH' });

export const reinstateBusiness = (id: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/reinstate`, { method: 'PATCH' });

/** Rejection and suspension both REQUIRE a reason — the business is told it. */
export const rejectBusiness = (id: string, reason: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/reject`, {
    method: 'PATCH',
    body: { reason },
  });

export const suspendBusiness = (id: string, reason: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/suspend`, {
    method: 'PATCH',
    body: { reason },
  });

// ---------------------------------------------------------------------------
// Payout destinations (§48)
// ---------------------------------------------------------------------------

export type PayoutDestinationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface PayoutDestination {
  id: string;
  businessId: string;
  /**
   * The FULL number, not the masked `msisdnLast3` other callers get.
   *
   * Deliberate: verification means contacting the holder and confirming the
   * number is theirs, which cannot be done against the last three digits. Every
   * other reader — including the business's own staff — sees the mask (§48.4).
   */
  msisdn: string;
  provider: 'MTN_MOMO' | 'AIRTEL_MONEY';
  status: PayoutDestinationStatus;
  submittedById: string;
  submittedAt: string;
  verifiedById: string | null;
  verifiedAt: string | null;
  verificationMethod: 'ADMIN' | 'OTP' | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  createdAt: string;
  businessProfile: { id: string; name: string | null; phone: string | null };
  /**
   * What took over, on a SUPERSEDED row (§78). Null on a live one.
   *
   * Resolved by the server because a status filter usually leaves the successor
   * off this page, and because the history is read during a dispute — when
   * inferring it from timestamps is exactly the wrong thing to ask of someone.
   */
  replacedBy: {
    id: string;
    msisdn: string;
    status: PayoutDestinationStatus;
    submittedAt: string;
  } | null;
}

export interface DestinationPage {
  total: number;
  limit: number;
  offset: number;
  destinations: PayoutDestination[];
}

export const listPayoutDestinations = (params: {
  status?: PayoutDestinationStatus;
  limit?: number;
  offset?: number;
}) => api<DestinationPage>('/admin/payout-destinations', { query: params });

/**
 * `verificationNote` is required, and is the record of how the number was
 * confirmed. Money goes here and does not come back, so "verified" with no
 * account of how is not something anyone can audit afterwards (§48).
 */
export const verifyPayoutDestination = (id: string, verificationNote: string) =>
  api<PayoutDestination>(`/admin/payout-destinations/${id}/verify`, {
    method: 'PATCH',
    body: { verificationNote },
  });

export const rejectPayoutDestination = (id: string, reason: string) =>
  api<PayoutDestination>(`/admin/payout-destinations/${id}/reject`, {
    method: 'PATCH',
    body: { reason },
  });

// ---------------------------------------------------------------------------
// Payouts (§35, §36, §46, §47)
// ---------------------------------------------------------------------------

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';

export interface Payout {
  id: string;
  businessId: string;
  /** The internal unit of account. REPORTING only — never what is sent. */
  amountMinor: number;
  currency: string;
  /** What is actually transferred, and the currency it is transferred in. */
  settlementCurrency: string;
  settlementAmountMinor: number;
  status: PayoutStatus;
  reference: string | null;
  failureReason: string | null;
  runAt: string;
  paidAt: string | null;
  createdAt: string;

  /** Our own id for an automated transfer, set before it is sent (§64.3). */
  providerReferenceId: string | null;
  sentAt: string | null;

  /**
   * Who is being paid and where the money goes (§65.1).
   *
   * On the row because a truncated business id and an amount are not enough to
   * pay anyone — which is why an admin used to export the CSV just to read a
   * name and a number the screen could have shown.
   */
  businessName: string | null;
  /** Null when there is no VERIFIED destination — which is also why it cannot be sent. */
  destinationMsisdn: string | null;
  destinationProvider: string | null;
}

export interface PayoutPage {
  total: number;
  limit: number;
  offset: number;
  payouts: Payout[];
}

export type PauseReason = string;

/** What a run did, and — as importantly — who it held back and why (§48.3). */
export interface RunSummary {
  runAt: string;
  businessesConsidered: number;
  payoutsCreated: number;
  totalMinor: number;
  settlementCurrencies: string[];
  skippedNonPositive: number;
  pausedForSuspension: number;
  pausedForUnverifiedDestination: number;
  pausedBusinesses: Array<{ businessId: string; reason: PauseReason }>;
  entriesWithoutSettlement: number;
}

export interface HeldTotals {
  asOf: string;
  bySettlementCurrency: Array<{
    settlementCurrency: string;
    amountMinor: number;
    entryCount: number;
    reportingInternalMinor: number;
  }>;
  entriesWithoutSettlement: number;
  totalEntries: number;
  note: string;
}

export const listPayouts = (params: { status?: PayoutStatus; limit?: number }) =>
  api<PayoutPage>('/admin/payouts', { query: params });

export const heldTotals = () => api<HeldTotals>('/admin/ledger/held');

export const runPayouts = () => api<RunSummary>('/admin/payouts/run', { method: 'POST' });

/**
 * The provider's reference is required: a payout marked paid with nothing to
 * look it up by cannot be reconciled against a statement, and the statement is
 * the only thing that proves the money left.
 */
export const markPayoutPaid = (id: string, reference: string) =>
  api<Payout>(`/admin/payouts/${id}/mark-paid`, { method: 'PATCH', body: { reference } });

/** Marking a payout failed puts its money back in the pool, so it needs a reason. */
export const markPayoutFailed = (id: string, reason: string) =>
  api<Payout>(`/admin/payouts/${id}/mark-failed`, { method: 'PATCH', body: { reason } });

/** The whole RUN this payout belongs to, as CSV — every transfer to make by hand. */
export const exportRunUrl = (id: string) => `/admin/payouts/${id}/export`;

/**
 * Sends ONE payout through the operator (§64.4).
 *
 * No batch equivalent, deliberately: a bug in a batch pays every business
 * wrongly before anyone notices; a bug here pays one and stops.
 */
export const sendPayout = (id: string) =>
  api<Payout>(`/admin/payouts/${id}/send`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Platform settings (§16.3, §37, §38, §40)
// ---------------------------------------------------------------------------

export interface PlatformFee {
  platformFeePercentage: string;
  updatedAt: string | null;
}

export interface ExchangeRateSettings {
  internalCurrency: string;
  providerCurrency: string;
  exchangeRateUsdToProviderCurrency: string | null;
  exchangeRateUpdatedAt: string | null;
  ageInHours: number | null;
  exchangeRateUpdatedBy: { id: string; email: string } | null;
  stalenessThresholdHours: number;
  /** False when the provider charges in the unit of account — nothing converts. */
  conversionInUse: boolean;
  stale: boolean;
  warning: string | null;
  configured: boolean;
  note: string;
}

export interface PayoutHold {
  payoutHoldDays: number;
  note: string;
}

export const getPlatformFee = () => api<PlatformFee>('/admin/settings/platform-fee');

/**
 * Applies to FUTURE bookings only (§16.3), and a RAISE is refused outright if
 * any active service has a deposit percentage below it (§40) — the response
 * names the offending services.
 */
export const setPlatformFee = (platformFeePercentage: number) =>
  api<PlatformFee>('/admin/settings/platform-fee', {
    method: 'PATCH',
    body: { platformFeePercentage },
  });

export const getExchangeRate = () =>
  api<ExchangeRateSettings>('/admin/settings/exchange-rate');

export const setExchangeRate = (
  exchangeRateUsdToProviderCurrency: number,
  providerCurrency?: string,
) =>
  api<ExchangeRateSettings>('/admin/settings/exchange-rate', {
    method: 'PATCH',
    body: { exchangeRateUsdToProviderCurrency, providerCurrency },
  });

export const setStaleness = (exchangeRateStalenessHours: number) =>
  api<ExchangeRateSettings>('/admin/settings/exchange-rate/staleness', {
    method: 'PATCH',
    body: { exchangeRateStalenessHours },
  });

export const getPayoutHold = () => api<PayoutHold>('/admin/settings/payout-hold');

/** The hold in force AT RESOLUTION TIME applies; dates already set stand (§38). */
export const setPayoutHold = (payoutHoldDays: number) =>
  api<PayoutHold>('/admin/settings/payout-hold', {
    method: 'PATCH',
    body: { payoutHoldDays },
  });

// ---------------------------------------------------------------------------
// Support tickets (§24)
// ---------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type TicketCategory =
  | 'APPOINTMENT_DISPUTE'
  | 'PAYMENT_ISSUE'
  | 'TECHNICAL_ISSUE'
  | 'ACCOUNT_ISSUE'
  | 'OTHER';

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
  /** An internal note. Never shown to the reporter — excluded by their query. */
  isInternal: boolean;
  author: { id: string; email: string; role: string } | null;
  attachments: TicketAttachment[];
}

export interface Ticket {
  id: string;
  reference: string;
  reporterId: string;
  reporterType: 'CUSTOMER' | 'BUSINESS';
  businessId: string | null;
  appointmentId: string | null;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assignedAdminId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  /** A file sent when the ticket was raised hangs off the ticket, not off the
   *  opening message; a reply's file hangs off that message. Both get shown. */
  attachments: TicketAttachment[];
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
}

export const listTickets = (params: { status?: TicketStatus; limit?: number }) =>
  api<{ total: number; tickets: Ticket[] }>('/admin/tickets', { query: params });

/** The one view that includes internal notes (§24.5). */
export const getTicket = (id: string) => api<TicketDetail>(`/admin/tickets/${id}`);

export const assignTicket = (id: string, assignedAdminId: string) =>
  api<Ticket>(`/admin/tickets/${id}/assign`, {
    method: 'PATCH',
    body: { assignedAdminId },
  });

/**
 * `isInternal` keeps a note off the reporter's view entirely — it is excluded
 * by their query, not hidden by a serialiser (§24.5).
 */
export const replyToTicket = (id: string, body: string, isInternal: boolean) =>
  api<TicketMessage>(`/admin/tickets/${id}/messages`, {
    method: 'POST',
    body: { body, isInternal },
  });

/**
 * Moves the ticket through its lifecycle (§24.3).
 *
 * Only the transitions the table permits: OPEN -> IN_PROGRESS -> RESOLVED ->
 * CLOSED. An admin cannot reopen — only the reporter can, within the window,
 * because an admin reopening their own resolution would defeat it.
 */
export const setTicketStatus = (
  id: string,
  status: TicketStatus,
  resolutionNote?: string,
) =>
  api<Ticket>(`/admin/tickets/${id}/status`, {
    method: 'PATCH',
    body: { status, resolutionNote },
  });

// ---------------------------------------------------------------------------
// Ledger and billing adjustments (§84)
// ---------------------------------------------------------------------------

export interface Currency {
  code: string;
  exponent: number;
  minorUnitsPerMajor: number;
  note: string;
}

/** Unauthenticated: the exponent is a property of the currency, not the caller. */
export const getCurrency = () =>
  api<Currency>('/payments/currency', { anonymous: true });

export type LedgerEntryType =
  | 'DEPOSIT_RECEIVED'
  | 'PLATFORM_FEE'
  | 'DEPOSIT_REFUND'
  | 'PLATFORM_FEE_REVERSAL'
  | 'GATEWAY_FEE_DEBIT'
  | 'ADJUSTMENT';

export interface LedgerEntry {
  id: string;
  businessId: string;
  appointmentId: string | null;
  type: LedgerEntryType;
  /** Signed from the BUSINESS's point of view: positive is owed to them (§34.2). */
  amountMinor: number;
  currency: string;
  settlementCurrency: string | null;
  settlementAmountMinor: number | null;
  bookingExchangeRate: string | null;
  /** Null until the appointment resolves and the hold expires (§34.3). */
  availableAt: string | null;
  payoutId: string | null;
  billingAdjustmentId: string | null;
  createdAt: string;
}

export interface CurrencyTotal {
  settlementCurrency: string;
  amountMinor: number;
  entryCount?: number;
  reportingInternalMinor?: number;
}

export interface LedgerPage {
  total: number;
  limit: number;
  offset: number;
  entries: LedgerEntry[];
  totalsBySettlementCurrency: CurrencyTotal[];
}

export type BillingAdjustmentType = 'FEE_REFUND' | 'GATEWAY_FEE_DEBIT';

export interface BillingAdjustment {
  id: string;
  businessId: string;
  appointmentId: string | null;
  ticketId: string | null;
  type: BillingAdjustmentType;
  /** A decimal string in MAJOR units — unlike ledger entries, which are minor. */
  amount: string;
  reason: string;
  settledAt: string | null;
  settlementRef: string | null;
  createdById: string;
  createdAt: string;
  ledgerEntries: Array<{
    id: string;
    amountMinor: number;
    settlementAmountMinor: number | null;
  }>;
}

export interface AdjustmentPage {
  total: number;
  limit: number;
  offset: number;
  /** How many are recorded but not yet executed. */
  outstanding: number;
  adjustments: BillingAdjustment[];
}

export const listLedgerEntries = (params: {
  businessId?: string;
  appointmentId?: string;
  payoutId?: string;
  type?: LedgerEntryType;
  limit?: number;
  offset?: number;
}) => api<LedgerPage>('/admin/ledger/entries', { query: params });

export const listAdjustments = (params: {
  businessId?: string;
  ticketId?: string;
  limit?: number;
  offset?: number;
}) => api<AdjustmentPage>('/admin/billing-adjustments', { query: params });

/**
 * Turns a recorded decision into money. Settling twice is refused by the
 * server with a 409, so this is safe to retry but not to repeat.
 *
 * Returns BOTH the settled adjustment and the ledger entry it appended —
 * checked against the running server, because typing it as a bare adjustment
 * would read as though nothing was written to the ledger.
 */
export const executeAdjustment = (id: string, settlementRef?: string) =>
  api<{ adjustment: BillingAdjustment; entry: LedgerEntry }>(
    `/admin/billing-adjustments/${id}/execute`,
    { method: 'PATCH', body: settlementRef ? { settlementRef } : {} },
  );

// ---------------------------------------------------------------------------
// Reconciliation: our figure beside the operator's (§87)
// ---------------------------------------------------------------------------

export type WalletBalance =
  | {
      wallet: 'COLLECTION' | 'DISBURSEMENT';
      status: 'OK';
      /** As the operator reported it: a decimal string in MAJOR units. */
      reportedAmount: string;
      currency: string;
      amountMinor: number | null;
    }
  | {
      wallet: 'COLLECTION' | 'DISBURSEMENT';
      status: 'UNAVAILABLE';
      reason: string;
    };

export interface Reconciliation {
  asOf: string;
  isSandbox: boolean;
  ledger: CurrencyTotal[];
  entriesWithoutSettlement: number;
  wallets: WalletBalance[];
  /** False whenever showing a difference would be a lie. */
  comparable: boolean;
  difference: number | null;
  notComparableReason:
    | 'SANDBOX'
    | 'DIFFERENT_CURRENCY'
    | 'BALANCE_UNAVAILABLE'
    | 'NOTHING_HELD'
    | null;
  note: string;
}

export const getReconciliation = () =>
  api<Reconciliation>('/admin/ledger/reconciliation');

// ---------------------------------------------------------------------------
// Review moderation (§93)
// ---------------------------------------------------------------------------

export interface ModeratedReview {
  id: string;
  rating: number;
  comment: string | null;
  editedAt: string | null;
  responseText: string | null;
  responseAt: string | null;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  hiddenByEmail: string | null;
  locationId: string;
  locationName: string;
  businessId: string;
  businessName: string | null;
  /** Identity, which only an admin and the counterparty business receive. */
  customerId: string;
  customerEmail: string;
  displayName: string;
}

export interface ModeratedReviewPage {
  total: number;
  limit: number;
  offset: number;
  /** Across the whole platform, not this page. */
  hiddenCount: number;
  reviews: ModeratedReview[];
}

/** The only listing that returns hidden reviews. */
export const listReviewsForModeration = (params: {
  visibility?: 'VISIBLE' | 'HIDDEN' | 'ALL';
  maxRating?: number;
  limit?: number;
}) => api<ModeratedReviewPage>('/admin/reviews', { query: params });

/** A reason is required: hiding feedback unexplained cannot be reviewed later. */
export const hideReview = (id: string, hiddenReason: string) =>
  api<unknown>(`/admin/reviews/${id}/hide`, {
    method: 'PATCH',
    body: { hiddenReason },
  });

export const unhideReview = (id: string) =>
  api<unknown>(`/admin/reviews/${id}/unhide`, { method: 'PATCH' });

// ---------------------------------------------------------------------------
// User directory (§94)
// ---------------------------------------------------------------------------

export interface DirectoryUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'BUSINESS' | 'CUSTOMER';
  displayName: string | null;
  createdAt: string;
  appointmentCount: number;
  reviewCount: number;
  ticketCount: number;
  businesses: Array<{ id: string; name: string | null; role: string }>;
}

export interface DirectoryPage {
  total: number;
  limit: number;
  offset: number;
  users: DirectoryUser[];
}

export const listUsers = (params: {
  role?: 'ADMIN' | 'BUSINESS' | 'CUSTOMER';
  search?: string;
  withDisplayName?: string;
  limit?: number;
}) => api<DirectoryPage>('/admin/users', { query: params });

/**
 * Clears the byline a customer chose. The only moderation action on a user, and
 * there is deliberately no edit: replacing a name with wording an admin
 * preferred would publish words under that customer's byline they never wrote.
 *
 * A reason is required, and the customer is told it.
 */
export const clearDisplayName = (id: string, reason: string) =>
  api<DirectoryUser>(`/admin/users/${id}/display-name/clear`, {
    method: 'PATCH',
    body: { reason },
  });

// ---------------------------------------------------------------------------
// Appointments, and reclassifying a cancellation (§95)
// ---------------------------------------------------------------------------

export type CancelledBy = 'CUSTOMER' | 'BUSINESS' | 'SYSTEM_EXPIRY';

export type AppointmentStatus =
  | 'PENDING_PAYMENT'
  | 'BOOKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface AdminAppointment {
  id: string;
  status: AppointmentStatus;
  startTime: string;
  endTime: string;
  currency: string;
  depositAmountMinor: number;
  platformFeeAmountMinor: number;
  businessAmountMinor: number;
  depositPaid: boolean;
  cancelledAt: string | null;
  cancelledBy: CancelledBy | null;
  cancellationReason: string | null;
  cancellationTicketId: string | null;
  customerId: string;
  customerEmail: string;
  serviceName: string;
  locationId: string;
  locationName: string;
  businessId: string;
  businessName: string | null;
  /** Computed by the server, so it cannot disagree with what the PATCH accepts. */
  canReclassify: boolean;
}

export interface AdminAppointmentPage {
  total: number;
  limit: number;
  offset: number;
  appointments: AdminAppointment[];
}

export const listAdminAppointments = (params: {
  status?: AppointmentStatus;
  cancelledBy?: CancelledBy;
  reclassifiable?: string;
  limit?: number;
}) => api<AdminAppointmentPage>('/admin/appointments', { query: params });

/**
 * Says a cancellation was the business's fault, which **moves money**: the
 * customer is refunded in full including our fee, and the business carries the
 * operator's charge for the refund (§25).
 *
 * One direction only. There is no endpoint to undo this.
 */
export const reclassifyAsBusinessCancellation = (
  id: string,
  body: { reason: string; gatewayChargeMinor: number; ticketId?: string },
) =>
  api<AdminAppointment>(`/admin/appointments/${id}/business-cancellation`, {
    method: 'PATCH',
    body,
  });

// ---------------------------------------------------------------------------
// Notifications (§96)
//
// One inbox per account, whatever the role: the server guards these with the
// JWT alone and scopes every query to the caller's own id.
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  appointmentId: string | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  total: number;
  /** Unread across the whole inbox, not this page. */
  unread: number;
  limit: number;
  offset: number;
  notifications: Notification[];
}

export const listNotifications = (params: { unreadOnly?: boolean; limit?: number } = {}) =>
  api<NotificationPage>('/notifications', { query: params });

export const markNotificationRead = (id: string) =>
  api<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () =>
  api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });

/**
 * Which mobile money operators this deployment can actually take money through
 * (§96). Unauthenticated, because the answer is a property of the deployment.
 */
export const getPaymentProviders = () =>
  api<{ providers: string[]; suggested: string | null; choiceRequired: boolean }>(
    '/payments/providers',
    { anonymous: true },
  );

// ---------------------------------------------------------------------------
// Categories a business may choose (§98)
// ---------------------------------------------------------------------------

export interface AdminCategory {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isLive: boolean;
  /** Already in it. Shown before switching it off. */
  businessCount: number;
  subcategoryCount: number;
}

export const listAdminCategories = () => api<AdminCategory[]>('/admin/categories');

export const setCategoryLive = (id: string, isLive: boolean) =>
  api<{ message: string }>(`/admin/categories/${id}/live`, {
    method: 'PATCH',
    body: { isLive },
  });

// ---------------------------------------------------------------------------
// Administrators inviting administrators (§99)
// ---------------------------------------------------------------------------

export interface AdminInvitation {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  invitedBy: { email: string } | null;
}

/** All of these are refused to anyone but the primary administrator. */
export const inviteAdmin = (email: string) =>
  api<AdminInvitation>('/admin/users/invite', { method: 'POST', body: { email } });

export const listAdminInvitations = () =>
  api<AdminInvitation[]>('/admin/users/invitations');

export const revokeAdminInvitation = (id: string) =>
  api<{ message: string }>(`/admin/users/invitations/${id}`, { method: 'DELETE' });

export const revokeAdminAccess = (userId: string) =>
  api<{ message: string }>(`/admin/users/${userId}/admin-access`, { method: 'DELETE' });
