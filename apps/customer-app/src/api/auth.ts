import { api, tokens, type AuthenticatedUser, type TokenPair } from './client';

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
