import type { components } from './schema';
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
const ACCESS_KEY = 'booking-business.accessToken';
const REFRESH_KEY = 'booking-business.refreshToken';

export type TokenPair = components['schemas']['TokenPairDto'];

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
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

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
export const SESSION_ENDED = 'booking-business:session-ended';

function endSession() {
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
let refreshInFlight: Promise<TokenPair> | null = null;

async function refreshTokens(): Promise<TokenPair> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = tokens.refresh;
  if (!refreshToken) throw new ApiError(401, 'Not signed in.');

  refreshInFlight = (async () => {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) throw new ApiError(response.status, 'Session expired.');

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

  // FormData goes through untouched: the browser has to set Content-Type
  // itself so the multipart boundary matches the body it writes. Setting it
  // here would produce a boundary-less header the server cannot parse.
  const isForm = body instanceof FormData;

  const send = async (token: string | null): Promise<Response> =>
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
    const raw = (payload as { message?: string | string[] } | null)?.message;
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
/**
 * Step one of signing in — and, with `role`, of registering (§90.3).
 *
 * `role` is omitted for a sign-in and sent ONLY when the person has explicitly
 * chosen to create an account. §50's rule is intact: authentication never
 * sends a role, because an existing account signs in as whoever it is. This is
 * the registration case the server asks for by name when no account exists.
 */
export const requestOtp = (email: string, role?: 'BUSINESS') =>
  api<{ message?: string }>('/auth/otp/request', {
    method: 'POST',
    body: role ? { email, role } : { email },
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
