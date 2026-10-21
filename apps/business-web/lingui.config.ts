import { defineConfig } from '@lingui/cli';

/**
 * The seller app's sentences, for translators (§308) — the same set-up as the
 * customer app's: English written in the code, pulled out by `npm run i18n`
 * into `src/locales/<language>/messages.po`; `en-XA` is every sentence made
 * long, to check the screens hold up to long Kinyarwanda words.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'rw', 'fr', 'en-XA'],
  fallbackLocales: { default: 'en' },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
      exclude: ['**/node_modules/**', '<rootDir>/src/locales/**', '<rootDir>/src/api/schema.d.ts'],
    },
  ],
});
