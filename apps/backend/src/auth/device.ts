/**
 * A phone or browser in a few words (§298) — "Chrome on Mac", "the app on an
 * iPhone" — from how it describes itself. For "where you are signed in" and
 * the new-sign-in notice: enough to recognise your own, never a fingerprint.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'an unknown device';

  const os = /iPhone/.test(ua)
    ? 'an iPhone'
    : /iPad/.test(ua)
      ? 'an iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'a Chromebook'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  // The phone app talks through the system's own network library, not a browser.
  if (/okhttp|Dalvik/i.test(ua)) return 'the app on Android';
  if (/CFNetwork|Darwin/.test(ua) && !/Mozilla/.test(ua)) return 'the app on an iPhone';
  if (/Expo/i.test(ua)) return os ? `the app on ${os}` : 'the app';

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `a browser on ${os}`;
  return 'an unknown device';
}

/** Kept short: what a browser says about itself can run to hundreds of characters. */
export const trimUserAgent = (userAgent: string | null | undefined) => (userAgent ? userAgent.slice(0, 400) : null);
