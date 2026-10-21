import { useSyncExternalStore } from 'react';
import { AppState, Linking, type NativeEventSubscription } from 'react-native';
import * as Location from 'expo-location';
import { deviceStore } from './api/client';
import { confirmDialog } from './ui/Dialog';
import { t } from '@lingui/core/macro';

export type NearMeState =
  | { status: 'off' }
  | { status: 'asking' }
  | { status: 'on'; lat: number; lng: number; accuracy: number | null }
  /** `canAskAgain` false: the phone will not show its question again; only Settings can. */
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'failed' };

/**
 * Where the customer is RIGHT NOW, while the app is open (§107, §171).
 *
 * One position for the whole app, not one per screen. Home, a shop and a
 * reservation all read the same fix, so the distance on a card and the road
 * on the shop page are measured from the same spot, and the phone is asked
 * once rather than on every screen.
 *
 * What it does with the permission:
 *
 * 1. **Never asked on open.** The phone's question appears only when the
 *    customer presses something that asks for it — "Use my location" on Home,
 *    or "Nearest". An app that asks before showing anything gets declined.
 * 2. **Followed while the app is open.** Someone who allowed it is followed as
 *    they move: a new position every ~200 m, and a fresh one each time the app
 *    comes back to the front. Someone who opens the app in Kimironko and takes
 *    a moto to Nyamirambo sees Nyamirambo's distances, not Kimironko's.
 * 3. **Stopped when it is not.** The phone stops reporting the moment the app
 *    goes to the background. Nothing is sent anywhere except with a search,
 *    and nothing is stored — not here, not on the server.
 * 4. **Declining costs nothing.** Every listing is still there.
 */
const store = {
  state: { status: 'off' } as NearMeState,
  /** Pressed "Not now" on Home's card: kept on the phone, so it is said once. */
  dismissed: false,
  /** The customer asked in THIS session, so the outcome is shown even if dismissed. */
  asked: false,
};

/** The phone reports after this much movement, not on every step. */
const FOLLOW_EVERY_M = 200;
/**
 * A new fix replaces the one in use only past this distance — or when it is
 * much sharper. Every replacement re-asks the server for every list on Home,
 * and a phone held still reports a few metres of wobble every time it looks.
 */
const MOVED_M = 150;
const DISMISSED_KEY = 'booking.nearMe.notNow';

const listeners = new Set<() => void>();
let users = 0;
let following: Location.LocationSubscription | null = null;
let startingFollow = false;
let appState: NativeEventSubscription | null = null;

const emit = () => listeners.forEach((listener) => listener());

const set = (next: NearMeState) => {
  store.state = next;
  emit();
};

/** Metres between two points, as the crow flies (6371 km Earth). */
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

const accept = (coords: Location.LocationObjectCoords) => {
  const next = {
    status: 'on' as const,
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy ?? null,
  };
  const was = store.state;
  if (was.status !== 'on') return set(next);
  const moved = metres(was, next) >= MOVED_M;
  // The instant "last known" fix is often a rough one; the fresh fix that
  // follows it replaces it even when it is close by, because it is better.
  const sharper =
    next.accuracy !== null && (was.accuracy === null || next.accuracy * 2 <= was.accuracy);
  if (moved || sharper) set(next);
};

/** The best fix the phone can give now (§157.2). Never raises the prompt. */
const freshFix = async () => {
  try {
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    accept(fix.coords);
  } catch {
    // Indoors with no fix: keep what we had. Only a first attempt is a failure.
    if (store.state.status !== 'on') set({ status: 'failed' });
  }
};

const follow = async () => {
  if (following || startingFollow || users === 0) return;
  startingFollow = true;
  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: FOLLOW_EVERY_M,
        // Android only: no more often than this, even on a fast moto.
        timeInterval: 20_000,
      },
      (fix) => accept(fix.coords),
    );
    // The app may have gone to the background, or every screen closed, while
    // the phone was starting up.
    if (users === 0 || AppState.currentState !== 'active') subscription.remove();
    else following = subscription;
  } catch {
    // Not following is a smaller version of working, not an error.
  } finally {
    startingFollow = false;
  }
};

const stopFollowing = () => {
  following?.remove();
  following = null;
};

