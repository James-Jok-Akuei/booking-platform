import type { components } from './schema';
/** Derived from the contract (§128). The same message whether or not the address has an account (§3.2). */
type OtpRequested = components['schemas']['OtpRequestedDto'];

/**
 * The failure shape, derived from the contract (§129).
 *
 * `message` really is `string | string[]` — an array for a validation failure,
 * one entry per broken rule — which is why it is narrowed below rather than
 * rendered directly. `error` is absent on a 401.
 */
type ApiErrorBody = components['schemas']['ApiErrorDto'];

/**
 * The one place this app talks to the backend.
 *
 * Everything goes through `api()`, so the three things that are easy to get
 * subtly wrong — attaching the token, refreshing it, and giving up — are done
 * once rather than at every call site.
 */

/**
 * Where requests go.
 *
 * Defaults to `/api`, which is what vite proxies to the backend in development
 * — so the browser sees a single origin and CORS never applies locally. An
 * empty default would send requests to the dev server's own root, where nothing
 * is listening, and every call would 404 with no clue why.
 *
 * In production this is set to the backend's origin, and requests become
 * absolute and cross-origin — which is the point at which `enableCors()` on the
 * backend has to be narrowed to this app.
 */
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Where the token pair lives.
 *
 * `localStorage`, not memory: an admin who reloads the page mid-task should not
 * have to log in again, and this is an internal tool on a trusted device rather
 * than a public site. The honest trade is that a cross-site scripting bug could
 * read these — which is why the app renders no user-supplied HTML anywhere, and
 * why the access token is short-lived (15 minutes) even though the refresh
 * token is not.
 *
 * Namespaced so it cannot collide with another app served from the same origin
 * during development.
 */
export const ACCESS_KEY = 'booking-admin.accessToken';
const REFRESH_KEY = 'booking-admin.refreshToken';
/** How long this sign-in lasts (§279), as the server last said, and when it was renewed. */
const SESSION_KEY = 'booking-admin.session';
/** The last click or key in ANY tab of this app (§279), so one busy tab keeps them all signed in. */
export const ACTIVE_KEY = 'booking-admin.lastActive';
/** Why the last sign-in ended, for the sign-in page to say. */
const WHY_KEY = 'booking-admin.signedOutWhy';

export type TokenPair = components['schemas']['TokenPairDto'];
export type Session = components['schemas']['SessionDto'] & { renewedAt: number };

export type AuthenticatedUser = components['schemas']['AuthenticatedUserDto'];

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(pair: TokenPair) {
    localStorage.setItem(ACCESS_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
    if (pair.session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...pair.session, renewedAt: Date.now() }));
    }
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(SESSION_KEY);
  },
};

/** How long this sign-in lasts (§279), or null before the server has said. */
export function currentSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

/** Why a sign-in ended (§279): unused too long, or past the most it lasts. */
export type SignedOutWhy = { why: 'idle' | 'ended'; idleMinutes: number; maxMinutes: number | null; at: number };

export function rememberWhy(why: SignedOutWhy['why']) {
  const session = currentSession();
  if (!session) return;
  const note: SignedOutWhy = { why, idleMinutes: session.idleMinutes, maxMinutes: session.maxMinutes, at: Date.now() };
  localStorage.setItem(WHY_KEY, JSON.stringify(note));
}

/** The last reason, if it is from the last day; cleared by signing in. */
export function signedOutWhy(): SignedOutWhy | null {
  try {
    const note = JSON.parse(localStorage.getItem(WHY_KEY) ?? 'null') as SignedOutWhy | null;
    return note && Date.now() - note.at < 24 * 60 * 60 * 1000 ? note : null;
  } catch {
    return null;
  }
}

export const forgetWhy = () => localStorage.removeItem(WHY_KEY);

/**
 * Raised when the server refuses. Carries the status and the server's own
 * message, because the backend's messages are written for a person to read —
 * "A deposit can only be paid while an appointment is PENDING_PAYMENT" says
 * more than any generic string this app could substitute.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Broadcast when the session is definitively over, so the app can redirect. */
export const SESSION_ENDED = 'booking-admin:session-ended';

