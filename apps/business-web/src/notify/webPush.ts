import { registerPushDevice, unregisterPushDevice } from '../api/business';

/**
 * Alerts on this computer (§287): the browser's own notifications, through
 * web push. Works in Chrome, Edge and Firefox, and Safari on a Mac; on an
 * iPhone only once the app is added to the home screen.
 */
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.register('/sw.js');
}

/** Whether this browser has alerts on for this app. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** "Chrome on Mac", so a person can tell their devices apart. */
function label() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a computer';
  return `${browser} on ${os}`;
}

/** Asks the browser, subscribes, and tells the server. Must follow a click. */
export async function turnOnHere(publicKey: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON();
  await registerPushDevice({
    kind: 'WEB',
    token: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    label: label(),
  });
  return 'on';
}

/** Stops alerts here — when turned off, and on signing out. Never throws. */
export async function turnOffHere(): Promise<void> {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await unregisterPushDevice(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Signing out must never fail over this.
  }
}
