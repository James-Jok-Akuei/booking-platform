import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { deviceStore } from './api/client';
import { registerPushDevice, unregisterPushDevice } from './api/notifications';

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
const available = Platform.OS !== 'web';

/** How an alert shows while the app is open: as a banner, quietly. */
export function configurePush() {
  if (!available) return;
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
  if (!available || !Device.isDevice) return 'unavailable';
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
    const id = projectId();
    // Without the app's Expo project there is no token to have (§287: set at `eas init`).
    if (!id) return false;
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
    const { status } = await Notifications.requestPermissionsAsync();
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
export function linkOf(response: Notifications.NotificationResponse | null): string | null {
  const link = response?.notification.request.content.data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}
