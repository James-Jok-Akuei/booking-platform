import { api, tokens, type AuthenticatedUser, type TokenPair } from './client';
import { uploadFile } from '../upload';
import type { components } from './schema';

/**
 * The signed-in account.
 *
 * `displayName` is the byline on this person's reviews (§31). It lives on the
 * user rather than on each review, which is why changing it rewrites every
 * review they have ever left — and why the only place to set it is the review
 * form. There is no endpoint for a customer to change it on its own, and
 * clearing it is an admin's moderation action.
 */
export interface Me {
  id: string;
  email: string;
  role: 'ADMIN' | 'BUSINESS' | 'CUSTOMER';
  createdAt: string;
  displayName: string | null;
  /** Shown to them and to nobody else (§124.1). */
  imageUrl: string | null;
}

export const getMe = () => api<Me>('/users/me');

/**
 * Step one. No role is sent for an existing account — role belongs to
 * registration, and sending it once locked every administrator out (§50).
 * A customer with no account yet registers by sending CUSTOMER explicitly.
 */
export const requestOtp = (email: string, role?: 'CUSTOMER') =>
  api<{ message?: string }>('/auth/otp/request', {
    method: 'POST',
    body: role ? { email, role } : { email },
    anonymous: true,
  });

export async function verifyOtp(email: string, code: string): Promise<AuthenticatedUser> {
  const result = await api<TokenPair & { user: AuthenticatedUser }>('/auth/otp/verify', {
    method: 'POST',
    body: { email, code },
    anonymous: true,
  });
  await tokens.set({ accessToken: result.accessToken, refreshToken: result.refreshToken }, result.user);
  return result.user;
}

export async function signOut(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST', body: { refreshToken: tokens.refresh } });
  } catch {
    // A failed logout must still clear the device. The refresh token expires
    // on its own; a session that cannot be ended locally is worse.
  }
  await tokens.clear();
}

/**
 * Everything the platform holds about this person (§119.2).
 *
 * Assembled on request rather than emailed: a copy someone receives while they
 * are still looking at the screen is a copy they actually read.
 */
export const exportMyData = () =>
  api<{
    exportedAt: string;
    account: { id: string; email: string; role: string; displayName: string | null; createdAt: string };
    bookings: unknown[];
    reviews: unknown[];
    conversations: unknown[];
    supportTickets: unknown[];
  }>('/users/me/export');

/**
 * Closes this account for good. Not a delete, and the message says what that
 * means: the bookings and reviews stay with the shops they belong to, without a
 * name on them.
 *
 * Refused while a booking is still to come, and for the only owner of a
 * business — both with a sentence explaining what to do first.
 */
export const closeMyAccount = () =>
  api<{ message: string }>('/users/me/close', { method: 'POST' });

// ---------------------------------------------------------------------------
// Legal documents (§122)
// ---------------------------------------------------------------------------

/** From the contract (§128). */
export type LegalDocument = components['schemas']['LegalDocumentDto'];


/** From the contract (§128). */
export type LegalStatus = components['schemas']['LegalStatusDto'];


/** Readable with no account at all — agreeing before reading is worth nothing. */
export const listLegal = () => api<LegalDocument[]>('/legal', { anonymous: true });

export const myLegalStatus = () => api<LegalStatus[]>('/legal/me');

export const acceptLegal = (documentId: string) =>
  api<{ documentId: string; kind: string; version: number }>('/legal/me/accept', {
    method: 'POST',
    body: { documentId },
  });

// ---------------------------------------------------------------------------
// A picture, and the numbers you pay from (§124)
// ---------------------------------------------------------------------------

/**
 * Uploaded, never a linked URL — the rule a business logo follows (§88).
 *
 * Through `uploadFile`, not `api()`: Expo's fetch cannot convert a React Native
 * file part and throws "Unsupported FormDataPart implementation" (§125.2).
 */
export const setMyImage = (photo: { uri: string; type: string }) =>
  uploadFile<{ id: string; imageUrl: string }>('/users/me/image', {
    uri: photo.uri,
    mimeType: photo.type,
  });

export const removeMyImage = () =>
  api<{ id: string; imageUrl: string | null }>('/users/me/image', { method: 'DELETE' });

export interface SavedNumber {
  id: string;
  phoneNumber: string;
  provider: string | null;
  label: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * Numbers used before. A keyboard shortcut, NOT a stored payment method: MTN
 * charges by prompting the handset, so nothing kept here can be used by anybody
 * who is not holding the phone (§124.2).
 */
export const listSavedNumbers = () => api<SavedNumber[]>('/users/me/payment-numbers');

export const saveNumber = (body: { phoneNumber: string; label?: string }) =>
  api<SavedNumber>('/users/me/payment-numbers', { method: 'POST', body });

export const removeSavedNumber = (id: string) =>
  api<{ message: string }>(`/users/me/payment-numbers/${id}`, { method: 'DELETE' });
