import { BadRequestException } from '@nestjs/common';
import { ChoiceKind } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Service choices (§300): the questions a customer answers while booking —
 * "How long is your hair?", "What size is the car?", "Any food allergies?" —
 * and what each answer adds to the price and the time.
 *
 * Every rule about them is here, as plain functions with no database, so
 * the service form, the booking, the times offered and the change after
 * booking all apply the same ones (§118).
 */

export const CHOICE_LIMITS = {
  /** Questions per service. More than six is a form, not a booking. */
  groups: 6,
  /** Answers per question. */
  options: 12,
  name: 60,
  question: 120,
  label: 60,
  description: 140,
  notePrompt: 120,
  /** The customer's note (§300.5). */
  note: 250,
  /** Per answer. Eight hours: a long braid, a full detail. */
  extraMinutes: 480,
  /** Either way: an answer can take money off as well as add it. */
  priceMinor: 100_000_000,
} as const;

/**
 * The lowest an answer may add — a negative, to take money off. Its own
 * name, written out: the contract generator cannot read a minus sign in
 * front of a name, and quietly left the price out of the shapes the apps
 * send (§300).
 */
export const LOWEST_CHOICE_PRICE_MINOR = -100_000_000;

/** Wishes and the note can be changed until this long before the visit (§300.7). */
export const CHOICES_EDITABLE_UNTIL_MINUTES = 120;

/** No booking is longer than a day, choices included — the cap a service's own length has. */
const MINUTES_PER_DAY = 1440;

// ---------- Shapes ----------

/** "Show only if": the `option`-th answer of the `group`-th question, both counted from 0. */
export interface ChoiceShowIf {
  group: number;
  option: number;
}

/** A question as the service form sends it. `id` keeps one that already exists. */
export interface ChoiceGroupInput {
  id?: string | null;
  name: string;
  question?: string | null;
  kind: ChoiceKind;
  required: boolean;
  maxPicks?: number | null;
  healthRelated: boolean;
  showIf?: ChoiceShowIf | null;
  suggestionKey?: string | null;
  options: ChoiceOptionInput[];
}

export interface ChoiceOptionInput {
  id?: string | null;
  label: string;
  description?: string | null;
  priceMinor: number;
  extraMinutes: number;
  available: boolean;
}

/** A question as stored, in order — what every rule below reads. */
export interface ChoiceGroup {
  id: string;
  name: string;
  question: string | null;
  kind: ChoiceKind;
  required: boolean;
  maxPicks: number | null;
  healthRelated: boolean;
  showIfOptionId: string | null;
  suggestionKey: string | null;
  options: ChoiceOption[];
}

export interface ChoiceOption {
  id: string;
  label: string;
  description: string | null;
  priceMinor: number;
  extraMinutes: number;
  available: boolean;
}

/**
 * One answer, as a booking keeps it (§300): the words and the amounts as
 * they were, so a shop changing its questions later never rewrites a
 * booking. The ids are only for changing wishes later; they may stop
 * existing.
 */
export interface ChoicePick {
  groupId: string;
  optionId: string;
  /** The question, by the shop's name for it ("Hair length"). */
  group: string;
  /** The answer ("Long"). */
  option: string;
  priceMinor: number;
  extraMinutes: number;
}

export interface ResolvedChoices {
  /** Shown wherever the booking is: the reservation, the shop's screens, emails. */
  picks: ChoicePick[];
  /** Health-related (§300.6): sealed, and shown only to the customer and the shop. */
  healthPicks: ChoicePick[];
  /** What the answers add, once per booking. */
  priceMinor: number;
  minutes: number;
}

function refuse(message: string): never {
  throw new BadRequestException(message);
}

/** Trimmed, with runs of spaces made one; `''` for nothing. */
const words = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** What the customer is asked. */
export const askedAs = (group: Pick<ChoiceGroup, 'name' | 'question'>) => group.question ?? group.name;

const STALE = 'These questions were changed somewhere else since you opened them. Reload, then make your change again.';

// ---------- The shop's side: what may be saved ----------

