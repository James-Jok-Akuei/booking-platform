import type { Category } from '../api/business';

/**
 * "Grow your ___." — a few words for every kind of shop on the platform
 * (§284), keyed by the category's icon word, which does not change when a
 * category is renamed. Short enough to stay on one line of the headline, on a
 * phone and on a laptop.
 */
const PHRASES: Record<string, string[]> = {
  sparkles: ['barbershop', 'salon', 'spa', 'nail studio'],
  car: ['garage', 'car wash', 'driving school'],
  briefcase: ['consultancy', 'practice', 'tutoring centre'],
  dumbbell: ['gym', 'sports club'],
  camera: ['photo studio', 'creative studio'],
  utensils: ['restaurant', 'café'],
  'heart-pulse': ['yoga studio', 'wellness centre'],
  mountain: ['tour company', 'safari business'],
  bed: ['hotel', 'guesthouse'],
  'home-tools': ['cleaning firm', 'repair service'],
  paw: ['pet salon', 'vet clinic'],
  shirt: ['tailor shop', 'boutique'],
  people: ['classes', 'cooking school'],
  ticket: ['cinema', 'live shows'],
  'calendar-star': ['events company', 'venue'],
  stethoscope: ['clinic', 'dental practice'],
};

const ORDER = Object.keys(PHRASES);

/**
 * The words, one category at a time — barbershop, garage, consultancy, gym…
 * then salon, car wash, practice… — for the categories that are
 * switched on (`categories`, from the admin console), or for all of them until
 * those have loaded. A category added later with no words of its own still
 * appears, by its name.
 */
export function growWords(categories?: Pick<Category, 'icon' | 'name'>[]): string[] {
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
