import { BusinessStatus, PayoutDestinationStatus, Prisma } from '@prisma/client';
import { adviceItems, readApprovalAdvice } from './shop-advice';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { msg } from '../i18n/say';

/**
 * What a shop needs before it can go live, in one place (§255).
 *
 * Two levels, on purpose:
 *
 *  - **Ready for review** — what the onboarding wizard asks for and a shop
 *    must have before it can send itself to be reviewed: its name, what kind
 *    of shop it is, a phone number, a branch customers can find (an address
 *    with a pin and a district), opening hours there, and one service to
 *    book. Its logo and a payout number are asked for too, but can wait.
 *  - **Able to go live** — what an administrator cannot approve without,
 *    because the shop would be listed and unbookable: a name, an open branch
 *    with hours, and a service offered there. An administrator may approve a
 *    shop that is missing its phone or its type; they may not approve one no
 *    customer could book.
 */
export const READINESS_SELECT = {
  name: true,
  phone: true,
  subcategoryId: true,
  logoUrl: true,
  status: true,
  statusReason: true,
  submittedAt: true,
  lastRejectionReason: true,
  publishedAt: true,
  // What would make it easier to book, beyond going live (§303).
  coverImageUrl: true,
  description: true,
  approvalAdvice: true,
  locations: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      districtId: true,
      latitude: true,
      longitude: true,
      hours: { where: { isClosed: false }, select: { id: true }, take: 1 },
      _count: { select: { media: true } },
    },
  },
  services: {
    where: { isActive: true },
    select: {
      id: true,
      description: true,
      _count: { select: { images: true } },
      locations: {
        where: { isOffered: true, location: { isActive: true } },
        select: { locationId: true },
      },
    },
  },
  payoutDestinations: {
    where: { status: { in: [PayoutDestinationStatus.UNVERIFIED, PayoutDestinationStatus.VERIFIED] } },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.BusinessProfileSelect;

export type ReadinessShop = Prisma.BusinessProfileGetPayload<{ select: typeof READINESS_SELECT }>;

export type ReadinessKey = 'name' | 'type' | 'phone' | 'branch' | 'hours' | 'service' | 'logo' | 'payout';

export interface ReadinessItem {
  key: ReadinessKey;
  /** Whether the shop can be sent for review without it. */
  required: boolean;
  done: boolean;
}

/** The checklist, in the order the wizard asks. */
export function readinessItems(shop: ReadinessShop): ReadinessItem[] {
  const findable = shop.locations.filter(
    (l) => l.districtId !== null && l.latitude !== null && l.longitude !== null,
  );
  const open = shop.locations.filter((l) => l.hours.length > 0);
  const openIds = new Set(open.map((l) => l.id));
  return [
    { key: 'name', required: true, done: Boolean(shop.name?.trim()) },
    { key: 'type', required: true, done: shop.subcategoryId !== null },
    { key: 'phone', required: true, done: Boolean(shop.phone?.trim()) },
    { key: 'branch', required: true, done: findable.length > 0 },
    { key: 'hours', required: true, done: open.length > 0 },
    {
      key: 'service',
      required: true,
      done: shop.services.some((s) => s.locations.some((o) => openIds.has(o.locationId))),
    },
    { key: 'logo', required: false, done: Boolean(shop.logoUrl) },
    { key: 'payout', required: false, done: shop.payoutDestinations.length > 0 },
  ];
}

/** Every required item is done. */
export const isReadyForReview = (shop: ReadinessShop) =>
  readinessItems(shop).every((item) => !item.required || item.done);

/** In words, for a refusal: "its phone number and a service to book". */
export const READINESS_WORDS: Record<ReadinessKey, string> = {
  name: msg('its name'),
  type: msg('what kind of shop it is'),
  phone: msg('a phone number'),
  branch: msg('a branch with its address, map pin and district'),
  hours: msg('opening hours'),
  service: msg('a service to book'),
  logo: msg('a logo'),
  payout: msg('a payout number'),
};

/** The same, for what approval would still need (§255). */
export const GO_LIVE_WORDS: Record<ReadinessKey, string> = {
  ...READINESS_WORDS,
  branch: msg('an open branch'),
  hours: msg('opening hours at a branch'),
  service: msg('a service offered at an open branch'),
};

export const listInWords = (keys: ReadinessKey[], dictionary: Record<ReadinessKey, string> = READINESS_WORDS) => {
  const words = keys.map((k) => dictionary[k]);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
};

/**
 * What an administrator cannot approve without (§255): a shop listed with no
 * name, no open branch or nothing to book is one no customer can use.
 */
export function goLiveGaps(shop: ReadinessShop): ReadinessKey[] {
  const gaps: ReadinessKey[] = [];
  if (!shop.name?.trim()) gaps.push('name');
  if (shop.locations.length === 0) gaps.push('branch');
  const open = new Set(shop.locations.filter((l) => l.hours.length > 0).map((l) => l.id));
  if (shop.locations.length > 0 && open.size === 0) gaps.push('hours');
  if (!shop.services.some((s) => s.locations.some((o) => open.has(o.locationId)))) gaps.push('service');
  return gaps;
}

/** Whether the shop can send itself for review now: it is ready, and it is not already waiting or decided. */
export const canSubmit = (shop: ReadinessShop) =>
  isReadyForReview(shop) &&
  ((shop.status === BusinessStatus.PENDING && shop.submittedAt === null) || shop.status === BusinessStatus.REJECTED);

/**
 * Whether the shop can post itself for customers now (§268): approved, not yet
 * posted, and still something a customer could book — a service or the hours
 * removed since approval would post an empty listing.
 */
export const canPublish = (shop: ReadinessShop) =>
  shop.status === BusinessStatus.APPROVED && shop.publishedAt === null && goLiveGaps(shop).length === 0;

/** The readiness as the apps receive it. */
export function readinessView(shop: ReadinessShop, locale: Locale = DEFAULT_LOCALE) {
  const items = readinessItems(shop);
  return {
    status: shop.status,
    statusReason: shop.statusReason,
    submittedAt: shop.submittedAt ? shop.submittedAt.toISOString() : null,
    lastRejectionReason: shop.lastRejectionReason,
    publishedAt: shop.publishedAt ? shop.publishedAt.toISOString() : null,
    items,
    ready: items.every((item) => !item.required || item.done),
    canSubmit: canSubmit(shop),
    goLiveGaps: goLiveGaps(shop),
    canPublish: canPublish(shop),
    // What would make it easier to book (§303), and what we advised on approval.
    advice: adviceItems(shop, locale),
    approvalAdvice: readApprovalAdvice(shop.approvalAdvice),
  };
}
