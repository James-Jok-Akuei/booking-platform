import type { components } from './schema';
import * as SecureStore from 'expo-secure-store';

/**
 * The HTTP client, ported from the two web apps (§102).
 *
 * The same three things that are easy to get subtly wrong — attaching the
 * token, refreshing it, and giving up — are done here once, exactly as in
 * `admin-web` and `business-web`. Two differences, both because this is a
 * phone:
 *
 * 1. Tokens live in **SecureStore**, not `localStorage`. On iOS that is the
 *    Keychain and on Android the EncryptedSharedPreferences — a refresh token
 *    on a device that may be lost or shared deserves better than plain storage.
 * 2. SecureStore is **async**, so the token cache is held in memory and
 *    rehydrated once at startup. Every request would otherwise await a
 *    Keychain read.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const ACCESS_KEY = 'booking.accessToken';
const REFRESH_KEY = 'booking.refreshToken';
const USER_KEY = 'booking.user';

export type TokenPair = components['schemas']['TokenPairDto'];

export type AuthenticatedUser = components['schemas']['AuthenticatedUserDto'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Mirrors what is in SecureStore, so a request never awaits the Keychain. */
const cache: { access: string | null; refresh: string | null; user: AuthenticatedUser | null } = {
  access: null,
  refresh: null,
  user: null,
};

export const tokens = {
  get access() {
    return cache.access;
  },
  get refresh() {
    return cache.refresh;
  },
  get user() {
    return cache.user;
  },

  /** Read once at startup, before anything renders that depends on being signed in. */
  async hydrate(): Promise<AuthenticatedUser | null> {
    const [access, refresh, user] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    cache.access = access;
    cache.refresh = refresh;
    try {
      cache.user = user ? (JSON.parse(user) as AuthenticatedUser) : null;
    } catch {
      // A corrupt blob is not a reason to refuse to start; it is a reason to
      // sign in again.
      cache.user = null;
    }
    return cache.user;
  },

  async set(pair: TokenPair, user?: AuthenticatedUser) {
    cache.access = pair.accessToken;
    cache.refresh = pair.refreshToken;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, pair.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken),
    ]);
    if (user) {
      cache.user = user;
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    }
  },

  async clear() {
    cache.access = null;
    cache.refresh = null;
    cache.user = null;
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};

/** Fired when the session ends, so the UI can send the person to sign in. */
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionEnded(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  // Returns void, not Set.delete's boolean: this is used as a React effect
  // cleanup, and an effect cleanup that returns a value is a type error at
  // every call site.
  return () => {
    sessionListeners.delete(listener);
  };
}

async function endSession() {
  await tokens.clear();
  for (const listener of sessionListeners) listener();
}

/**
 * One refresh at a time.
 *
 * Several requests can 401 together — a screen usually fires three. Without
 * this they would each refresh, and all but one of the new refresh tokens
 * would be discarded, which on a rotating-refresh backend logs the person out.
 */
let refreshInFlight: Promise<TokenPair> | null = null;

async function refreshTokens(): Promise<TokenPair> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = tokens.refresh;
    if (!refresh) throw new ApiError(401, 'No refresh token.');

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!response.ok) throw new ApiError(response.status, 'Could not refresh the session.');

    const pair = (await response.json()) as TokenPair;
    await tokens.set(pair);
    return pair;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the bearer token — discovery and the auth endpoints need this. */
  anonymous?: boolean;
}

/**
 * One request, with the token attached and exactly ONE retry after a refresh.
 *
 * A second 401 after a successful refresh means the token is fine and the
 * account genuinely may not do this, so retrying again would loop forever
 * against a server that is answering correctly.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous } = options;

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const isForm = body instanceof FormData;
  const send = (token: string | null) =>
    fetch(url.toString(), {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined
        ? { body: isForm ? (body as FormData) : JSON.stringify(body) }
        : {}),
    });

  let response = await send(anonymous ? null : tokens.access);

  if (response.status === 401 && !anonymous && tokens.refresh) {
    try {
      const pair = await refreshTokens();
      response = await send(pair.accessToken);
    } catch {
      await endSession();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
  }

  if (response.status === 401 && !anonymous) {
    await endSession();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    // Nest puts the useful sentence in `message`, a string for most errors and
    // an array for validation failures.
    const raw = (payload as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join(' ') : (raw ?? response.statusText);
    throw new ApiError(response.status, message, payload);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
