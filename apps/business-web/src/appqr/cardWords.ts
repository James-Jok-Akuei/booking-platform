import { setupI18n, type I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { catalogFor, type AppLocale } from '../i18n';

/**
 * The counter card's words (§309), in the language chosen for the CARD — a
 * shop may run the app in English and print its card in Kinyarwanda for the
 * customers who will read it. Whole sentences, from the translators' files
 * like every other.
 */
export type CardWords = {
  headline: string;
  lead: string;
  steps: [string, string, string];
  promise: string;
  scan: string;
};

export async function languageFor(locale: AppLocale): Promise<I18n> {
  return setupI18n({ locale, messages: { [locale]: await catalogFor(locale) } });
}

export function cardWords(i18n: I18n, shop: string): CardWords {
  return {
    headline: i18n._(msg`Your next visit, booked in seconds.`),
    lead: i18n._(msg`Scan with your phone’s camera to get the BwanguReservations app.`),
    steps: [i18n._(msg`Scan the code`), i18n._(msg`Get the app`), i18n._(msg`Book ${shop} again`)],
    promise: i18n._(msg`Pick a time, pay a small deposit with MTN MoMo, and show your code when you arrive.`),
    scan: i18n._(msg`Scan with your camera`),
  };
}
