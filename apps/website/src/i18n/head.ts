import { msg } from '@lingui/core/macro';

/**
 * The page head's words (§308.7): the same English as index.html, so the
 * build can put each language's into its own page (plugins/language-pages.ts),
 * and the app can say them in the language chosen on the page.
 */
export const HEAD = {
  title: msg`BwanguReservations — Book real shops in Rwanda, quickly`,
  description: msg`Book your next appointment at real shops near you. Pay a small deposit with MTN MoMo, show your 6-digit code at the door.`,
  picture: msg`BwanguReservations: book your next appointment, easily — the app's Find a place and shop screens`,
};
