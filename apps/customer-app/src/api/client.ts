import type { components } from './schema';
/**
 * The failure shape, derived from the contract (§129).
 *
 * `message` really is `string | string[]` — an array for a validation failure,
 * one entry per broken rule — which is why it is narrowed below rather than
 * rendered directly. `error` is absent on a 401.
 */
type ApiErrorBody = components['schemas']['ApiErrorDto'];

import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as ExpoSecureStore from 'expo-secure-store';

/**
 * Where tokens are kept (§133.9).
 *
 * SecureStore on a phone, always. It has NO web implementation — its web
 * module is an empty object — so `expo start --web` could never sign in, and
 * the app could not be looked at in a browser at all. On the web, and only
 * there, this falls back to `localStorage`, which is exactly what the admin and
 * business apps already use for the same tokens.
 *
 * Nothing about the phone build changes: `Platform.OS` is a constant there and
 * this branch is never taken.
 */
const SecureStore =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
        setItemAsync: async (key: string, value: string) =>
          globalThis.localStorage?.setItem(key, value),
        deleteItemAsync: async (key: string) => globalThis.localStorage?.removeItem(key),
      }
    : ExpoSecureStore;

/** The same store, for small things a phone remembers that are not secrets (§171). */
export const deviceStore = SecureStore;

/**
 * The language every request asks the server to answer in (§308) — set by
 * `src/i18n` whenever the app's language changes, so the server's own
 * sentences (a refusal, a notice) come back in it.
 */
export const requestLanguage = { current: 'en' };

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
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';

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

/**
 * Told whenever the tokens change, so a screen can re-render (§133.6).
 *
 * `tokens.access` is a plain getter and React cannot see it move. That did not
 * matter while every screen was built fresh on arrival — but the five tabs now
 * stay mounted, so a Bookings tab that rendered "Sign in to see your bookings"
 * would go on saying it after the person had signed in.
 */
const authListeners = new Set<() => void>();
const authChanged = () => {
  for (const listener of authListeners) listener();
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
    authChanged();
    return cache.user;
  },

  // Only the two tokens are kept: on a phone a sign-in lasts 30 days unused and
  // has no other end (§279), so there is nothing for the app to count down.
  async set(pair: Pick<TokenPair, 'accessToken' | 'refreshToken'>, user?: AuthenticatedUser) {
    cache.access = pair.accessToken;
    cache.refresh = pair.refreshToken;
    authChanged();
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
    authChanged();
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};

/**
 * Whether somebody is signed in, as something a component can depend on.
 *
 * Use this rather than reading `tokens.access` during render: this one
 * re-renders the component when the answer changes.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    },
    () => cache.access !== null,
    () => false,
  );
}

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
  /** Skip the bearer token — the auth endpoints and public reference data. */
  anonymous?: boolean;
  /**
   * Works signed out, but says MORE when signed in (§133.7).
   *
   * Search and the shop page are behind `OptionalJwtAuthGuard`: anyone may
   * read them, and a signed-in reader is also told which places they have
   * saved. They were sent as `anonymous`, which strips the token — so `saved`
   * never came back, the heart hides itself when it does not know, and nobody
   * could save a place from the app at all.
   *
   * The token goes when there is one. A failure to prove who you are must not
   * cost you the page, so this never ends the session and never retries: the
   * server treats a bad token as no token and answers anyway.
   */
  optionalAuth?: boolean;
  /**
   * Lets a request be dropped when its answer is no longer wanted — a
   * suggestion for letters the customer has already typed past (§174).
   */
  signal?: AbortSignal;
}

/** Whether an access token has run out, read from the token itself. */
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      globalThis.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    // Thirty seconds early: a token that expires in transit is an expired token.
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    // Unreadable is treated as usable. The server is the judge; this is only
    // here to avoid a wasted request.
    return false;
  }
}

/**
 * The token for an optional-auth request: a live one, or none.
 *
 * An access token lasts minutes. Sent stale, the server would treat the caller
 * as a stranger and every heart on the screen would vanish until some OTHER
 * request happened to refresh the session. So a stale one is refreshed first —
 * and if that fails the request simply goes without, which is what a signed-out
 * reader gets.
 */
async function liveTokenOrNone(): Promise<string | null> {
  const access = tokens.access;
  if (!access) return null;
  if (!isExpired(access)) return access;
  if (!tokens.refresh) return null;
  try {
    return (await refreshTokens()).accessToken;
  } catch {
    return null;
  }
}

/**
 * One request, with the token attached and exactly ONE retry after a refresh.
 *
 * A second 401 after a successful refresh means the token is fine and the
 * account genuinely may not do this, so retrying again would loop forever
 * against a server that is answering correctly.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, optionalAuth, signal } = options;
  // Optional auth behaves as anonymous for every failure path below — no
  // refresh-and-retry, no ending the session — and differs only in the token.
  const anonymous = options.anonymous || optionalAuth;

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
      signal,
      headers: {
        'Accept-Language': requestLanguage.current,
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined
        ? { body: isForm ? (body as FormData) : JSON.stringify(body) }
        : {}),
    });

  let response = await send(
    optionalAuth ? await liveTokenOrNone() : anonymous ? null : tokens.access,
  );

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
    const raw = (payload as ApiErrorBody | null)?.message;
    const message = Array.isArray(raw) ? raw.join(' ') : (raw ?? response.statusText);
    throw new ApiError(response.status, message, payload);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
