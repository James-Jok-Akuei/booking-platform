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

export type PayoutStatus = 'PENDING' | 'PAID' | 'FAILED';

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
