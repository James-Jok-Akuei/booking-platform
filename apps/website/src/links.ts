/*
 * Where the buttons go (§239). Each comes from the build's environment, so
 * the same page points at the real stores and apps once they exist — and
 * until then says so, rather than leading to a dead link.
 */
const env = (key: string) => (import.meta.env[key] as string | undefined)?.trim() || null;

/** The customer app in the App Store / Google Play, or on the web. */
export const APP_STORE_URL = env('VITE_APP_STORE_URL');
export const PLAY_STORE_URL = env('VITE_PLAY_STORE_URL');
export const CUSTOMER_APP_URL = env('VITE_CUSTOMER_APP_URL');
/** The business app's sign-in. In development, the app next door. */
export const BUSINESS_APP_URL = env('VITE_BUSINESS_APP_URL') ?? (import.meta.env.DEV ? 'http://localhost:5174/login' : null);

/**
 * The business app's sign-in, saying which button was pressed (§258): the
 * sheet greets a newcomer with "Start selling" and a returning seller with
 * "Welcome back". One email box serves both either way (§50), so a wrong
 * guess costs nothing. Null until the build knows where the app lives.
 */
export const businessStart = (start: 'signup' | 'signin') => {
  if (!BUSINESS_APP_URL) return null;
  const url = new URL(BUSINESS_APP_URL, window.location.href);
  url.searchParams.set('start', start);
  return url.toString();
};

export const API_URL = env('VITE_API_URL') ?? '/api';

/** Whether there is anywhere yet for "Get the app" to lead. */
export const APP_IS_OUT = Boolean(APP_STORE_URL || PLAY_STORE_URL || CUSTOMER_APP_URL);

/**
 * How to reach the people behind the platform, for the footer (§273–§275):
 * the support line and email the Terms of Use name. The build can change them.
 */
export const CONTACT_EMAIL = env('VITE_CONTACT_EMAIL') ?? 'jokditakeerleek@gmail.com';
export const CONTACT_PHONE = env('VITE_CONTACT_PHONE') ?? '+250 798 972 441';
