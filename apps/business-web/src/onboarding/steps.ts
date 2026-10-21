import type { Readiness, ReadinessKey } from '../api/business';
import type { IconName } from '../ui/Icon';
import { t } from '@lingui/core/macro';

/**
 * Setting up a shop, in four short steps and a send-off (§256).
 *
 * Only what a shop cannot go live without is asked, in the order a seller
 * thinks of it: who you are, where you are, what you sell — and, optionally,
 * where to send your money. Everything else (photos, a description, more
 * branches, your team, time off) is added later, from the app, when it suits
 * the seller. Every step can be skipped; only sending for review waits for the
 * required ones (§255).
 */
export type StepKey = 'shop' | 'branch' | 'service' | 'paid' | 'review';

export const STEPS: Array<{ key: StepKey; title: string; short: string; icon: IconName; keys: ReadinessKey[]; optional?: boolean }> = [
  {
    key: 'shop',
    get title() { return t`Your shop`; },
    get short() { return t`Name, type and phone`; },
    icon: 'store',
    keys: ['name', 'type', 'phone']
  },
  {
    key: 'branch',
    get title() { return t`Where you are`; },
    get short() { return t`A branch and its hours`; },
    icon: 'pin',
    keys: ['branch', 'hours']
  },
  {
    key: 'service',
    get title() { return t`Your first service`; },
    get short() { return t`Something to book`; },
    icon: 'tag',
    keys: ['service']
  },
  {
    key: 'paid',
    get title() { return t`Getting paid`; },
    get short() { return t`Optional — add it later`; },
    icon: 'wallet',
    keys: ['payout'],
    optional: true
  },
  {
    key: 'review',
    get title() { return t`Send for review`; },
    get short() { return t`We check it, you post it`; },
    icon: 'send',
    keys: []
  },
];

/**
 * The questions, one to a screen (§263): each part of setting up is asked
 * as a few short questions rather than one long form, so a screen never
 * holds more than a field or two.
 */
export type Screen = 'name' | 'kind' | 'type' | 'contact' | 'address' | 'hours' | 'service' | 'price' | 'paid' | 'review';

export const SCREENS: Array<{ key: Screen; section: StepKey }> = [
  { key: 'name', section: 'shop' },
  { key: 'kind', section: 'shop' },
  { key: 'type', section: 'shop' },
  { key: 'contact', section: 'shop' },
  { key: 'address', section: 'branch' },
  { key: 'hours', section: 'branch' },
  { key: 'service', section: 'service' },
  { key: 'price', section: 'service' },
  { key: 'paid', section: 'paid' },
  { key: 'review', section: 'review' },
];

/** Where "Skip for now" leads: past the questions that need this one's answer. */
export const SKIP_TO: Record<Screen, Screen> = {
  name: 'kind',
  kind: 'contact',
  type: 'contact',
  contact: 'address',
  address: 'service',
  hours: 'service',
  service: 'paid',
  price: 'paid',
  paid: 'review',
  review: 'review',
};

export const sectionOf = (screen: Screen) => SCREENS.find((s) => s.key === screen)!.section;
export const isScreen = (value: string | null): value is Screen => SCREENS.some((s) => s.key === value);

/** Each item of the checklist, said the way a seller would, and the question that asks it. */
export const ITEM_WORDS: Record<ReadinessKey, { label: string; step: Screen; section: StepKey }> = {
  name: {
    get label() { return t`Your shop’s name`; },
    step: 'name',
    section: 'shop'
  },
  type: {
    get label() { return t`What kind of shop it is`; },
    step: 'kind',
    section: 'shop'
  },
  phone: {
    get label() { return t`A phone number`; },
    step: 'contact',
    section: 'shop'
  },
  logo: {
    get label() { return t`Your logo`; },
    step: 'contact',
    section: 'shop'
  },
  branch: {
    get label() { return t`A branch on the map`; },
    step: 'address',
    section: 'branch'
  },
  hours: {
    get label() { return t`Opening hours`; },
    step: 'hours',
    section: 'branch'
  },
  service: {
    get label() { return t`A service to book`; },
    step: 'service',
    section: 'service'
  },
  payout: {
    get label() { return t`A number to be paid on`; },
    step: 'paid',
    section: 'paid'
  },
};

/**
 * The shop's state in a word or two, the seller's words rather than the
 * status's. Approved is not live until the shop posts itself (§268).
 */
export const shopStateWord = (
  status: Readiness['status'],
  paused: boolean,
  submittedAt: string | null | undefined,
  posted = true,
) =>
  status === 'APPROVED'
    ? !posted
      ? t`Not posted`
      : paused
        ? t`Paused`
        : t`Live`
    : status === 'PENDING'
      ? submittedAt
        ? t`In review`
        : t`Setting up`
      : status === 'REJECTED'
        ? t`Needs a change`
        : t`Suspended`;

export const isDone = (readiness: Readiness | undefined, keys: ReadinessKey[]) =>
  Boolean(readiness) && keys.every((k) => readiness!.items.find((i) => i.key === k)?.done);

/** The first question still to answer — where "Continue setting up" leads. */
export function nextStep(readiness: Readiness | undefined): Screen {
  if (!readiness) return 'name';
  const done = (key: ReadinessKey) => readiness.items.find((i) => i.key === key)?.done ?? false;
  if (!done('name')) return 'name';
  if (!done('type')) return 'kind';
  if (!done('phone')) return 'contact';
  if (!done('branch')) return 'address';
  if (!done('hours')) return 'hours';
  if (!done('service')) return 'service';
  return 'review';
}

/** A week of hours, as the server takes it: all seven days, closed ones marked. */
export const HOURS_PRESETS: Array<{ key: string; label: string; days: number[]; open: string; close: string }> = [
  {
    key: 'mon-sat',
    get label() { return t`Monday to Saturday`; },
    days: [1, 2, 3, 4, 5, 6],
    open: '08:00',
    close: '18:00'
  },
  {
    key: 'every-day',
    get label() { return t`Every day`; },
    days: [0, 1, 2, 3, 4, 5, 6],
    open: '08:00',
    close: '20:00'
  },
  {
    key: 'mon-fri',
    get label() { return t`Monday to Friday`; },
    days: [1, 2, 3, 4, 5],
    open: '08:00',
    close: '17:00'
  },
];

export const weekOf = (days: number[], open: string, close: string) =>
  Array.from({ length: 7 }, (_, dayOfWeek) =>
    days.includes(dayOfWeek)
      ? { dayOfWeek, openTime: open, closeTime: close, isClosed: false }
      : { dayOfWeek, openTime: '00:00', closeTime: '00:00', isClosed: true },
  );
