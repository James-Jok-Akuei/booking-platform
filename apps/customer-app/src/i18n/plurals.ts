import { shouldPolyfill } from '@formatjs/intl-pluralrules/should-polyfill.js';

/**
 * "1 person", "2 people" (§308) on every phone. The engine some phones run
 * the app on (Hermes) may have no plural rules of its own, and Lingui needs
 * them for every `plural(…)`; this adds the standard ones, for the three
 * languages only, where they are missing.
 *
 * Kinyarwanda has no rules of its own in the shared data (CLDR), so it gets
 * the two forms a translator can fill — one, and any other number — which
 * is also what the browser does.
 */
type AddData = (data: unknown) => void;

if (shouldPolyfill('en') || shouldPolyfill('fr')) {
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/fr.js');
  const add = (Intl.PluralRules as unknown as { __addLocaleData?: AddData }).__addLocaleData;
  add?.({
    data: {
      categories: { cardinal: ['one', 'other'], ordinal: ['other'] },
      fn: (n: number | string, ordinal?: boolean) => (!ordinal && Number(n) === 1 ? 'one' : 'other'),
      pluralRanges: { cardinal: {}, ordinal: {} },
    },
    locale: 'rw',
  });
}
