import { useSyncExternalStore } from 'react';
// First: plural rules on phones that lack them, before any sentence is read.
import './plurals';
import { i18n } from '@lingui/core';
import { getLocales } from 'expo-localization';
import { api, deviceStore, requestLanguage, tokens } from '../api/client';
import { messages as en } from '../locales/en/messages';
import { messages as rw } from '../locales/rw/messages';
import { messages as fr } from '../locales/fr/messages';
import { messages as long } from '../locales/en-XA/messages';

/**
 * The app's languages (§308).
 *
 * Every sentence is written in English in the code and goes through Lingui
 * (`t\`…\``, `<Trans>`), which looks it up in the language chosen. The files
 * translators work in are `src/locales/<language>/messages.po`
 * (`npm run i18n`); a sentence not yet translated shows in English.
 *
 * A language is offered only once its translation is finished and a second
 * native speaker has checked it in the app (`OFFERED`) — until then it stays
 * hidden, so nobody meets a half-translated app.
 */

export type AppLocale = 'en' | 'rw' | 'fr' | 'en-XA';

export type Language = { code: AppLocale; name: string; native: string };

/** Each language by its own name, as a person looking for theirs would recognise it. */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'fr', name: 'French', native: 'Français' },
];

/** Finished and checked. Kinyarwanda and French join when their translators are done. */
const OFFERED: AppLocale[] = ['en'];

/**
 * The "long words" test language (§308): every sentence stretched, to see the
 * screens hold up. Only in development builds, never in the store's.
 */
export const LONG_WORDS: Language = { code: 'en-XA', name: 'Long words (test)', native: 'Long words (test)' };

export const offeredLanguages = (): Language[] => [
  ...LANGUAGES.filter((language) => OFFERED.includes(language.code)),
  ...(__DEV__ ? [LONG_WORDS] : []),
];

const CATALOGS: Record<AppLocale, typeof en> = { en, rw, fr, 'en-XA': long };
const KEY = 'booking.locale';

const usable = (code: string | null | undefined): code is AppLocale =>
  Boolean(code) && offeredLanguages().some((language) => language.code === code);

let current: AppLocale = 'en';
/** Whether the person picked a language here, rather than it coming from the phone or the account. */
let chosenHere = false;
const listeners = new Set<() => void>();

function activate(locale: AppLocale) {
  current = locale;
  i18n.load(locale, CATALOGS[locale]);
  i18n.activate(locale);
  requestLanguage.current = locale === 'en-XA' ? 'en' : locale;
  listeners.forEach((listener) => listener());
}

// English is ready before anything renders, whatever happens next.
activate('en');

/**
 * At start: the language picked on this phone, else the phone's own when we
 * speak it, else English.
 */
export async function loadLocale() {
  const saved = await deviceStore.getItemAsync(KEY).catch(() => null);
  if (usable(saved)) {
    chosenHere = true;
    activate(saved);
    return;
  }
  const phone = getLocales()[0]?.languageCode;
  activate(usable(phone) ? phone : 'en');
}

/** A language picked in the app: used at once, kept on this phone and on the account. */
export async function chooseLocale(locale: AppLocale) {
  chosenHere = true;
  activate(locale);
  await deviceStore.setItemAsync(KEY, locale).catch(() => undefined);
  if (tokens.access && locale !== 'en-XA') {
    await api('/users/me/locale', { method: 'PATCH', body: { locale } }).catch(() => undefined);
  }
}

/**
 * The account's language, once signed in. When something was picked on this
 * phone, the account is told it — it follows the last place it was set. When
 * nothing was, the account's is kept for this phone and used from the next
 * time the app opens: a second phone speaks as the first, without the
 * screen changing language under somebody halfway through a booking.
 */
export function syncAccountLocale(accountLocale: string | undefined) {
  if (!accountLocale) return;
  if (chosenHere) {
    const spoken = current === 'en-XA' ? 'en' : current;
    if (spoken !== accountLocale) {
      void api('/users/me/locale', { method: 'PATCH', body: { locale: spoken } }).catch(() => undefined);
    }
    return;
  }
  if (usable(accountLocale) && accountLocale !== current) {
    chosenHere = true;
    void deviceStore.setItemAsync(KEY, accountLocale).catch(() => undefined);
  }
}

/** The language now in use; components re-render when it changes. */
export function useAppLocale(): AppLocale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => current,
  );
}

export const appLocale = () => current;
