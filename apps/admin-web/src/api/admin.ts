import { api } from './client';
import type { components } from './schema';

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

/** From the contract (§128). */
export type AdminBusiness = components['schemas']['AdminBusinessDto'];


export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  businesses: T[];
}

export const listBusinesses = (params: {
  status?: BusinessStatus;
  /** Part of the name, the phone, or a member's email (§244). */
  q?: string;
  /** Whether the shop has sent itself for review (§255) — "true" is the queue, "false" is still setting up. */
  submitted?: 'true' | 'false';
  limit?: number;
  offset?: number;
}) => api<Page<AdminBusiness>>('/admin/businesses', { query: params });

/**
 * One business, in full (§117.2).
 *
 * The list row carries a name and a status; this carries what is actually being
 * approved — where they work from, what they sell and for how much at each
 * branch, and who can act for them. Approval is the gate that makes a business
 * visible to every customer, and until now it was made from a table row.
 */
/** From the contract (§128). */
export type AdminBusinessDetail = components['schemas']['AdminBusinessDetailDto'];


export const getBusiness = (id: string) =>
  api<AdminBusinessDetail>(`/admin/businesses/${id}`);

/** With advice for the shop, if any is sent (§303): which things still missing to mention, and a note. */
export const approveBusiness = (id: string, advice: components['schemas']['ApproveBusinessDto'] = {}) =>
  api<AdminBusiness>(`/admin/businesses/${id}/approve`, { method: 'PATCH', body: advice });

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

export type PayoutDestination = components['schemas']['AdminPayoutDestinationDto'];

export type DestinationPage = components['schemas']['AdminPayoutDestinationPageDto'];

