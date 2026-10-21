import { defineConfig } from '@lingui/cli';

/**
 * The website's sentences, for translators (§308) — the same set-up as the
 * two apps: English written in the code, pulled out by `npm run i18n` into
 * `src/locales/<language>/messages.po`; `en-XA` is every sentence made long,
 * to check the page holds up to long Kinyarwanda words.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'rw', 'fr', 'en-XA'],
  fallbackLocales: { default: 'en' },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
      exclude: ['**/node_modules/**', '<rootDir>/src/locales/**'],
    },
  ],
});