/**
 * Checks the questions a shop is saving and puts them in their stored form:
 * words tidied, every question and answer given an id (kept ones keep
 * theirs), "show only if" turned from a position into an answer's id.
 *
 * `existing` is what the service has now; an id that is not in it — or an
 * answer moved to another question — is refused, because it means the form
 * was opened before someone else saved.
 */
export function planChoiceGroups(
  input: readonly ChoiceGroupInput[],
  existing: readonly ChoiceGroup[],
  newId: () => string = randomUUID,
): ChoiceGroup[] {
  if (input.length > CHOICE_LIMITS.groups) {
    refuse(`A service can ask up to ${CHOICE_LIMITS.groups} questions.`);
  }

  const before = new Map(existing.map((group) => [group.id, group]));
  const groupIds = new Set<string>();
  const optionIds = new Set<string>();
  const names = new Set<string>();

  const planned = input.map((sent, index): ChoiceGroup => {
    const name = words(sent.name);
    if (!name) refuse(`Question ${index + 1} needs a name.`);
    if (name.length > CHOICE_LIMITS.name)
      refuse(`“${name}” is too long a name — ${CHOICE_LIMITS.name} letters at most.`);
    if (names.has(name.toLocaleLowerCase())) refuse(`There are two questions called “${name}”.`);
    names.add(name.toLocaleLowerCase());

    const question = words(sent.question) || null;
    if (question && question.length > CHOICE_LIMITS.question) {
      refuse(`The question for “${name}” is too long — ${CHOICE_LIMITS.question} letters at most.`);
    }

    let id = newId();
    let known = new Set<string>();
    if (sent.id) {
      const was = before.get(sent.id);
      if (!was || groupIds.has(sent.id)) refuse(STALE);
      id = sent.id;
      known = new Set(was.options.map((option) => option.id));
    }
    groupIds.add(id);

    if (sent.options.length === 0) refuse(`“${name}” needs at least one answer.`);
    if (sent.options.length > CHOICE_LIMITS.options) {
      refuse(`“${name}” can have up to ${CHOICE_LIMITS.options} answers.`);
    }

    const labels = new Set<string>();
    const options = sent.options.map((option, at): ChoiceOption => {
      const label = words(option.label);
      if (!label) refuse(`Answer ${at + 1} of “${name}” needs a name.`);
      if (label.length > CHOICE_LIMITS.label)
        refuse(`“${label}” is too long — ${CHOICE_LIMITS.label} letters at most.`);
      if (labels.has(label.toLocaleLowerCase())) refuse(`“${label}” is in “${name}” twice.`);
      labels.add(label.toLocaleLowerCase());

      const description = words(option.description) || null;
      if (description && description.length > CHOICE_LIMITS.description) {
        refuse(`The line under “${label}” is too long — ${CHOICE_LIMITS.description} letters at most.`);
      }
      if (!Number.isInteger(option.priceMinor) || Math.abs(option.priceMinor) > CHOICE_LIMITS.priceMinor) {
        refuse(`The price of “${label}” must be a whole amount.`);
      }
      if (
        !Number.isInteger(option.extraMinutes) ||
        option.extraMinutes < 0 ||
        option.extraMinutes > CHOICE_LIMITS.extraMinutes
      ) {
        refuse(`The extra time for “${label}” must be between 0 and ${CHOICE_LIMITS.extraMinutes} minutes.`);
      }

      let optionId = newId();
      if (option.id) {
        if (!known.has(option.id) || optionIds.has(option.id)) refuse(STALE);
        optionId = option.id;
      }
      optionIds.add(optionId);

      return {
        id: optionId,
        label,
        description,
        priceMinor: option.priceMinor,
        extraMinutes: option.extraMinutes,
        available: option.available !== false,
      };
    });

    const kind = sent.kind === ChoiceKind.MANY ? ChoiceKind.MANY : ChoiceKind.ONE;
    let maxPicks: number | null = null;
    if (kind === ChoiceKind.MANY && sent.maxPicks != null) {
      if (!Number.isInteger(sent.maxPicks) || sent.maxPicks < 1)
        refuse(`“${name}”: the most to pick must be 1 or more.`);
      // As many as there are is the same as no limit, and stored as that.
      maxPicks = sent.maxPicks < options.length ? sent.maxPicks : null;
    }

    // Health answers stay off receipts by never moving money or time (§300.6).
    if (sent.healthRelated && options.some((option) => option.priceMinor !== 0 || option.extraMinutes !== 0)) {
      refuse(
        `“${name}” is health-related, so its answers can't change the price or the time — ` +
          'that keeps anyone’s health off receipts and messages.',
      );
    }

    if (sent.required && !options.some((option) => option.available)) {
      refuse(`“${name}” must be answered, so at least one answer has to be available.`);
    }

    const suggestionKey = words(sent.suggestionKey) || null;

    return {
      id,
      name,
      question,
      kind,
      required: sent.required === true,
      maxPicks,
      healthRelated: sent.healthRelated === true,
      showIfOptionId: null,
      suggestionKey,
      options,
    };
  });

  // "Show only if" — once every answer has its id.
  input.forEach((sent, index) => {
    const condition = sent.showIf;
    if (!condition) return;
    const group = planned[index];
    if (!Number.isInteger(condition.group) || condition.group < 0 || condition.group >= index) {
      refuse(`“${group.name}” can only depend on a question above it.`);
    }
    const parent = planned[condition.group];
    if (input[condition.group].showIf) {
      refuse(
        `“${group.name}” depends on “${parent.name}”, which depends on another question itself. ` +
          'Only one step is allowed.',
      );
    }
    const option = parent.options[condition.option];
    if (!option) refuse(`“${group.name}” depends on an answer that isn't there any more.`);
    // Otherwise its answers, shown everywhere, would tell what the health answer was.
    if (parent.healthRelated && !group.healthRelated) {
      refuse(`“${group.name}” only shows after a health-related answer, so it must be health-related too.`);
    }
    group.showIfOptionId = option.id;
  });

  return planned;
}

