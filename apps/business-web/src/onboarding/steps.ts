import type { Readiness, ReadinessKey } from '../api/business';
import type { IconName } from '../ui/Icon';

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
  { key: 'shop', title: 'Your shop', short: 'Name, type and phone', icon: 'store', keys: ['name', 'type', 'phone'] },
  { key: 'branch', title: 'Where you are', short: 'A branch and its hours', icon: 'pin', keys: ['branch', 'hours'] },
  { key: 'service', title: 'Your first service', short: 'Something to book', icon: 'tag', keys: ['service'] },
  { key: 'paid', title: 'Getting paid', short: 'Optional — add it later', icon: 'wallet', keys: ['payout'], optional: true },
  { key: 'review', title: 'Send for review', short: 'We check it, you go live', icon: 'send', keys: [] },
];

/** Each item of the checklist, said the way a seller would. */
export const ITEM_WORDS: Record<ReadinessKey, { label: string; step: StepKey }> = {
  name: { label: 'Your shop’s name', step: 'shop' },
  type: { label: 'What kind of shop it is', step: 'shop' },
  phone: { label: 'A phone number', step: 'shop' },
  logo: { label: 'Your logo', step: 'shop' },
  branch: { label: 'A branch on the map', step: 'branch' },
  hours: { label: 'Opening hours', step: 'branch' },
  service: { label: 'A service to book', step: 'service' },
  payout: { label: 'A number to be paid on', step: 'paid' },
};

/** The shop's state in a word or two, the seller's words rather than the status's. */
export const shopStateWord = (status: Readiness['status'], paused: boolean, submittedAt: string | null | undefined) =>
  status === 'APPROVED'
    ? paused
      ? 'Paused'
      : 'Live'
    : status === 'PENDING'
      ? submittedAt
        ? 'In review'
        : 'Setting up'
      : status === 'REJECTED'
        ? 'Needs a change'
        : 'Suspended';

export const isDone = (readiness: Readiness | undefined, keys: ReadinessKey[]) =>
  Boolean(readiness) && keys.every((k) => readiness!.items.find((i) => i.key === k)?.done);

/** The first step still to do — where "Continue setting up" leads. */
export function nextStep(readiness: Readiness | undefined): StepKey {
  if (!readiness) return 'shop';
  for (const step of STEPS) {
    if (step.key === 'review' || step.optional) continue;
    if (!isDone(readiness, step.keys)) return step.key;
  }
  return 'review';
}

/** A week of hours, as the server takes it: all seven days, closed ones marked. */
export const HOURS_PRESETS: Array<{ key: string; label: string; days: number[]; open: string; close: string }> = [
  { key: 'mon-sat', label: 'Monday to Saturday', days: [1, 2, 3, 4, 5, 6], open: '08:00', close: '18:00' },
  { key: 'every-day', label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6], open: '08:00', close: '20:00' },
  { key: 'mon-fri', label: 'Monday to Friday', days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' },
];

export const weekOf = (days: number[], open: string, close: string) =>
  Array.from({ length: 7 }, (_, dayOfWeek) =>
    days.includes(dayOfWeek)
      ? { dayOfWeek, openTime: open, closeTime: close, isClosed: false }
      : { dayOfWeek, openTime: '00:00', closeTime: '00:00', isClosed: true },
  );
