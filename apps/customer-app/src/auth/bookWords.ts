import type { Category } from '../api/discovery';
import { t } from '@lingui/core/macro';

/**
 * "Book your next ___." — a few words for every kind of place on the platform
 * (§284), keyed by the category's icon word, which does not change when a
 * category is renamed. Short on purpose: the word is a headline on a phone
 * and must stay on one line.
 *
 * Built when asked for, so the words are in the app's language (§308); each
 * follows "Book your next" on the sign-in screen, lower case.
 */
const phrases = (): Record<string, string[]> => ({
  sparkles: [t`haircut`, t`braids`, t`massage`, t`facial`],
  car: [t`car service`, t`car wash`, t`driving lesson`],
  briefcase: [t`consultation`, t`coaching call`, t`tutoring`],
  dumbbell: [t`workout`, t`match`, t`swim`],
  camera: [t`photo shoot`, t`studio session`],
  utensils: [t`table`, t`dinner out`],
  'heart-pulse': [t`yoga class`, t`therapy`],
  mountain: [t`gorilla trek`, t`safari`],
  bed: [t`getaway`, t`hotel stay`],
  'home-tools': [t`home cleaning`, t`plumber`],
  paw: [t`pet grooming`, t`vet visit`],
  shirt: [t`fitting`, t`alteration`],
  people: [t`class`, t`cooking class`],
  ticket: [t`concert`, t`movie night`],
  'calendar-star': [t`event`, t`venue`],
  stethoscope: [t`check-up`, t`dental visit`],
});

/**
 * The words, one category at a time — haircut, car service, consultation,
 * workout… then braids, car wash, coaching call… — for the categories that
 * are switched on (`categories`, from the admin console), or for all of them
 * until those have loaded (the list catches up long before the last ones are
 * reached). A category added later with no words of its own
 * still appears, by its name.
 */
export function bookWords(categories?: Pick<Category, 'icon' | 'name'>[]): string[] {
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