/**
 * Reads the permission the phone ALREADY has and acts on it. Run on start and
 * every time the app comes back to the front — which is also how a customer
 * who turned location on in Settings gets their distances without pressing
 * anything again.
 */
const wake = async () => {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      const was = store.state;
      if (permission.status === 'denied') {
        if (was.status !== 'denied' || was.canAskAgain !== permission.canAskAgain) {
          set({ status: 'denied', canAskAgain: permission.canAskAgain });
        }
      } else if (was.status === 'on') {
        set({ status: 'off' });
      }
      stopFollowing();
      return;
    }
    // Instant, then exact (§139): distances appear at once and sharpen.
    if (store.state.status !== 'on') {
      const known = await Location.getLastKnownPositionAsync();
      if (known) accept(known.coords);
    }
    await freshFix();
    void follow();
  } catch {
    // Quietly nothing: this was a convenience nobody pressed for.
  }
};

const start = () => {
  void deviceStore.getItemAsync(DISMISSED_KEY).then((value) => {
    if (value === '1' && !store.dismissed) {
      store.dismissed = true;
      emit();
    }
  });
  appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void wake();
    else stopFollowing();
  });
  void wake();
};

const sleep = () => {
  appState?.remove();
  appState = null;
  stopFollowing();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  users += 1;
  if (users === 1) start();
  return () => {
    listeners.delete(listener);
    users -= 1;
    if (users === 0) sleep();
  };
};

/**
 * The customer pressed something that asks. The only place the phone's own
 * question is raised (§107.3). Resolves `true` once the position is known.
 *
 * The phone's question is drawn by the phone, and no app can restyle it. With
 * `explain`, the app first asks in its own dialog (§184) — what location is
 * for, and that it is never saved — so the phone's box arrives as the second
 * half of a question already understood, not out of nowhere. Not needed where
 * the button pressed already says all that (Home's card). When the phone will
 * not ask again, the dialog offers Settings instead, the only way back.
 */
const enable = async (options?: { explain?: boolean }): Promise<boolean> => {
  if (options?.explain) {
    let permission: Location.LocationPermissionResponse | null = null;
    try {
      permission = await Location.getForegroundPermissionsAsync();
    } catch {
      permission = null;
    }
    if (permission && permission.status !== 'granted') {
      if (!permission.canAskAgain) {
        const go = await confirmDialog({
          tone: 'info',
          icon: 'location',
          title: t`Location is off`,
          message:
            t`Your phone has location turned off for this app. Turn it on in Settings to see the nearest places first. Everything else works without it.`,
          confirm: t`Open Settings`,
          cancel: t`Not now`,
        });
        if (go) openSettings();
        return false;
      }
      const yes = await confirmDialog({
        tone: 'accent',
        icon: 'navigate',
        title: t`See what is near you?`,
        message:
          t`We use where your phone is right now to put the nearest places first and show how far each one is. Only while the app is open, and never saved.`,
        confirm: t`Use my location`,
        cancel: t`Not now`,
      });
      if (!yes) return false;
    }
  }

  store.asked = true;
  set({ status: 'asking' });
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      set({ status: 'denied', canAskAgain: permission.canAskAgain });
      return false;
    }
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    set({
      status: 'on',
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? null,
    });
    void follow();
    return true;
  } catch {
    set({ status: 'failed' });
    return false;
  }
};

/** "Not now" on Home's card. Said once, remembered on this phone. */
const notNow = () => {
  store.dismissed = true;
  store.asked = false;
  emit();
  void deviceStore.setItemAsync(DISMISSED_KEY, '1');
};

/** When the phone will not ask again, Settings is the only way back. */
const openSettings = () => void Linking.openSettings();

// A snapshot object that only changes when something in it does, so screens
// re-render on a real change and not on every read.
let snapshot = { ...store };
const read = () => {
  if (
    snapshot.state !== store.state ||
    snapshot.dismissed !== store.dismissed ||
    snapshot.asked !== store.asked
  ) {
    snapshot = { ...store };
  }
  return snapshot;
};

export function useNearMe() {
  const { state, dismissed, asked } = useSyncExternalStore(subscribe, read, read);
  return { state, dismissed, asked, enable, notNow, openSettings };
}
