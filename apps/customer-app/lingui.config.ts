import { defineConfig } from '@lingui/cli';

/**
 * The app's sentences, for translators (§308).
 *
 * English is written in the code and pulled out by `npm run i18n:extract` into
 * `src/locales/<language>/messages.po` — the file translators work in. A
 * sentence not yet translated shows in English. `en-XA` is not a language: it
 * is every sentence made long, for checking that screens hold up to long
 * Kinyarwanda words before the real ones arrive (`scripts/long-words.mjs`).
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'rw', 'fr', 'en-XA'],
  fallbackLocales: { default: 'en' },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/app', '<rootDir>/src'],
      exclude: ['**/node_modules/**', '<rootDir>/src/locales/**', '<rootDir>/src/api/schema.d.ts'],
    },
  ],
});
