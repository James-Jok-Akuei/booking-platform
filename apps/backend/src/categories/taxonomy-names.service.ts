import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { OTHER_LANGUAGES, readTranslations, taxonomyWord, type TaxonomyTranslations } from './taxonomy-words';

type Words = { name: string; description: string | null; translations: TaxonomyTranslations };

/** How long the words are kept before they are read again — the console's changes show within it. */
const FRESH_MS = 60_000;

/** Keys under which the apps are sent a category or a type, sometimes without its id. */
const CATEGORY_KEYS = new Set(['category', 'categories', 'mainCategory']);
const TYPE_KEYS = new Set(['subcategory', 'subcategories']);

/**
 * Category and type names in the reader's language (§308.3).
 *
 * The taxonomy is about 140 rows, read whole and kept for a minute. Every
 * answer to a request in another language passes through `localise`, which
 * finds the categories and types in it — by id, or by name where they are
 * sent under "category"/"subcategory" without one — and puts their words in
 * that language. The rows themselves, and every rule that reads a name, stay
 * in English.
 */
@Injectable()
export class TaxonomyNamesService {
  private readonly logger = new Logger(TaxonomyNamesService.name);
  private byId = new Map<string, Words & { kind: 'category' | 'type' }>();
  private categoryByName = new Map<string, Words>();
  private typeByName = new Map<string, Words>();
  private readAt = 0;
  private reading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Read again on the next answer — after the console changed a name. */
  forget() {
    this.readAt = 0;
  }

  private async fresh() {
    if (Date.now() - this.readAt < FRESH_MS) return;
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    await this.reading;
  }

  private async read() {
    try {
      const categories = await this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          description: true,
          translations: true,
          subcategories: { select: { id: true, name: true, translations: true } },
        },
      });
      const byId = new Map<string, Words & { kind: 'category' | 'type' }>();
      const categoryByName = new Map<string, Words>();
      const typeByName = new Map<string, Words>();
      for (const c of categories) {
        const words = { name: c.name, description: c.description, translations: readTranslations(c.translations) };
        byId.set(c.id, { ...words, kind: 'category' });
        categoryByName.set(c.name, words);
        for (const s of c.subcategories) {
          const type = { name: s.name, description: null, translations: readTranslations(s.translations) };
          byId.set(s.id, { ...type, kind: 'type' });
          // "Other" is in every category; the first one's words serve.
          if (!typeByName.has(s.name)) typeByName.set(s.name, type);
        }
      }
      this.byId = byId;
      this.categoryByName = categoryByName;
      this.typeByName = typeByName;
      this.readAt = Date.now();
    } catch (error) {
      // Names in English rather than an answer that fails.
      this.logger.warn(`Could not read the taxonomy's words: ${String(error)}`);
    }
  }

  /**
   * The categories and types whose Kinyarwanda or French name holds what was
   * typed (§308.7) — "kogosha" finds barbershops, "beauté" the beauty shops —
   * so a search in the reader's language finds what an English one would.
   * Accents and capitals aside.
   */
  async spokenMatches(typed: string): Promise<{ categories: string[]; types: string[] }> {
    const needle = fold(typed);
    const found = { categories: [] as string[], types: [] as string[] };
    if (needle.length < 2) return found;
    await this.fresh();
    for (const [id, words] of this.byId) {
      const names = OTHER_LANGUAGES.map((l) => taxonomyWord(l, words.name, words.translations, 'name'));
      if (names.some((name) => name !== words.name && fold(name).includes(needle))) {
        (words.kind === 'category' ? found.categories : found.types).push(id);
      }
    }
    return found;
  }

  /** The answer, with every category and type in it said in `locale`. A copy: what was passed is left as it was. */
  async localise<T>(body: T, locale: Locale): Promise<T> {
    if (locale === DEFAULT_LOCALE || !isPlain(body)) return body;
    await this.fresh();
    if (this.byId.size === 0) return body;
    const copy = JSON.parse(JSON.stringify(body)) as T;
    this.walk(copy, undefined, locale);
    return copy;
  }

  private walk(value: unknown, key: string | undefined, locale: Locale) {
    if (Array.isArray(value)) {
      for (const item of value) this.walk(item, key, locale);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const o = value as Record<string, unknown>;
    if (typeof o.name === 'string') {
      const known = typeof o.id === 'string' ? this.byId.get(o.id) : undefined;
      const words =
        known && known.name === o.name
          ? known
          : key && CATEGORY_KEYS.has(key)
            ? this.categoryByName.get(o.name)
            : key && TYPE_KEYS.has(key)
              ? this.typeByName.get(o.name)
              : undefined;
      if (words) {
        o.name = taxonomyWord(locale, words.name, words.translations, 'name');
        if (typeof o.description === 'string' && o.description === words.description) {
          o.description = taxonomyWord(locale, words.description, words.translations, 'description');
        }
      }
    }
    for (const [child, inner] of Object.entries(o)) {
      if (inner && typeof inner === 'object') this.walk(inner, child, locale);
    }
  }
}

/** Lower case, accents off: "Beauté" and "beaute" are the same search. */
/** Lower case, without accents or marks: how typed words are compared (and counted, §310). */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const isPlain = (body: unknown) =>
  Array.isArray(body) || (!!body && typeof body === 'object' && Object.getPrototypeOf(body) === Object.prototype);