export const listPayoutDestinations = (params: {
  status?: PayoutDestinationStatus;
  /** A number (any form), a shop, a place, or who gave it (§289). */
  q?: string;
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

/**
 * Derived from the contract, not hand-written (§128).
 *
 * `PauseReason` used to be `string` here while the backend had an enum — the
 * kind of quiet widening deriving these types exists to stop.
 */
export type PayoutStatus = components['schemas']['AdminPayoutDto']['status'];
export type Payout = components['schemas']['AdminPayoutDto'];
export type PayoutPage = components['schemas']['AdminPayoutPageDto'];
export type RunSummary = components['schemas']['PayoutRunSummaryDto'];
export type PauseReason = RunSummary['pausedBusinesses'][number]['reason'];
export type BusinessBalance = components['schemas']['BusinessBalanceDto'];

export type HeldTotals = components['schemas']['HeldTotalsDto'];

/** `q`: a shop, a place, a payout number (any form) or a reference (§289). */
export const listPayouts = (params: { status?: PayoutStatus; q?: string; limit?: number; offset?: number }) =>
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

/** Derived from the contract (§128). */
export type PlatformFee = components['schemas']['PlatformFeeDto'];
export type ExchangeRateSettings = components['schemas']['ExchangeRateSettingsDto'];
export type PayoutHold = components['schemas']['PayoutHoldDto'];

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

export type TicketStatus = Ticket['status'];
export type TicketCategory = Ticket['category'];

/**
 * Derived from the contract (§128).
 *
 * `attachments` is on the DETAIL type only — the listing's select carries none
 * (§128.31). `TicketMessage.author` was typed nullable here and is not.
 */
export type TicketAttachment = components['schemas']['TicketAttachmentDto'];
export type TicketMessage = components['schemas']['TicketMessageDto'];
export type Ticket = components['schemas']['TicketDto'];
export type TicketDetail = components['schemas']['TicketDetailDto'];
export type TicketPage = components['schemas']['TicketPageDto'];
export type PostedTicketMessage = components['schemas']['PostedTicketMessageDto'];

/** A ticket as the inbox lists it: its reporter, shop and latest word (§247). */
export type AdminTicket = components['schemas']['AdminTicketDto'];
export type AdminTicketDetail = components['schemas']['AdminTicketDetailDto'];

export const listTickets = (params: {
  status?: TicketStatus;
  /** A reference, subject, reporter's email or shop name (§247). */
  q?: string;
  assignedAdminId?: string;
  /** One person's or one shop's, still being dealt with — for a support action to answer (§297). */
  reporterId?: string;
  businessId?: string;
  open?: 'true';
  limit?: number;
  offset?: number;
}) => api<components['schemas']['AdminTicketPageDto']>('/admin/tickets', { query: params });

/** The one view that includes internal notes (§24.5), and the booking a ticket is about (§247). */
export const getTicket = (id: string) => api<AdminTicketDetail>(`/admin/tickets/${id}`);

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

export type Currency = components['schemas']['CurrencyDto'];

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

export type LedgerEntry = components['schemas']['LedgerEntryDto'];
export type LedgerPage = components['schemas']['LedgerEntryPageDto'];

/**
 * Two DIFFERENT shapes, which this file used to blur into one optional-field
 * `CurrencyTotal` (§128.22).
 *
 * A held total counts entries; a filtered total does not and its currency can
 * be null, because the column it is grouped by is nullable.
 */
export type HeldCurrencyTotal = components['schemas']['HeldCurrencyDto'];
export type FilteredCurrencyTotal = components['schemas']['SettlementTotalDto'];

export type BillingAdjustmentType = BillingAdjustment['type'];
export type BillingAdjustment = components['schemas']['AdjustmentDto'];
export type AdjustmentPage = components['schemas']['AdjustmentPageDto'];
export type ExecutedAdjustment = components['schemas']['ExecutedAdjustmentDto'];

export type AdminLedgerEntry = components['schemas']['AdminLedgerEntryDto'];

export const listLedgerEntries = (params: {
  businessId?: string;
  appointmentId?: string;
  payoutId?: string;
  type?: LedgerEntryType;
  /** Part of a shop's name (§251). */
  q?: string;
  /** ISO instants: written at or after `from`, before `to` (§251). */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) => api<LedgerPage>('/admin/ledger/entries', { query: params });

export const listAdjustments = (params: {
  businessId?: string;
  ticketId?: string;
  state?: 'outstanding' | 'executed';
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

export type Reconciliation = components['schemas']['ReconciliationDto'];
export type WalletBalance = Reconciliation['wallets'][number];
export type NotComparableReason = Reconciliation['notComparableReason'];

export const getReconciliation = () =>
  api<Reconciliation>('/admin/ledger/reconciliation');

// ---------------------------------------------------------------------------
// Review moderation (§93)
// ---------------------------------------------------------------------------

export type ModeratedReview = components['schemas']['AdminReviewDto'];

export type ModeratedReviewPage = components['schemas']['AdminReviewPageDto'];

export type ReviewOrder = 'newest' | 'oldest' | 'lowest' | 'highest';

/** The only listing that returns hidden reviews. */
export const listReviewsForModeration = (params: {
  visibility?: 'VISIBLE' | 'HIDDEN' | 'ALL';
  maxRating?: number;
  rating?: number;
  businessId?: string;
  q?: string;
  sort?: ReviewOrder;
  limit?: number;
  offset?: number;
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

/**
 * Derived from the contract (§128).
 *
 * `clearDisplayName` used to be typed as returning one of these. It does not —
 * the server answers with three fields, so the counts this type promises would
 * all have been `undefined` on that path.
 */
export type DirectoryUser = components['schemas']['AdminUserDto'];
export type DirectoryPage = components['schemas']['AdminUserPageDto'];
export type ClearedDisplayName = components['schemas']['ClearedDisplayNameDto'];

export const listUsers = (params: {
  role?: 'ADMIN' | 'BUSINESS' | 'CUSTOMER';
  search?: string;
  withDisplayName?: string;
  limit?: number;
  offset?: number;
}) => api<DirectoryPage>('/admin/users', { query: params });

/**
 * Clears the byline a customer chose. The only moderation action on a user, and
 * there is deliberately no edit: replacing a name with wording an admin
 * preferred would publish words under that customer's byline they never wrote.
 *
 * A reason is required, and the customer is told it.
 */
export const clearDisplayName = (id: string, reason: string) =>
  api<ClearedDisplayName>(`/admin/users/${id}/display-name/clear`, {
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

export type AdminAppointment = components['schemas']['AdminAppointmentDto'];

export type AdminAppointmentPage = components['schemas']['AdminAppointmentPageDto'];

export type AdminAppointmentDetail = components['schemas']['AdminAppointmentDetailDto'];

export const listAdminAppointments = (params: {
  status?: AppointmentStatus;
  cancelledBy?: CancelledBy;
  reclassifiable?: string;
  businessId?: string;
  customerId?: string;
  q?: string;
  sort?: 'soonest' | 'latest';
  limit?: number;
  offset?: number;
}) => api<AdminAppointmentPage>('/admin/appointments', { query: params });

/** One booking, with its payment, steps, ledger lines, review and tickets (§249). */
export const getAdminAppointment = (id: string) => api<AdminAppointmentDetail>(`/admin/appointments/${id}`);

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
// Support acting for a shop or a customer (§297)
//
// Each takes a reason — the only record of why — and, when it answers a help
// request, that request: a note saying what was done is written into it.
// ---------------------------------------------------------------------------

export type SupportBody = { reason: string; ticketId?: string };
export type SupportAction = components['schemas']['SupportActionDto'];
export type SupportConversation = components['schemas']['SupportConversationDto'];
export type SupportPaymentCheck = components['schemas']['SupportPaymentCheckDto'];
export type SupportShop = components['schemas']['SupportShopDto'];
export type SupportPerson = components['schemas']['SupportPersonDto'];
type Done = components['schemas']['SupportDoneDto'];

const supportPost = <T>(path: string, body: object) => api<T>(path, { method: 'POST', body });

export const supportCheckIn = (id: string, body: SupportBody & { code?: string }) =>
  supportPost<unknown>(`/admin/appointments/${id}/check-in`, body);
export const supportComplete = (id: string, body: SupportBody & { code?: string }) =>
  supportPost<unknown>(`/admin/appointments/${id}/complete`, body);
export const supportFixNoShow = (id: string, body: SupportBody) =>
  supportPost<unknown>(`/admin/appointments/${id}/fix-no-show`, body);
export const supportCancelForCustomer = (id: string, body: SupportBody) =>
  supportPost<unknown>(`/admin/appointments/${id}/cancel-for-customer`, body);
/** Cancels for the shop: a live booking, or a cancellation the shop caused. Refunds when a deposit was paid. */
export const supportCancelForShop = (id: string, body: SupportBody & { gatewayChargeMinor?: number }) =>
  api<unknown>(`/admin/appointments/${id}/business-cancellation`, { method: 'PATCH', body });
export const supportResendCode = (id: string, body: SupportBody) =>
  supportPost<Done>(`/admin/appointments/${id}/resend-code`, body);
export const supportCheckPayment = (id: string, ticketId?: string) =>
  supportPost<SupportPaymentCheck>(`/admin/appointments/${id}/check-payment`, ticketId ? { ticketId } : {});
/** The booking's conversation. Reading it is written down, and shown on the booking. */
export const supportReadMessages = (id: string, body: SupportBody) =>
  supportPost<SupportConversation>(`/admin/appointments/${id}/messages`, body);

/** A booking's private answers (§300.6), read with a reason — written down and shown on the booking. */
export type SupportPrivateAnswers = components['schemas']['SupportPrivateAnswersDto'];
export const supportReadPrivateAnswers = (id: string, body: SupportBody) =>
  supportPost<SupportPrivateAnswers>(`/admin/appointments/${id}/private-answers`, body);

export const supportHistory = (filter: { appointmentId?: string; businessId?: string; userId?: string; ticketId?: string }) =>
  api<components['schemas']['SupportHistoryDto']>('/admin/support-actions', { query: filter });

export const getSupportShop = (id: string) => api<SupportShop>(`/admin/support/businesses/${id}`);
export const supportPauseShop = (id: string, paused: boolean, body: SupportBody) =>
  supportPost<components['schemas']['SupportPausedDto']>(
    `/admin/support/businesses/${id}/${paused ? 'pause' : 'resume'}`,
    body,
  );
export const supportRevokeInvitation = (id: string, invitationId: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/businesses/${id}/invitations/${invitationId}/revoke`, body);
export const supportResendInvitation = (id: string, invitationId: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/businesses/${id}/invitations/${invitationId}/resend`, body);
export const supportRemoveMember = (id: string, membershipId: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/businesses/${id}/members/${membershipId}/remove`, body);
/** The primary administrator only, with a fresh code (§279). */
export const supportTransferOwnership = (id: string, body: SupportBody & { membershipId: string }) =>
  supportPost<Done>(`/admin/support/businesses/${id}/transfer-ownership`, body);

export const getSupportPerson = (id: string) => api<SupportPerson>(`/admin/support/people/${id}`);
export const supportSignOutEverywhere = (id: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/people/${id}/sign-out-everywhere`, body);
export const supportStopMarketing = (id: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/people/${id}/stop-marketing`, body);
/** Cannot be undone; needs a fresh code (§279). */
export const supportCloseAccount = (id: string, body: SupportBody) =>
  supportPost<Done>(`/admin/support/people/${id}/close`, body);

/** Ties a help request to the booking it is about, or unties it (null). */
export const linkTicketBooking = (ticketId: string, appointmentId: string | null) =>
  api<AdminTicketDetail>(`/admin/tickets/${ticketId}/link`, { method: 'PATCH', body: { appointmentId } });

// ---------------------------------------------------------------------------
// Notifications (§96)
//
// One inbox per account, whatever the role: the server guards these with the
// JWT alone and scopes every query to the caller's own id.
// ---------------------------------------------------------------------------

export type Notification = components['schemas']['NotificationDto'];

export type NotificationPage = components['schemas']['NotificationPageDto'];

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

export type AdminSubcategory = components['schemas']['AdminSubcategoryDto'];

export type AdminCategory = components['schemas']['AdminCategoryDto'];

/** A category's or a type's words in Kinyarwanda and French, as typed here (§308.3). */
export type TaxonomyTranslations = components['schemas']['TaxonomyTranslationsResponseDto'];

export const listAdminCategories = () => api<AdminCategory[]>('/admin/categories');

export const setCategoryLive = (id: string, isLive: boolean) =>
  api<{ message: string }>(`/admin/categories/${id}/live`, {
    method: 'PATCH',
    body: { isLive },
  });

export const createCategory = (body: {
  name: string;
  icon?: string;
  description?: string;
}) => api<AdminCategory>('/admin/categories', { method: 'POST', body });

export const updateCategory = (
  id: string,
  body: { name?: string; icon?: string; description?: string; translations?: TaxonomyTranslations },
) => api<AdminCategory>(`/admin/categories/${id}`, { method: 'PATCH', body });

/** What shops wrote under "Other", grouped, most-written first (§267). */
export type WriteIn = components['schemas']['AdminWriteInDto'];
export const listWriteIns = () => api<WriteIn[]>('/admin/categories/write-ins');

/** Makes a write-in a type of its own and moves the shops that wrote it into it (§267). */
export const promoteWriteIn = (categoryId: string, label: string, name: string) =>
  api<components['schemas']['PromotedWriteInDto']>(`/admin/categories/${categoryId}/write-ins/promote`, {
    method: 'POST',
    body: { label, name },
  });

export const createSubcategory = (categoryId: string, name: string) =>
  api<AdminSubcategory>(`/admin/categories/${categoryId}/subcategories`, {
    method: 'POST',
    body: { name },
  });

export const updateSubcategory = (id: string, name: string, translations?: TaxonomyTranslations) =>
  api<AdminSubcategory>(`/admin/subcategories/${id}`, {
    method: 'PATCH',
    body: { name, ...(translations ? { translations } : {}) },
  });

export const setSubcategoryLive = (id: string, isLive: boolean) =>
  api<{ message: string }>(`/admin/subcategories/${id}/live`, {
    method: 'PATCH',
    body: { isLive },
  });


// ---------------------------------------------------------------------------
// Administrators inviting administrators (§99)
// ---------------------------------------------------------------------------

export type AdminInvitation = components['schemas']['AdminInvitationDto'];

export type ActionMessage = components['schemas']['ActionMessageDto'];

/** All of these are refused to anyone but the primary administrator. */
export const inviteAdmin = (email: string) =>
  api<AdminInvitation>('/admin/users/invite', { method: 'POST', body: { email } });

export const listAdminInvitations = () =>
  api<AdminInvitation[]>('/admin/users/invitations');

export const revokeAdminInvitation = (id: string) =>
  api<ActionMessage>(`/admin/users/invitations/${id}`, { method: 'DELETE' });

/** For an administrator who lost their phone and recovery codes (§298). The primary administrator only, with a fresh code. */
export const resetTwoStep = (userId: string) =>
  api<{ message: string }>(`/admin/users/${userId}/two-step/reset`, { method: 'POST' });

export const revokeAdminAccess = (userId: string) =>
  api<ActionMessage>(`/admin/users/${userId}/admin-access`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Where the platform is open (§105)
// ---------------------------------------------------------------------------

export type AdminDistrict = components['schemas']['AdminDistrictDto'];

export type AdminProvince = components['schemas']['AdminProvinceDto'];

/** The only listing that shows retired districts. */
export const listAdminPlaces = () => api<AdminProvince[]>('/admin/places/provinces');

export const createDistrict = (body: {
  provinceId: string;
  name: string;
  code: string;
}) => api<AdminDistrict>('/admin/places/districts', { method: 'POST', body });

export const renameDistrict = (id: string, name: string) =>
  api<AdminDistrict>(`/admin/places/districts/${id}`, { method: 'PATCH', body: { name } });

export const setDistrictLive = (id: string, isLive: boolean) =>
  api<{ message: string }>(`/admin/places/districts/${id}/live`, {
    method: 'PATCH',
    body: { isLive },
  });

// ---------------------------------------------------------------------------
// Legal documents (§122)
// ---------------------------------------------------------------------------

export type LegalKind = 'TERMS_OF_USE' | 'PRIVACY_POLICY' | 'SELLER_AGREEMENT';

export type LegalDocument = components['schemas']['AdminLegalDocumentDto'];

export const listLegalDocuments = () => api<LegalDocument[]>('/admin/legal');

/** Starts the next version, or hands back the draft already going. */
export const startLegalDraft = (kind: LegalKind) =>
  api<LegalDocument>('/admin/legal/drafts', { method: 'POST', body: { kind } });

export const updateLegalDraft = (
  id: string,
  body: { title?: string; body?: string; changeNote?: string },
) => api<LegalDocument>(`/admin/legal/drafts/${id}`, { method: 'PATCH', body });

/** From here it is read-only forever. A change is a new version. */
export const publishLegalDraft = (id: string) =>
  api<LegalDocument>(`/admin/legal/drafts/${id}/publish`, { method: 'POST' });

// ---------------------------------------------------------------------------
// The sign-in wall (§238, §254): the same public lists the business app's uses
// ---------------------------------------------------------------------------

export type DiscoveredServicePage = components['schemas']['DiscoveredServicePageDto'];

/** The services customers book most, for their photos behind signing in. */
export const wallServices = () =>
  api<DiscoveredServicePage>('/discover/services', { query: { sort: 'popular', limit: 50 }, anonymous: true });

export type DiscoveryPage = components['schemas']['DiscoveryPageDto'];

/** How many places take bookings, for the line under the headline. */
export const wallPlaces = () =>
  api<DiscoveryPage>('/discover/locations', { query: { sort: 'popular', limit: 12 }, anonymous: true });

// ---------------------------------------------------------------------------
// The console's home page (§243)
// ---------------------------------------------------------------------------

/** Everything waiting, the last fourteen days, and the platform's size — one request. */
export type AdminOverview = components['schemas']['AdminOverviewDto'];
export type OverviewDay = components['schemas']['OverviewDayDto'];
export type OverviewPeriod = components['schemas']['OverviewPeriodDto'];

export const getOverview = () => api<AdminOverview>('/admin/overview');

/** Shops' stories (§285): the reported ones, most reported first, or every one up now. */
export type AdminStory = components['schemas']['AdminStoryDto'];
export type AdminStories = components['schemas']['AdminStoriesDto'];
export type StoryView = 'reported' | 'live';

export const listAdminStories = (view: StoryView) => api<AdminStories>('/admin/stories', { query: { view } });

/** Takes one down at once; the shop is told, with the reason. */
export const removeStory = (id: string, reason: string) =>
  api<ActionMessage>(`/admin/stories/${id}/remove`, { method: 'POST', body: { reason } });

/** Looked at and fine: the reports are cleared and it stays up. */
export const keepStory = (id: string) => api<ActionMessage>(`/admin/stories/${id}/keep`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Writing to people (§287)
// ---------------------------------------------------------------------------

export type Announcement = components['schemas']['AnnouncementDto'];
export type AnnouncementReach = components['schemas']['AnnouncementReachDto'];
export type AnnouncementDraft = components['schemas']['SaveAnnouncementDto'];

export const listAnnouncements = () => api<components['schemas']['AnnouncementListDto']>('/admin/announcements');
export const getAnnouncement = (id: string) => api<Announcement>(`/admin/announcements/${id}`);
export const announcementReach = (draft: AnnouncementDraft) =>
  api<AnnouncementReach>('/admin/announcements/reach', { method: 'POST', body: draft });
export const createAnnouncement = (draft: AnnouncementDraft) =>
  api<Announcement>('/admin/announcements', { method: 'POST', body: draft });
export const updateAnnouncement = (id: string, draft: AnnouncementDraft) =>
  api<Announcement>(`/admin/announcements/${id}`, { method: 'PATCH', body: draft });
export const testAnnouncement = (id: string) =>
  api<ActionMessage>(`/admin/announcements/${id}/test`, { method: 'POST' });
export const sendAnnouncement = (id: string, body: { at?: string; confirmCount?: number }) =>
  api<Announcement>(`/admin/announcements/${id}/send`, { method: 'POST', body });
export const cancelAnnouncement = (id: string) =>
  api<Announcement>(`/admin/announcements/${id}/cancel`, { method: 'POST' });

/** Writes first to one customer or seller — as a support conversation they can answer. */
export const startConversation = (body: components['schemas']['StartTicketDto']) =>
  api<components['schemas']['StartedTicketDto']>('/admin/tickets/start', { method: 'POST', body });

// What this administrator is sent, and how.
export type NotificationSettings = components['schemas']['NotificationSettingsDto'];
export const getNotificationSettings = () => api<NotificationSettings>('/notifications/settings');
export const updateNotificationSettings = (change: components['schemas']['UpdateNotificationSettingsDto']) =>
  api<NotificationSettings>('/notifications/settings', { method: 'PATCH', body: change });