/** The most the answers can add to a booking's length, everything picked that may be. */
export function maxExtraMinutes(groups: readonly ChoiceGroup[]): number {
  return groups.reduce((total, group) => {
    const minutes = group.options.map((option) => option.extraMinutes).sort((a, b) => b - a);
    const picks = group.kind === ChoiceKind.ONE ? 1 : (group.maxPicks ?? minutes.length);
    return total + minutes.slice(0, picks).reduce((sum, m) => sum + m, 0);
  }, 0);
}

/** Refuses questions that could make a booking longer than a day. */
export function assertFitsInADay(durationMinutes: number, groups: readonly ChoiceGroup[]) {
  if (durationMinutes + maxExtraMinutes(groups) > MINUTES_PER_DAY) {
    refuse('With the longest answers picked, a booking would last more than a day. Lower the extra minutes.');
  }
}

// ---------- The customer's side: what may be booked ----------

/** When an answer the customer sent is not one this service offers now. */
export const NO_LONGER_OFFERED = 'One of your choices has changed since you picked it. Please choose again.';

/**
 * Checks what a customer picked and works out what it adds (§300).
 *
 * - Only answers of these questions; each once.
 * - A question shown only after some answer takes picks only when that
 *   answer is picked (`alsoPicked` counts as picked too — the answers kept
 *   from the booking when wishes change).
 * - Pick one: at most one. Pick several: at most `maxPicks`.
 * - Answers marked "not available now" cannot be picked — except ones in
 *   `stillPicked`, already on the booking when wishes change: a window seat
 *   taken off the menu since does not stop someone changing their note.
 * - A required question that shows must be answered — unless `partial`,
 *   for the times offered while the customer is still choosing.
 *
 * Health answers are returned apart, with no amounts; the others in the
 * order the shop asks them.
 */
