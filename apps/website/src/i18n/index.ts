import { useSyncExternalStore } from 'react';
import { i18n } from '@lingui/core';
import type { Messages } from '@lingui/core';
import { messages as en } from '../locales/en/messages';

/**
 * The website's languages (§308), as in the two apps.
 *
 * Every sentence is written in English in the code and goes through Lingui
 * (`t\`…\``, `<Trans>`); the files translators work in are
 * `src/locales/<language>/messages.po` (`npm run i18n`). A language is
 * offered only once its translation is finished and checked (`OFFERED`).
 * Nobody is signed in here, so the choice is kept in this browser only.
 */

export type SiteLocale = 'en' | 'rw' | 'fr' | 'en-XA';
export type Language = { code: SiteLocale; native: string };

/** Each language by its own name, as a person looking for theirs would recognise it. */
export const LANGUAGES: Language[] = [
  { code: 'en', native: 'English' },
  { code: 'rw', native: 'Ikinyarwanda' },
  { code: 'fr', native: 'Français' },
];

/** Finished and checked. Kinyarwanda and French join when their translators are done. */
const OFFERED: SiteLocale[] = ['en'];

/** The "long words" test language: every sentence stretched. Only while developing. */
const LONG_WORDS: Language = { code: 'en-XA', native: 'Long words (test)' };

export const offeredLanguages = (): Language[] => [
  ...LANGUAGES.filter((language) => OFFERED.includes(language.code)),
  ...(import.meta.env.DEV ? [LONG_WORDS] : []),
];

/** English is in the page itself; any other language is fetched only by those who read it. */
const CATALOGS: Record<Exclude<SiteLocale, 'en'>, () => Promise<{ messages: Messages }>> = {
  rw: () => import('../locales/rw/messages'),
  fr: () => import('../locales/fr/messages'),
  'en-XA': () => import('../locales/en-XA/messages'),
};

const KEY = 'bwangu-site.locale';

const usable = (code: string | null | undefined): code is SiteLocale =>
  Boolean(code) && offeredLanguages().some((language) => language.code === code);

let current: SiteLocale = 'en';
const listeners = new Set<() => void>();

function activate(locale: SiteLocale, messages: Messages) {
  current = locale;
  i18n.load(locale, messages);
  i18n.activate(locale);
  document.documentElement.lang = locale === 'en-XA' ? 'en' : locale;
  listeners.forEach((listener) => listener());
}

// English is ready the moment this file is read, before anything is drawn.
activate('en', en);

async function use(locale: SiteLocale) {
  if (locale === 'en') return activate('en', en);
  try {
    activate(locale, (await CATALOGS[locale]()).messages);
  } catch {
    // The file could not be fetched: English, rather than nothing.
    activate('en', en);
  }
}

/**
 * At start, before the page is drawn: the language picked here before, else
 * the browser's own when we speak it, else English.
 */
export async function loadLocale() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // Private mode: nothing remembered.
  }
  if (usable(saved)) return use(saved);
  const browser = (navigator.languages ?? [navigator.language])
    .map((tag) => tag.toLowerCase().split('-')[0])
    .find(usable);
  if (browser && browser !== 'en') await use(browser);
}

/** A language picked on the page: used at once and remembered in this browser. */
export async function chooseLocale(locale: SiteLocale) {
  await use(locale);
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Chosen for now, not remembered.
  }
}

/** The language now in use; components re-render when it changes. */
export function useSiteLocale(): SiteLocale {
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

/** The language to ask the server in: category names come back in it (§308.3). */
export const askIn = () => (current === 'en-XA' ? 'en' : current);

/** How the language writes a date: the day before the month (§308). */
export const dateLocale = () => (current === 'fr' ? 'fr-RW' : current === 'rw' ? 'rw-RW' : 'en-GB');
