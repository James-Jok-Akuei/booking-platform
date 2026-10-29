import { Linking, Platform, Share } from 'react-native';

/** Where a branch is, as everything that shows the way there needs it (§318). */
export type Place = {
  shopName: string;
  /** The branch's own name, "Remera Branch". */
  branchName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** How to find the door, in the shop's words. */
  findUs?: string | null;
};

export type MapsApp = 'apple' | 'google' | 'waze';

const pinOf = (p: Place) =>
  p.latitude !== null && p.longitude !== null ? `${p.latitude},${p.longitude}` : null;

/** For a branch with no pin (§43.2 made it required; older ones may lack it): its name and address, searched. */
const wordsOf = (p: Place) =>
  [p.shopName, p.branchName !== p.shopName ? p.branchName : null, p.address].filter(Boolean).join(', ');

/**
 * The way there, in each maps app, to the exact pin. Each is a web address
 * the app answers when it is installed and a browser answers when it is not,
 * so nothing has to be asked of the phone first — and a phone without Waze
 * still gets somewhere.
 */
export function directionsUrl(app: MapsApp, p: Place) {
  const pin = pinOf(p);
  const there = encodeURIComponent(pin ?? wordsOf(p));
  switch (app) {
    case 'apple':
      return `https://maps.apple.com/?daddr=${there}`;
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${there}`;
    case 'waze':
      return pin ? `https://waze.com/ul?ll=${there}&navigate=yes` : `https://waze.com/ul?q=${there}&navigate=yes`;
  }
}

/** The place itself on a map, to send to somebody: anyone can open it, app or not. */
export const placeUrl = (p: Place) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pinOf(p) ?? wordsOf(p))}`;

const onApple = () =>
  Platform.OS === 'ios' ||
  (Platform.OS === 'web' && typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent));

/** The maps apps worth offering here: Apple's only where it is, and first there. */
export const mapsApps = (): MapsApp[] => (onApple() ? ['apple', 'google', 'waze'] : ['google', 'waze']);

/** Opens the way there; false when nothing on the phone would take it. */
export async function openDirections(app: MapsApp, p: Place) {
  try {
    await Linking.openURL(directionsUrl(app, p));
    return true;
  } catch {
    return false;
  }
}

/** Whether this browser can hand the place to another app; without it, sending is copying. */
export const canShareOnWeb = () =>
  Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/**
 * Sends the place to somebody — "meet me there" over WhatsApp is how people
 * here say where. The words work without a link: the name, the address, how
 * to find the door, then the map. On a phone the share sheet also has Copy;
 * a browser that cannot share copies it instead.
 */
export async function sendPlace(p: Place): Promise<'shared' | 'copied' | 'failed'> {
  const words = [p.shopName, p.address, p.findUs ?? null].filter(Boolean).join('\n');
  const link = placeUrl(p);
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: p.shopName, text: words, url: link });
        return 'shared';
      }
      await navigator.clipboard.writeText(`${words}\n${link}`);
      return 'copied';
    }
    await Share.share({ message: `${words}\n${link}` });
    return 'shared';
  } catch (error) {
    // Closing the browser's share window is not a failure.
    if (error instanceof Error && error.name === 'AbortError') return 'shared';
    return 'failed';
  }
}