export function resolvePicks(
  groups: readonly ChoiceGroup[],
  optionIds: readonly string[],
  options: { partial?: boolean; alsoPicked?: readonly string[]; stillPicked?: ReadonlySet<string> } = {},
): ResolvedChoices {
  const offered = new Set(groups.flatMap((group) => group.options.map((option) => option.id)));
  const chosen = new Set<string>();
  for (const id of optionIds) {
    if (chosen.has(id)) refuse('The same answer was sent twice.');
    if (!offered.has(id)) refuse(NO_LONGER_OFFERED);
    chosen.add(id);
  }
  const picked = new Set([...chosen, ...(options.alsoPicked ?? [])]);

  const result: ResolvedChoices = { picks: [], healthPicks: [], priceMinor: 0, minutes: 0 };
  for (const group of groups) {
    const mine = group.options.filter((option) => chosen.has(option.id));
    const asked = askedAs(group);

    if (group.showIfOptionId && !picked.has(group.showIfOptionId)) {
      if (mine.length > 0) refuse(`“${asked}” doesn't go with what else you picked. Please choose again.`);
      continue;
    }
    const unavailable = mine.find((option) => !option.available && !options.stillPicked?.has(option.id));
    if (unavailable) refuse(`“${unavailable.label}” isn't available right now. Please pick another answer.`);
    if (group.kind === ChoiceKind.ONE && mine.length > 1) refuse(`Pick one answer for “${asked}”.`);
    if (group.kind === ChoiceKind.MANY && group.maxPicks !== null && mine.length > group.maxPicks) {
      refuse(`Pick up to ${group.maxPicks} for “${asked}”.`);
    }
    if (group.required && mine.length === 0 && !options.partial) refuse(`Please answer “${asked}”.`);

    for (const option of mine) {
      const pick: ChoicePick = {
        groupId: group.id,
        optionId: option.id,
        group: group.name,
        option: option.label,
        priceMinor: option.priceMinor,
        extraMinutes: option.extraMinutes,
      };
      if (group.healthRelated) {
        result.healthPicks.push({ ...pick, priceMinor: 0, extraMinutes: 0 });
      } else {
        result.picks.push(pick);
        result.priceMinor += option.priceMinor;
        result.minutes += option.extraMinutes;
      }
    }
  }
  return result;
}

/**
 * A wish (§300.7): a question whose answers change neither the price nor
 * the time — "no salt", "a quiet room", allergies. Wishes can be changed
 * after booking; anything else is fixed once booked.
 */
export const isWish = (group: Pick<ChoiceGroup, 'options'>) =>
  group.options.every((option) => option.priceMinor === 0 && option.extraMinutes === 0);

// ---------- The price on a card ----------

/**
 * The price a card shows as "from …" (§300.3), or null when the plain price
 * is the price.
 *
 * "From" when a question that must be answered — and always shows — has
 * answers at different prices (long hair costs more), or when the shop
 * confirms the price after seeing the job. The number is the cheapest a
 * booking for one can be: the price after any sale plus the cheapest
 * available answer to each such question, never below nothing.
 */
export function startingPriceMinor(
  groups: ReadonlyArray<
    Pick<ChoiceGroup, 'required' | 'showIfOptionId'> & {
      options: ReadonlyArray<Pick<ChoiceOption, 'priceMinor' | 'available'>>;
    }
  >,
  unitPriceMinor: number,
  priceConfirmedAtShop: boolean,
): number | null {
  let lowest = 0;
  let varies = false;
  for (const group of groups) {
    if (!group.required || group.showIfOptionId) continue;
    const prices = group.options.filter((option) => option.available).map((option) => option.priceMinor);
    if (prices.length === 0) continue;
    const cheapest = Math.min(...prices);
    lowest += cheapest;
    if (Math.max(...prices) !== cheapest) varies = true;
  }
  if (!varies && !priceConfirmedAtShop && lowest === 0) return null;
  return Math.max(0, unitPriceMinor + lowest);
}

/** The customer's note (§300.5): tidied, at most 250 letters, nothing stored as null. */
export function tidyNote(note: string | null | undefined): string | null {
  const text = (note ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length > CHOICE_LIMITS.note) refuse(`Your note is too long — ${CHOICE_LIMITS.note} letters at most.`);
  return text;
}
