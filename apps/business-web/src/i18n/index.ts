import { useSyncExternalStore } from 'react';
import { i18n } from '@lingui/core';
import { api, requestLanguage, tokens } from '../api/client';
import type { Messages } from '@lingui/core';
import { messages as en } from '../locales/en/messages';

/**
 * The seller app's languages (§308), as in the customer app.
 *
 * Every sentence is written in English in the code and goes through Lingui
 * (`t\`…\``, `<Trans>`); the files translators work in are
 * `src/locales/<language>/messages.po` (`npm run i18n`). A sentence not yet
 * translated shows in English. A language is offered only once its
 * translation is finished and a second native speaker has checked it in the
 * app (`OFFERED`), so nobody meets a half-translated app.
 */

export type AppLocale = 'en' | 'rw' | 'fr' | 'en-XA';
export type Language = { code: AppLocale; name: string; native: string };

/** Each language by its own name, as a person looking for theirs would recognise it. */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'fr', name: 'French', native: 'Français' },
];

/**
 * Offered to everyone (§308.7). Kinyarwanda and French were switched on on
 * 2026-10-21 at the user's wish, before the native check — that check, and
 * any small wording fixes it brings, follow in the translators' files.
 */
const OFFERED: AppLocale[] = ['en', 'rw', 'fr'];

/** The "long words" test language (§308): every sentence stretched. Only while developing. */
export const LONG_WORDS: Language = { code: 'en-XA', name: 'Long words (test)', native: 'Long words (test)' };

export const offeredLanguages = (): Language[] => [
  ...LANGUAGES.filter((language) => OFFERED.includes(language.code)),
  ...(import.meta.env.DEV ? [LONG_WORDS] : []),
];

/**
 * English is in the app itself; every other language is its own file,
 * fetched only by those who read it — nobody downloads four languages to use
 * one.
 */
const CATALOGS: Record<Exclude<AppLocale, 'en'>, () => Promise<{ messages: Messages }>> = {
  rw: () => import('../locales/rw/messages'),
  fr: () => import('../locales/fr/messages'),
  'en-XA': () => import('../locales/en-XA/messages'),
};
const loaded: Partial<Record<AppLocale, Messages>> = { en };

/** A language's sentences — fetched once, then kept. Also for words drawn in another language than the app's (the app QR card, §309). */
export async function catalogFor(locale: AppLocale): Promise<Messages> {
  const have = loaded[locale];
  if (have) return have;
  const { messages } = await CATALOGS[locale as Exclude<AppLocale, 'en'>]();
  loaded[locale] = messages;
  return messages;
}
const KEY = 'booking-business.locale';

const usable = (code: string | null | undefined): code is AppLocale =>
  Boolean(code) && offeredLanguages().some((language) => language.code === code);

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

let current: AppLocale = 'en';
let chosenHere = false;
const listeners = new Set<() => void>();

function activate(locale: AppLocale, messages: Messages) {
  current = locale;
  i18n.load(locale, messages);
  i18n.activate(locale);
  const spoken = locale === 'en-XA' ? 'en' : locale;
  requestLanguage.current = spoken;
  document.documentElement.lang = spoken;
  listeners.forEach((listener) => listener());
}

// English is ready the moment this file is read, before anything else is drawn.
activate('en', en);

/** Switches once the language's file is here; English stays until then. */
async function use(locale: AppLocale) {
  try {
    activate(locale, await catalogFor(locale));
  } catch {
    // The file could not be fetched (offline): English, rather than nothing.
    activate('en', en);
  }
}

/**
 * At start, before anything draws: the language picked in this browser, else
 * the browser's own when we speak it, else English. The app is drawn once this
 * is settled, so it opens in its language rather than switching after.
 */
export async function loadLocale() {
  const saved = read();
  if (usable(saved)) {
    chosenHere = true;
    await use(saved);
    return;
  }
  const browser = (navigator.languages ?? [navigator.language]).map((tag) => tag.toLowerCase().split('-')[0]).find(usable);
  if (browser && browser !== 'en') await use(browser);
}

/** A language picked in the app: used at once, kept in this browser and on the account. */
export async function chooseLocale(locale: AppLocale) {
  chosenHere = true;
  await use(locale);
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Private mode: chosen for now, not remembered.
  }
  if (tokens.access && locale !== 'en-XA') {
    await api('/users/me/locale', { method: 'PATCH', body: { locale } }).catch(() => undefined);
  }
}

/**
 * The account's language, once signed in: the account is told this browser's
 * choice when one was made here; otherwise the account's is kept for this
 * browser and used from the next time the app opens — never switched under
 * somebody in the middle of something.
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
    try {
      localStorage.setItem(KEY, accountLocale);
    } catch {
      // Not remembered; asked again next time.
    }
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
