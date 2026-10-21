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

/**
 * Offered to everyone (§308.7). Kinyarwanda and French were switched on on
 * 2026-10-21 at the user's wish, before the native check — that check, and
 * any small wording fixes it brings, follow in the translators' files.
 */
const OFFERED: SiteLocale[] = ['en', 'rw', 'fr'];

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

/** The language the address names: "/rw/", "/fr/" — a page per language, for search (§308.7). */
const pathLocale = (): SiteLocale | null => {
  const first = window.location.pathname.split('/')[1];
  return first === 'rw' || first === 'fr' ? first : null;
};

/** The address for a language: "/" for English, "/rw/", "/fr/" — the section kept. */
const addressFor = (locale: SiteLocale) =>
  `${locale === 'rw' || locale === 'fr' ? `/${locale}/` : '/'}${window.location.search}${window.location.hash}`;

/**
 * At start, before the page is drawn: the language the address names, else
 * the one picked here before, else the browser's own when we speak it, else
 * English.
 */
export async function loadLocale() {
  const named = pathLocale();
  if (named && usable(named)) return use(named);
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

/** A language picked on the page: used at once, remembered in this browser, and named in the address. */
export async function chooseLocale(locale: SiteLocale) {
  await use(locale);
  if (locale !== 'en-XA') window.history.replaceState(null, '', addressFor(locale));
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

/**
 * Kinyarwanda's names for the days and months, written here (§308.7): most
 * browsers and phones carry no Kinyarwanda dates and quietly fall back to
 * English ("Wednesday 21 October"). These are the names the language's own
 * standard (CLDR) gives, with a capital as a person writes them.
 */
const RW_DAYS = ['Ku cyumweru', 'Kuwa mbere', 'Kuwa kabiri', 'Kuwa gatatu', 'Kuwa kane', 'Kuwa gatanu', 'Kuwa gatandatu'];
const RW_DAYS_SHORT = ['Cyu.', 'Mbe.', 'Kab.', 'Gtu.', 'Kan.', 'Gnu.', 'Gnd.'];
const RW_MONTHS = ['Mutarama', 'Gashyantare', 'Werurwe', 'Mata', 'Gicurasi', 'Kamena', 'Nyakanga', 'Kanama', 'Nzeri', 'Ukwakira', 'Ugushyingo', 'Ukuboza'];
const RW_MONTHS_SHORT = ['Mut.', 'Gas.', 'Wer.', 'Mat.', 'Gic.', 'Kam.', 'Nya.', 'Kan.', 'Nze.', 'Ukw.', 'Ugu.', 'Uku.'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date in the page's language, in the order it writes dates: Rwanda writes
 * "Kuwa kane, 22 Ukwakira 2026" — the day first (§308.7).
 */
export function formatDate(value: Date, options: Intl.DateTimeFormatOptions): string {
  if (current !== 'rw') return value.toLocaleDateString(dateLocale(), options);
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const english = { weekday: part('weekday'), month: part('month') };
  const dayAt = english.weekday ? EN_DAYS.findIndex((d) => english.weekday!.startsWith(d)) : -1;
  const monthAt = english.month ? EN_MONTHS.findIndex((m) => english.month!.startsWith(m)) : -1;
  const weekday = dayAt === -1 ? undefined : (options.weekday === 'long' ? RW_DAYS : RW_DAYS_SHORT)[dayAt];
  const month = monthAt === -1 ? english.month : (options.month === 'long' ? RW_MONTHS : RW_MONTHS_SHORT)[monthAt];
  const when = [part('day'), month, part('year')].filter(Boolean).join(' ');
  return [weekday, when].filter(Boolean).join(', ');
}

/**
 * Where the pictures of the apps are, for a language (§308.7): the screens
 * taken in that language, so a Kinyarwanda page never shows English screens.
 */
export const shotsFor = (locale: SiteLocale) => (locale === 'rw' || locale === 'fr' ? `/shots/${locale}` : '/shots');
