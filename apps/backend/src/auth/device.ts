import { say } from '../i18n/say';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';

/**
 * A phone or browser in a few words (§298) — "Chrome on Mac", "the app on an
 * iPhone" — from how it describes itself. For "where you are signed in" and
 * the new-sign-in notice: enough to recognise your own, never a fingerprint.
 */
export function describeDevice(userAgent: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  const l = locale;
  const ua = userAgent ?? '';
  if (!ua) return say(l, 'an unknown device');

  // Names of systems and browsers are the same in every language; the words around them are not —
  // "an iPhone" in English — so each sentence chooses them by name (§308).
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  // The phone app talks through the system's own network library, not a browser.
  if (/okhttp|Dalvik/i.test(ua)) return say(l, 'the app on {system, select, iPhone {an iPhone} iPad {an iPad} Chromebook {a Chromebook} other {{system}}}', { system: 'Android' });
  if (/CFNetwork|Darwin/.test(ua) && !/Mozilla/.test(ua)) return say(l, 'the app on {system, select, iPhone {an iPhone} iPad {an iPad} Chromebook {a Chromebook} other {{system}}}', { system: 'iPhone' });
  if (/Expo/i.test(ua)) return os ? say(l, 'the app on {system, select, iPhone {an iPhone} iPad {an iPad} Chromebook {a Chromebook} other {{system}}}', { system: os }) : say(l, 'the app');

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

  if (browser && os) return say(l, '{browser} on {system, select, iPhone {an iPhone} iPad {an iPad} Chromebook {a Chromebook} other {{system}}}', { browser, system: os });
  if (browser) return browser;
  if (os) return say(l, 'a browser on {system, select, iPhone {an iPhone} iPad {an iPad} Chromebook {a Chromebook} other {{system}}}', { system: os });
  return say(l, 'an unknown device');
}

/** Kept short: what a browser says about itself can run to hundreds of characters. */
export const trimUserAgent = (userAgent: string | null | undefined) => (userAgent ? userAgent.slice(0, 400) : null);
