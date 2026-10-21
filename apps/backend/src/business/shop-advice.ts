import { say } from '../i18n/say';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
/**
 * What would make a shop easier to book (§303) — beyond what approval needs.
 *
 * The same checks as the business app's "Make your shop stand out"
 * (`apps/business-web/src/ads/useAdData.ts`), counted the way customers meet
 * the shop: a cover, a logo, a few lines about it, its kind and its phone;
 * photos, hours and a place on the map at every open branch; a photo and a few
 * words on every service on sale; and a number to be paid to. None of it is
 * needed to go live (§255). All of it decides whether somebody books.
 *
 * An administrator approving a shop sends the ones still missing as advice,
 * in these words, and the shop sees them on its dashboard until it posts.
 */

export const ADVICE_KEYS = [
  'cover',
  'logo',
  'about',
  'type',
  'phone',
  'gallery',
  'hours',
  'where',
  'service-photos',
  'service-words',
  'payout',
] as const;
export type AdviceKey = (typeof ADVICE_KEYS)[number];

/** "A few lines", as the business app counts them. */
export const ABOUT_MIN_LENGTH = 40;
/** The longest note a reviewer may add. */
export const ADVICE_NOTE_MAX = 600;

/** What the advice reads — the readiness select provides it (`readiness.ts`). */
export interface AdviceShop {
  coverImageUrl: string | null;
  logoUrl: string | null;
  description: string | null;
  phone: string | null;
  subcategoryId: string | null;
  /** Open branches, oldest first. */
  locations: Array<{
    name: string;
    districtId: string | null;
    latitude: unknown;
    longitude: unknown;
    hours: unknown[];
    _count: { media: number };
  }>;
  /** Active services, with the open branches they are offered at. */
  services: Array<{ description: string | null; _count: { images: number }; locations: unknown[] }>;
  payoutDestinations: unknown[];
}

export interface AdviceItem {
  key: AdviceKey;
  done: boolean;
  /** In the shop's words: "Photos of Kimironko". */
  title: string;
  /** Why it matters, as the shop reads it. */
  why: string;
}

/** "Kimironko", "Kimironko and Remera", "your 4 branches" — in the reader's language (§308). */
const branchWords = (names: string[], locale: Locale) =>
  names.length > 3
    ? say(locale, 'your {count} branches', { count: names.length })
    : names.length <= 1
      ? (names[0] ?? '')
      : say(locale, '{some} and {last}', { some: names.slice(0, -1).join(', '), last: names[names.length - 1] });

/**
 * The checklist, in the order a customer meets the shop — in the shop's
 * language (§308): the seller app shows it, and the approval notice sends it.
 */
export function adviceItems(shop: AdviceShop, locale: Locale = DEFAULT_LOCALE): AdviceItem[] {
  const branches = shop.locations;
  const noPhotos = branches.filter((b) => b._count.media === 0).map((b) => b.name);
  const noHours = branches.filter((b) => b.hours.length === 0).map((b) => b.name);
  const notFound = branches
    .filter((b) => b.districtId === null || b.latitude === null || b.longitude === null)
    .map((b) => b.name);
  // On sale: offered at an open branch. A service nobody can book needs no photo yet.
  const onSale = shop.services.filter((s) => s.locations.length > 0);
  const noPicture = onSale.filter((s) => s._count.images === 0).length;
  const noWords = onSale.filter((s) => !s.description?.trim()).length;
  const l = locale;

  return [
    {
      key: 'cover',
      done: Boolean(shop.coverImageUrl),
      title: say(l, 'A cover photo'),
      why: say(l, 'the first thing customers see on your page'),
    },
    { key: 'logo', done: Boolean(shop.logoUrl), title: say(l, 'Your logo'), why: say(l, 'it sits on every card customers see of you') },
    {
      key: 'about',
      done: (shop.description ?? '').trim().length >= ABOUT_MIN_LENGTH,
      title: say(l, 'A few lines about what you do'),
      why: say(l, 'customers read them before they book'),
    },
    {
      key: 'type',
      done: shop.subcategoryId !== null,
      title: say(l, 'Your category and type'),
      why: say(l, 'how customers find you when they browse'),
    },
    { key: 'phone', done: Boolean(shop.phone?.trim()), title: say(l, 'A phone number'), why: say(l, 'so customers can reach you') },
    {
      key: 'gallery',
      done: noPhotos.length === 0,
      title: noPhotos.length
        ? say(l, 'Photos of {branches}', { branches: branchWords(noPhotos, l) })
        : say(l, 'Photos of every branch'),
      why: say(l, 'customers want to see the place they are walking into'),
    },
    {
      key: 'hours',
      done: noHours.length === 0,
      title: noHours.length
        ? say(l, 'Opening hours at {branches}', { branches: branchWords(noHours, l) })
        : say(l, 'Opening hours at every branch'),
      why: say(l, 'without hours, nothing there can be booked'),
    },
    {
      key: 'where',
      done: notFound.length === 0,
      title: notFound.length
        ? say(l, 'A map pin and district for {branches}', { branches: branchWords(notFound, l) })
        : say(l, 'Every branch on the map'),
      why: say(l, 'how customers nearby find you'),
    },
    {
      key: 'service-photos',
      done: noPicture === 0,
      title: noPicture
        ? say(l, '{count, plural, one {Photos on # service} other {Photos on # services}}', { count: noPicture })
        : say(l, 'A photo on every service'),
      why: say(l, 'a service with a photo is easier to choose'),
    },
    {
      key: 'service-words',
      done: noWords === 0,
      title: noWords
        ? say(l, '{count, plural, one {A description on # service} other {A description on # services}}', { count: noWords })
        : say(l, 'A description on every service'),
      why: say(l, 'shown under “About this service” before they book'),
    },
    {
      key: 'payout',
      done: shop.payoutDestinations.length > 0,
      title: say(l, 'A payout number'),
      why: say(l, 'your share of each deposit is paid to it'),
    },
  ];
}

/** The advice as kept on the shop (`approvalAdvice`). */
export interface ApprovalAdvice {
  keys: AdviceKey[];
  note: string | null;
  at: string;
}

/** Read back from the column, keeping only what is still a known item. */
export function readApprovalAdvice(value: unknown): ApprovalAdvice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { keys?: unknown; note?: unknown; at?: unknown };
  if (typeof raw.at !== 'string') return null;
  const keys = Array.isArray(raw.keys)
    ? raw.keys.filter((k): k is AdviceKey => (ADVICE_KEYS as readonly string[]).includes(k as string))
    : [];
  return { keys, note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : null, at: raw.at };
}

/**
 * What an approval sends (§303): of the keys the reviewer chose, those still
 * missing now — the shop may have added a photo while the panel was open —
 * in the checklist's order, and their note, tidied.
 */
export function adviceToSend(items: AdviceItem[], keys: readonly string[] = [], note?: string | null) {
  const chosen = new Set(keys);
  const send = items.filter((item) => !item.done && chosen.has(item.key));
  // One paragraph, however it was typed: the notice keeps it whole, in quotes.
  const words = (note ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return { items: send, note: words ? words.slice(0, ADVICE_NOTE_MAX) : null };
}

/** The sentence the list hangs from, in the approval notice and in the console's preview (§308: in the reader's language). */
export const adviceLead = (locale: Locale = DEFAULT_LOCALE) =>
  say(
    locale,
    'Shops with clear, high-resolution photos and full details get booked far more often. Before you post, finish your shop by adding:',
  );

/** The lead in English, for the console (which is in English). */
export const ADVICE_LEAD = adviceLead();
