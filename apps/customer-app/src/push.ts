import { Platform } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { deviceStore } from './api/client';
import { registerPushDevice, unregisterPushDevice } from './api/notifications';
import { t } from '@lingui/core/macro';

/**
 * Alerts on this phone (§287), through Expo's push service — free, and the
 * one place that talks to Apple and Google for us.
 *
 * Permission is asked for at a moment it plainly helps — right after a booking
 * ("remind me before it?"), or from Notifications in Account — never the
 * moment the app opens, which is when people say no to everything. Android
 * 13 and later ask too; older Android says yes by default.
 *
 * Nothing here runs in a browser: the web build has no push.
 */
export type PushState = 'unavailable' | 'undecided' | 'denied' | 'on';

const TOKEN_KEY = 'booking.pushToken';

/**
 * Expo Go on Android has had no push since SDK 53, and from SDK 57 merely
 * loading `expo-notifications` there throws ("Cannot find native module
 * 'ExpoTopicSubscriptionModule'") — which, loaded by the root layout, took
 * the whole app down with it. So the module is loaded only where it can work:
 * a real build, or Expo Go on an iPhone — never in a browser (§293).
 */
const expoGoAndroid =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const available = Platform.OS !== 'web' && !expoGoAndroid;

let loaded: typeof NotificationsModule | null | undefined;
function notifications(): typeof NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // A require, not an import: it runs only here, and only where push can work.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = available ? (require('expo-notifications') as typeof NotificationsModule) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** How an alert shows while the app is open: as a banner, quietly. */
export function configurePush() {
  const Notifications = notifications();
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Bookings and messages',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#F0532D',
    }).catch(() => undefined);
  }
}

export async function pushState(): Promise<PushState> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return 'unavailable';
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'on';
  if (status === 'denied' && !canAskAgain) return 'denied';
  return 'undecided';
}

const projectId = () =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  Constants.easConfig?.projectId;

/** Tells the server where this phone's alerts go. Never throws. */
async function register(): Promise<boolean> {
  try {
    const Notifications = notifications();
    const id = projectId();
    // Without the app's Expo project there is no token to have (§287: set at `eas init`).
    if (!Notifications || !id) return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const result = await registerPushDevice({
      kind: 'EXPO',
      token,
      label: Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone'),
    });
    if (result.registered) await deviceStore.setItemAsync(TOKEN_KEY, token);
    return result.registered;
  } catch {
    return false;
  }
}

/** Asks — after a tap that makes the reason plain — and registers the phone. */
export async function askForPush(): Promise<PushState> {
  const now = await pushState();
  if (now === 'unavailable' || now === 'denied') return now;
  if (now !== 'on') {
    const { status } = await notifications()!.requestPermissionsAsync();
    if (status !== 'granted') return (await pushState()) === 'denied' ? 'denied' : 'undecided';
  }
  await register();
  return 'on';
}

/** On opening the app signed in: keeps the server's note of this phone fresh, if alerts are on. */
export async function refreshPush() {
  if ((await pushState()) === 'on') await register();
}

/** On signing out: this phone stops getting that account's alerts. Never throws. */
export async function forgetThisPhone() {
  if (!available) return;
  try {
    const token = await deviceStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await unregisterPushDevice(token).catch(() => undefined);
    await deviceStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Signing out must never fail over this.
  }
}

/** Where a tapped alert should open. */
export function linkOf(response: NotificationsModule.NotificationResponse | null): string | null {
  const link = response?.notification.request.content.data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}

/**
 * Opens what a tapped alert is about — including the alert that started the
 * app. Returns how to stop listening; does nothing where there is no push.
 */
export function onAlertOpened(open: (link: string) => void): () => void {
  const Notifications = notifications();
  if (!Notifications) return () => undefined;
  const go = (response: NotificationsModule.NotificationResponse | null) => {
    const link = linkOf(response);
    if (link) open(link);
  };
  void Notifications.getLastNotificationResponseAsync()
    .then(go)
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}
