/**
 * The languages the platform speaks (§308).
 *
 * English is the source: every sentence is written in it first, and any
 * sentence not yet translated is shown in it. Kinyarwanda and French follow
 * once professional translators have done them and a second native speaker
 * has checked them in the apps — machine translation is never shipped.
 */
export const LOCALES = ['en', 'rw', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/**
 * The language a request asks for, from its `Accept-Language` header — the
 * apps send the one chosen, a browser its own. The first we speak wins.
 */
export function localeOf(acceptLanguage: string | undefined | null): Locale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}
