import type { IconName } from '../ui/Icon';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * "Did you know?" — one feature worth knowing, chosen by the page the seller is
 * on (§204), so the tip is about what is in front of them. Every one is
 * something the app does today.
 */
const TIPS: Record<string, { icon: IconName; title: string; text: string }> = {
  '/': {
    icon: 'search',
    title: 'Jump anywhere',
    text: `Press ${isMac ? '⌘' : 'Ctrl'} K and type any word — “prices”, “holiday”, “momo” — to go straight there.`,
  },
  '/appointments': {
    icon: 'ticket',
    title: 'Six digits, no button',
    text: 'When a customer reads out their code, the sixth digit checks them in on its own.',
  },
  '/services': {
    icon: 'image',
    title: 'Choose the cover',
    text: '“Make cover” picks the photo customers see on the service’s card in the app.',
  },
  '/hours': {
    icon: 'users',
    title: 'People served at once',
    text: 'A booking for 3 people takes 3 places. When every place is taken, the time shows as booked.',
  },
  '/closures': {
    icon: 'calendar',
    title: 'Click a day',
    text: 'Clicking a day on the calendar fills in the date in both forms.',
  },
  '/profile': {
    icon: 'eye',
    title: 'See what customers see',
    text: 'The phone beside your details shows your page as customers will see it, as you type.',
  },
  '/messages': {
    icon: 'send',
    title: 'Quicker replies',
    text: 'Enter sends; Shift + Enter starts a new line. Photos go with the paperclip.',
  },
  '/reviews': {
    icon: 'star',
    title: 'A reply is public',
    text: 'Everyone who reads a review reads your reply too. A calm, specific one helps the next customer decide.',
  },
  '/getting-paid': {
    icon: 'wallet',
    title: 'Changing your number',
    text: 'Payouts pause until a new number is confirmed — nothing you have earned is lost.',
  },
  '/analytics': {
    icon: 'chart',
    title: 'How the app ranks you',
    text: 'Popular means bookings weighted by rating — good reviews move you up the list customers see.',
  },
  '/people': {
    icon: 'shield',
    title: 'Who can do what',
    text: 'Staff can check customers in and handle bookings, but cannot change prices or hours.',
  },
  '/legal': {
    icon: 'legal',
    title: 'Nothing stops working',
    text: 'When a document changes, everything keeps running — agree when you have read it.',
  },
  '/help': {
    icon: 'paperclip',
    title: 'Show us the problem',
    text: 'Attach a screenshot, a statement or an invoice — it saves us asking.',
  },
};

export const tipFor = (pathname: string) =>
  TIPS[pathname] ?? TIPS[Object.keys(TIPS).find((k) => k !== '/' && pathname.startsWith(k)) ?? '/'];
