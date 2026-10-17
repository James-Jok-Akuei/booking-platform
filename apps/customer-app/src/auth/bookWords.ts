import type { Category } from '../api/discovery';

/**
 * "Book your next ___." — a few words for every kind of place on the platform
 * (§284), keyed by the category's icon word, which does not change when a
 * category is renamed. Short on purpose: the word is a headline on a phone
 * and must stay on one line.
 */
const PHRASES: Record<string, string[]> = {
  sparkles: ['haircut', 'braids', 'massage', 'facial'],
  car: ['car service', 'car wash', 'driving lesson'],
  briefcase: ['consultation', 'coaching call', 'tutoring'],
  dumbbell: ['workout', 'match', 'swim'],
  camera: ['photo shoot', 'studio session'],
  utensils: ['table', 'dinner out'],
  'heart-pulse': ['yoga class', 'therapy'],
  mountain: ['gorilla trek', 'safari'],
  bed: ['getaway', 'hotel stay'],
  'home-tools': ['home cleaning', 'plumber'],
  paw: ['pet grooming', 'vet visit'],
  shirt: ['fitting', 'alteration'],
  people: ['class', 'cooking class'],
  ticket: ['concert', 'movie night'],
  'calendar-star': ['event', 'venue'],
  stethoscope: ['check-up', 'dental visit'],
};

/** The order categories take turns in, so the first words already show the range. */
const ORDER = Object.keys(PHRASES);

/**
 * The words, one category at a time — haircut, car service, consultation,
 * workout… then braids, car wash, coaching call… — for the categories that
 * are switched on (`categories`, from the admin console), or for all of them
 * until those have loaded (the list catches up long before the last ones are
 * reached). A category added later with no words of its own
 * still appears, by its name.
 */
export function bookWords(categories?: Pick<Category, 'icon' | 'name'>[]): string[] {
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
