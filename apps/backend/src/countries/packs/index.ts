import { RWANDA } from './rwanda';
import type { CountryPack } from './types';

export type { CountryPack, CountryCalendar, Ymd } from './types';

/**
 * Every country the code knows (§315). Adding one is a new file beside
 * `rwanda.ts` and a line here; its row comes from the reference data.
 *
 * Exported, and not frozen, for one reason: the countries test adds an
 * imaginary second country here for the length of the test, which is how
 * the separation between two countries is proven without inventing one in
 * the code that ships.
 */
export const PACKS: Record<string, CountryPack> = {
  RW: RWANDA,
};

/** The pack for a country, or null when the code does not know it yet. */
export const packFor = (code: string): CountryPack | null => PACKS[code.toUpperCase()] ?? null;

/** The codes of every country with a pack. */
export const knownCountries = (): string[] => Object.keys(PACKS);

/** Every pack, for rules that must hold whichever country a row is in. */
export const allPacks = (): CountryPack[] => Object.values(PACKS);
