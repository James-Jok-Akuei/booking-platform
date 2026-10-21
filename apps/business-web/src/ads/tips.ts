import type { IconName } from '../ui/Icon';

import { t } from '@lingui/core/macro';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** How to open search here: keys on a computer, the magnifying glass on a phone. */
export const searchHow = () => (touch ? t`Tap the magnifying glass at the top` : t`Press ${isMac ? '⌘' : 'Ctrl'} K`);

/**
 * "Did you know?" — one feature worth knowing, chosen by the page the seller is
 * on (§204), so the tip is about what is in front of them. Every one is
 * something the app does today.
 */
const TIPS: Record<string, { icon: IconName; title: string; text: string }> = {
  '/': {
    icon: 'search',
    get title() { return t`Jump anywhere`; },
    get text() { return t`${searchHow()} and type any word — “prices”, “holiday”, “momo” — to go straight there.`; },
  },
  '/appointments': {
    icon: 'ticket',
    get title() { return t`Six digits, no button`; },
    get text() { return t`When a customer reads out their code, the sixth digit checks them in on its own.`; },
  },
  '/services': {
    icon: 'image',
    get title() { return t`Choose the cover`; },
    get text() { return t`“Make cover” picks the photo customers see on the service’s card in the app.`; },
  },
  '/hours': {
    icon: 'users',
    get title() { return t`People served at once`; },
    get text() { return t`A booking for 3 people takes 3 places. When every place is taken, the time shows as booked.`; },
  },
  '/closures': {
    icon: 'calendar',
    get title() { return t`Click a day`; },
    get text() { return t`Clicking a day on the calendar fills in the date in both forms.`; },
  },
  '/profile': {
    icon: 'eye',
    get title() { return t`See what customers see`; },
    get text() { return t`The phone beside your details shows your page as customers will see it, as you type.`; },
  },
  '/messages': {
    icon: 'send',
    get title() { return t`Quicker replies`; },
    get text() { return t`Enter sends; Shift + Enter starts a new line. Photos go with the paperclip.`; },
  },
  '/reviews': {
    icon: 'star',
    get title() { return t`A reply is public`; },
    get text() { return t`Everyone who reads a review reads your reply too. A calm, specific one helps the next customer decide.`; },
  },
  '/getting-paid': {
    icon: 'wallet',
    get title() { return t`Changing your number`; },
    get text() { return t`Payouts pause until a new number is confirmed — nothing you have earned is lost.`; },
  },
  '/analytics': {
    icon: 'chart',
    get title() { return t`How the app ranks you`; },
    get text() { return t`Popular means bookings weighted by rating — good reviews move you up the list customers see.`; },
  },
  '/people': {
    icon: 'shield',
    get title() { return t`Who can do what`; },
    get text() { return t`Staff can check customers in and handle bookings, but cannot change prices or hours.`; },
  },
  '/legal': {
    icon: 'legal',
    get title() { return t`Nothing stops working`; },
    get text() { return t`When a document changes, everything keeps running — agree when you have read it.`; },
  },
  '/help': {
    icon: 'paperclip',
    get title() { return t`Show us the problem`; },
    get text() { return t`Attach a screenshot, a statement or an invoice — it saves us asking.`; },
  },
};

export const tipFor = (pathname: string) =>
  TIPS[pathname] ?? TIPS[Object.keys(TIPS).find((k) => k !== '/' && pathname.startsWith(k)) ?? '/'];
