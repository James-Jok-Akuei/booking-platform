import { CATALOGS } from '../i18n/catalogs';
import { LOCALES, type Locale } from '../i18n/locales';

/**
 * A category's or a type's words in the other languages (§308.3), as the
 * console keeps them: { "rw": { "name": "…", "description": "…" }, "fr": … }.
 */
export type OtherLanguage = Exclude<Locale, 'en'>;
export type TaxonomyTranslations = Partial<Record<OtherLanguage, { name?: string; description?: string }>>;

export const OTHER_LANGUAGES = LOCALES.filter((l): l is OtherLanguage => l !== 'en');

/** What the column holds, made safe to read: only our languages, only words. */
export function readTranslations(value: unknown): TaxonomyTranslations {
  const out: TaxonomyTranslations = {};
  if (!value || typeof value !== 'object') return out;
  for (const l of OTHER_LANGUAGES) {
    const raw = (value as Record<string, unknown>)[l];
    if (!raw || typeof raw !== 'object') continue;
    const { name, description } = raw as Record<string, unknown>;
    const words: { name?: string; description?: string } = {};
    if (typeof name === 'string' && name.trim()) words.name = name.trim();
    if (typeof description === 'string' && description.trim()) words.description = description.trim();
    if (words.name || words.description) out[l] = words;
  }
  return out;
}

/**
 * A name or description in `locale`: what the console says for it, else the
 * translators' version of the English (the seeded taxonomy is in the server's
 * .po files), else the English.
 */
export function taxonomyWord(
  locale: Locale,
  english: string,
  translations: TaxonomyTranslations,
  field: 'name' | 'description',
): string {
  if (locale === 'en') return english;
  const typed = translations[locale]?.[field];
  if (typed) return typed;
  return CATALOGS[locale]?.[english] || english;
}
