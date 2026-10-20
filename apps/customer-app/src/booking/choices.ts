import type { ShopService } from '../api/discovery';

/**
 * Service choices (§300) on the customer's side: which questions show, what
 * may be picked, and what the answers add. The SAME rules the server keeps
 * (`service-choices.ts`), so the total and the times shown are the ones the
 * booking makes — the server still checks everything.
 */

export type ChoiceGroup = ShopService['choiceGroups'][number];
export type ChoiceOption = ChoiceGroup['options'][number];

/** What the customer is asked. */
export const askedAs = (group: Pick<ChoiceGroup, 'name' | 'question'>) => group.question ?? group.name;

/** "Pick 1", "Choose up to 2", "Choose any". */
export const limitWords = (group: ChoiceGroup) =>
  group.kind === 'ONE' ? 'Pick 1' : group.maxPicks ? `Choose up to ${group.maxPicks}` : 'Choose any';

/** A question shows when it has no condition, or its answer is picked. */
export const shows = (group: ChoiceGroup, picked: ReadonlySet<string>) =>
  !group.showIfOptionId || picked.has(group.showIfOptionId);

export const visibleGroups = (groups: ChoiceGroup[], picked: ReadonlySet<string>) =>
  groups.filter((group) => shows(group, picked));

/** Answers to questions that no longer show fall away — and the ones that hung on them. */
function prune(groups: ChoiceGroup[], picked: Set<string>): Set<string> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (shows(group, picked)) continue;
      for (const option of group.options) {
        if (picked.delete(option.id)) changed = true;
      }
    }
  }
  return picked;
}

/**
 * Tapping an answer: pick one replaces the last; pick several adds or takes
 * away, up to its most. Returns the same set when nothing may change.
 */
export function toggle(
  groups: ChoiceGroup[],
  picked: ReadonlySet<string>,
  group: ChoiceGroup,
  option: ChoiceOption,
): Set<string> {
  const next = new Set(picked);
  if (next.has(option.id)) {
    next.delete(option.id);
  } else {
    if (!option.available) return new Set(picked);
    if (group.kind === 'ONE') {
      group.options.forEach((o) => next.delete(o.id));
    } else if (group.maxPicks && group.options.filter((o) => next.has(o.id)).length >= group.maxPicks) {
      return new Set(picked);
    }
    next.add(option.id);
  }
  return prune(groups, next);
}

export type Tally = {
  /** Added once to the booking, whatever the number of people (§300.3). */
  priceMinor: number;
  /** Added to its length (§300.4). */
  minutes: number;
  /** Questions that show, must be answered, and are not yet. */
  missing: ChoiceGroup[];
  /** The answers to send: only those of questions that show, in the shop's order. */
  optionIds: string[];
  /** What was picked, for reading back: the question's name and the answer. */
  lines: Array<{ group: ChoiceGroup; option: ChoiceOption }>;
};

/** What the answers add, and what is still to answer. Health answers are always free. */
export function tally(groups: ChoiceGroup[], picked: ReadonlySet<string>): Tally {
  const result: Tally = { priceMinor: 0, minutes: 0, missing: [], optionIds: [], lines: [] };
  for (const group of visibleGroups(groups, picked)) {
    const mine = group.options.filter((option) => picked.has(option.id));
    if (group.required && mine.length === 0) result.missing.push(group);
    for (const option of mine) {
      result.optionIds.push(option.id);
      result.lines.push({ group, option });
      if (group.healthRelated) continue;
      result.priceMinor += option.priceMinor;
      result.minutes += option.extraMinutes;
    }
  }
  return result;
}

/** A wish (§300.7): changes neither the price nor the time, so it can change after booking. */
export const isWish = (group: ChoiceGroup) =>
  group.options.every((option) => option.priceMinor === 0 && option.extraMinutes === 0);

/** "+RWF 5,000 · +30 min", "−RWF 2,000", or nothing for a free answer. */
export function addsWords(
  option: Pick<ChoiceOption, 'priceMinor' | 'extraMinutes'>,
  format: (minor: number) => string,
): string | null {
  const parts: string[] = [];
  if (option.priceMinor > 0) parts.push(`+${format(option.priceMinor)}`);
  if (option.priceMinor < 0) parts.push(`−${format(-option.priceMinor)}`);
  if (option.extraMinutes > 0) parts.push(`+${option.extraMinutes} min`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * What was picked and written on a service's page, kept while the customer
 * signs in and comes back (§300) — in memory only, never stored: answers can
 * be private, and they are only worth keeping for the next few minutes.
 */
const drafts = new Map<string, { picked: string[]; note: string }>();

export const bookingDraft = {
  get: (key: string) => drafts.get(key),
  set: (key: string, value: { picked: ReadonlySet<string>; note: string }) =>
    drafts.set(key, { picked: [...value.picked], note: value.note }),
  clear: (key: string) => drafts.delete(key),
};

/**
 * A card's price (§300.3): "from RWF 5,000" when a question that must be
 * answered changes it, or the shop confirms it after seeing the job.
 */
export const cardPrice = (
  service: { priceMinor: number; startingPriceMinor: number | null },
  format: (minor: number) => string,
) => (service.startingPriceMinor !== null ? `from ${format(service.startingPriceMinor)}` : format(service.priceMinor));