function endSession() {
  // Said on the sign-in page (§279): past its end, or unused too long.
  const session = currentSession();
  if (session?.endsAt && Date.parse(session.endsAt) <= Date.now()) rememberWhy('ended');
  else if (session && Date.now() - Number(localStorage.getItem(ACTIVE_KEY) ?? Date.now()) >= session.idleMinutes * 60_000)
    rememberWhy('idle');
  tokens.clear();
  window.dispatchEvent(new Event(SESSION_ENDED));
}

/**
 * In-flight refresh, shared.
 *
 * Without this, a page that fires five queries at once on a stale access token
 * gets five simultaneous refreshes. Four of them would present a refresh token
 * that the first has already rotated, and the user would be logged out in the
 * middle of a working session. One promise, everybody waits on it.
 */
let refreshInFlight: Promise<Pick<TokenPair, 'accessToken' | 'refreshToken'>> | null = null;

async function refreshTokens(): Promise<Pick<TokenPair, 'accessToken' | 'refreshToken'>> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = tokens.refresh;
  if (!refreshToken) throw new ApiError(401, 'Not signed in.');

  refreshInFlight = (async () => {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Another tab of this app may have renewed it a moment ago — renewing
      // retires the old token — so use theirs rather than sign everyone out.
      const now = tokens.refresh;
      if (now && now !== refreshToken && tokens.access) return { accessToken: tokens.access, refreshToken: now };
      throw new ApiError(response.status, 'Session expired.');
    }

    const pair = (await response.json()) as TokenPair;
    tokens.save(pair);
    return pair;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Renews the sign-in while someone is using the screen without it asking the
 * server for anything (§279) — reading, scrolling — so the server's idle clock
 * agrees with the screen's. A network failure is not the end of a sign-in.
 */
export async function keepAlive(): Promise<void> {
  try {
    await refreshTokens();
  } catch (error) {
    if (error instanceof ApiError) endSession();
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Query string parameters; undefined and null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the bearer token — only the auth endpoints need this. */
  anonymous?: boolean;
}

/**
 * One request, with the token attached and one retry after a refresh.
 *
 * Exactly ONE retry. A second 401 after a successful refresh means the token is
 * fine and the account genuinely may not do this, so retrying again would loop
 * forever against a server that is answering correctly.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous } = options;

  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const send = async (token: string | null): Promise<Response> =>
    fetch(url.toString(), {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let response = await send(anonymous ? null : tokens.access);

  if (response.status === 401 && !anonymous && tokens.refresh) {
    try {
      const pair = await refreshTokens();
      response = await send(pair.accessToken);
    } catch {
      endSession();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
  }

  if (response.status === 401 && !anonymous) {
    endSession();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    // Nest puts the useful sentence in `message`, which is a string for most
    // errors and an array for validation failures.
    const raw = (payload as ApiErrorBody | null)?.message;
    const message = Array.isArray(raw) ? raw.join(' ') : (raw ?? response.statusText);
    throw new ApiError(response.status, message, payload);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Step one of signing in. No role is sent: role belongs to REGISTRATION, and an
 * existing account logs in as whoever it is (§50).
 */
export const requestOtp = (email: string) =>
  api<OtpRequested>('/auth/otp/request', {
    method: 'POST',
    body: { email },
    anonymous: true,
  });

export const verifyOtp = (email: string, code: string) =>
  api<TokenPair & { user: AuthenticatedUser }>('/auth/otp/verify', {
    method: 'POST',
    body: { email, code },
    anonymous: true,
  });

export async function logout(): Promise<void> {
  const refreshToken = tokens.refresh;
  if (refreshToken) {
    // Best effort: the server revokes the refresh token, but a failure here
    // must not trap someone in a session they are trying to leave.
    await api('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
    }).catch(() => undefined);
  }
  tokens.clear();
}

/**
 * Downloads a file the browser cannot fetch on its own.
 *
 * A plain `<a href>` sends no Authorization header, so the CSV export would come
 * back 401. This fetches it with the token like any other request, then hands
 * the browser a blob to save.
 */
export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Could not download ${filename}.`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
