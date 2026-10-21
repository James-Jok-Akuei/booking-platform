import type { Category } from '../api/business';
import { t } from '@lingui/core/macro';

/**
 * "Grow your ___." — a few words for every kind of shop on the platform
 * (§284), keyed by the category's icon word, which does not change when a
 * category is renamed. Short enough to stay on one line of the headline, on a
 * phone and on a laptop.
 *
 * Built when asked for, so the words are in the app's language (§308); each
 * follows "Grow your" on the sign-in page, lower case.
 */
const phrases = (): Record<string, string[]> => ({
  sparkles: [t`barbershop`, t`salon`, t`spa`, t`nail studio`],
  car: [t`garage`, t`car wash`, t`driving school`],
  briefcase: [t`consultancy`, t`practice`, t`tutoring centre`],
  dumbbell: [t`gym`, t`sports club`],
  camera: [t`photo studio`, t`creative studio`],
  utensils: [t`restaurant`, t`café`],
  'heart-pulse': [t`yoga studio`, t`wellness centre`],
  mountain: [t`tour company`, t`safari business`],
  bed: [t`hotel`, t`guesthouse`],
  'home-tools': [t`cleaning firm`, t`repair service`],
  paw: [t`pet salon`, t`vet clinic`],
  shirt: [t`tailor shop`, t`boutique`],
  people: [t`classes`, t`cooking school`],
  ticket: [t`cinema`, t`live shows`],
  'calendar-star': [t`events company`, t`venue`],
  stethoscope: [t`clinic`, t`dental practice`],
});


/**
 * The words, one category at a time — barbershop, garage, consultancy, gym…
 * then salon, car wash, practice… — for the categories that are
 * switched on (`categories`, from the admin console), or for all of them until
 * those have loaded. A category added later with no words of its own still
 * appears, by its name.
 */
export function growWords(categories?: Pick<Category, 'icon' | 'name'>[]): string[] {
  const PHRASES = phrases();
  // The order categories take turns in, so the first words already show the range.
  const ORDER = Object.keys(PHRASES);
  const live = categories
    ? [
        ...ORDER.filter((icon) => categories.some((c) => c.icon === icon)),
        ...categories.filter((c) => !c.icon || !PHRASES[c.icon]).map((c) => c.name),
      ]
    : ORDER;
  const lists = live.map((key) => PHRASES[key] ?? [key.toLowerCase()]);
  const longest = Math.max(0, ...lists.map((l) => l.length));
  const words: string[] = [];
  for (let round = 0; round < longest; round += 1) {
    for (const list of lists) if (list[round]) words.push(`${list[round]}.`);
  }
  return words;
}
