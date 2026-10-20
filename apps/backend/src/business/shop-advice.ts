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

/** "Kimironko", "Kimironko and Remera", "your 4 branches". */
const branchWords = (names: string[]) =>
  names.length > 3
    ? `your ${names.length} branches`
    : names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const services = (n: number) => `${n} ${n === 1 ? 'service' : 'services'}`;

/** The checklist, in the order a customer meets the shop. */
export function adviceItems(shop: AdviceShop): AdviceItem[] {
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

  return [
    {
      key: 'cover',
      done: Boolean(shop.coverImageUrl),
      title: 'A cover photo',
      why: 'the first thing customers see on your page',
    },
    { key: 'logo', done: Boolean(shop.logoUrl), title: 'Your logo', why: 'it sits on every card customers see of you' },
    {
      key: 'about',
      done: (shop.description ?? '').trim().length >= ABOUT_MIN_LENGTH,
      title: 'A few lines about what you do',
      why: 'customers read them before they book',
    },
    {
      key: 'type',
      done: shop.subcategoryId !== null,
      title: 'Your category and type',
      why: 'how customers find you when they browse',
    },
    { key: 'phone', done: Boolean(shop.phone?.trim()), title: 'A phone number', why: 'so customers can reach you' },
    {
      key: 'gallery',
      done: noPhotos.length === 0,
      title: noPhotos.length ? `Photos of ${branchWords(noPhotos)}` : 'Photos of every branch',
      why: 'customers want to see the place they are walking into',
    },
    {
      key: 'hours',
      done: noHours.length === 0,
      title: noHours.length ? `Opening hours at ${branchWords(noHours)}` : 'Opening hours at every branch',
      why: 'without hours, nothing there can be booked',
    },
    {
      key: 'where',
      done: notFound.length === 0,
      title: notFound.length ? `A map pin and district for ${branchWords(notFound)}` : 'Every branch on the map',
      why: 'how customers nearby find you',
    },
    {
      key: 'service-photos',
      done: noPicture === 0,
      title: noPicture ? `Photos on ${services(noPicture)}` : 'A photo on every service',
      why: 'a service with a photo is easier to choose',
    },
    {
      key: 'service-words',
      done: noWords === 0,
      title: noWords ? `A description on ${services(noWords)}` : 'A description on every service',
      why: 'shown under “About this service” before they book',
    },
    {
      key: 'payout',
      done: shop.payoutDestinations.length > 0,
      title: 'A payout number',
      why: 'your share of each deposit is paid to it',
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

/** The sentence the list hangs from, in the approval notice and in the console's preview. */
export const ADVICE_LEAD =
  'Shops with clear, high-resolution photos and full details get booked far more often. ' +
  'Before you post, finish your shop by adding:';
