/**
 * Where a customer's phone goes when it scans a shop's app QR code (§309).
 *
 * `VITE_CUSTOMER_APP_URL` when it is set. Once the app is published this should
 * be ONE link we control that sends each phone to its own store (App Store on
 * an iPhone, Google Play on Android) — not a store's address — so the cards
 * shops have already printed keep working whatever changes behind it.
 *
 * Until then, while developing: the customer app in Expo Go on this
 * computer's Wi-Fi — the same `exp://…:8081` the terminal's QR code opens.
 */
export type AppLink = {
  url: string;
  /** A development link: opens Expo Go on this Wi-Fi, not a store. Not for printing. */
  testing: boolean;
};

const SET = (import.meta.env.VITE_CUSTOMER_APP_URL as string | undefined)?.trim() || null;

/** Expo's own port for the customer app (`npm run dev` starts it there). */
const EXPO_PORT = 8081;

export function customerAppLink(): AppLink | null {
  if (SET) return { url: SET, testing: SET.startsWith('exp://') };
  if (import.meta.env.DEV && __WIFI_ADDRESS__) return { url: `exp://${__WIFI_ADDRESS__}:${EXPO_PORT}`, testing: true };
  return null;
}

/** The link to give in the "Get the app" advert (§204): only a real one, never the development one. */
export const CUSTOMER_APP_URL = SET;
