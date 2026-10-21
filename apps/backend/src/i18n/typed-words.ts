import type { Locale } from './locales';

/**
 * Words an administrator typed in the console for each other language
 * (§308.4) — an announcement's title and message, say — kept on the row as
 * { "rw": { "title": "…", … }, "fr": { … } }.
 */
export type TypedLanguage = Exclude<Locale, 'en'>;
export type TypedWords<K extends string> = Partial<Record<TypedLanguage, Partial<Record<K, string>>>>;

const TYPED_LANGUAGES: TypedLanguage[] = ['rw', 'fr'];

/** The column made safe to read: only our languages, only the fields asked for, only words. */
export function readTyped<K extends string>(value: unknown, fields: readonly K[]): TypedWords<K> {
  const out: TypedWords<K> = {};
  if (!value || typeof value !== 'object') return out;
  for (const l of TYPED_LANGUAGES) {
    const raw = (value as Record<string, unknown>)[l];
    if (!raw || typeof raw !== 'object') continue;
    const words: Partial<Record<K, string>> = {};
    for (const field of fields) {
      const text = (raw as Record<string, unknown>)[field];
      if (typeof text === 'string' && text.trim()) words[field] = text.trim();
    }
    if (Object.keys(words).length) out[l] = words;
  }
  return out;
}

/** Each field in `locale` where it was typed, else the English as written. */
export function typedIn<T extends Record<string, string | null>>(
  locale: Locale,
  english: T,
  typed: TypedWords<Extract<keyof T, string>>,
): T {
  if (locale === 'en') return english;
  const own: Partial<Record<string, string>> = typed[locale] ?? {};
  const out = { ...english };
  for (const key of Object.keys(english) as Array<Extract<keyof T, string>>) {
    const text = own[key];
    if (text) (out as Record<string, string | null>)[key] = text;
  }
  return out;
}
