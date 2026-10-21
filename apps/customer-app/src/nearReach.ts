import type { DiscoveryPage } from './api/discovery';
import { plural, t } from '@lingui/core/macro';

/** The distances a customer can pick on Home, in kilometres (§171). */
export const WITHIN_STEPS = [2, 5, 10, 25] as const;

/**
 * Where Home starts once it knows where the customer is: any distance (§173).
 * ~~10 km~~ at first (§171); every shop is shown, nearest measured, until the
 * customer narrows it themselves.
 */
export const DEFAULT_WITHIN: number | null = null;

/**
 * Fewer places than this inside the default, and the circle grows. Early on
 * there are not many shops, and a strict 10 km would leave a customer outside
 * Kigali looking at an empty screen — which reads as a broken app.
 */
export const ENOUGH_PLACES = 5;

/** What the customer asked for: a distance, or `null` for any distance. */
export type Within = { km: number | null; chosen: boolean };

export type Reach = {
  /** The distance actually searched; `null` is every distance. */
  km: number | null;
  /** Set when it had to grow: what was asked, and how many places were in it. */
  widenedFrom?: { km: number; found: number };
};

/**
 * How far Home searches (§171), from the nearest places for the current
 * filters — `nearest` is a page of branches in distance order.
 *
 * - **A default distance** (one nobody chose — 10 km until §173) grows to the
 *   next step until it holds {@link ENOUGH_PLACES} businesses, and to every
 *   distance if none does.
 * - **A distance the customer picked** is kept exactly. It grows only when
 *   there is NOTHING in it — they asked for close, and one shop close by is an
 *   answer; an empty screen is not.
 *
 * Businesses are counted, not branches, the way the Places row shows them.
 * A branch with no pin on the map cannot be inside any distance.
 */
export function reach(within: Within, nearest: DiscoveryPage | undefined): Reach {
  if (within.km === null || !nearest) return { km: within.km };
  const asked = within.km;

  const seen = new Set<string>();
  const distances: number[] = [];
  for (const branch of nearest.locations) {
    if (seen.has(branch.business.id)) continue;
    seen.add(branch.business.id);
    if (branch.distanceKm !== null && branch.distanceKm !== undefined) {
      distances.push(branch.distanceKm);
    }
  }
  const inside = (km: number) => distances.filter((d) => d <= km).length;

  const need = within.chosen ? 1 : ENOUGH_PLACES;
  const found = inside(asked);
  if (found >= need) return { km: asked };

  // Growing is only worth saying when it would show something more.
  const more = nearest.total > nearest.locations.length || seen.size > found;
  if (!more) return { km: asked };

  const next = WITHIN_STEPS.find((step) => step > asked && inside(step) >= need) ?? null;
  return { km: next, widenedFrom: { km: asked, found } };
}

/** The sentence under the distance picker when it had to grow. */
export function widenedNote(area: Reach): string | null {
  if (!area.widenedFrom) return null;
  const { km, found } = area.widenedFrom;
  const shown = area.km;
  if (found === 0) {
    return shown === null
      ? t`Nothing within ${km} km, so this shows every distance.`
      : t`Nothing within ${km} km, so this shows up to ${shown} km.`;
  }
  return shown === null
    ? plural(found, {
        one: `Only # place within ${km} km, so this shows every distance.`,
        other: `Only # places within ${km} km, so this shows every distance.`,
      })
    : plural(found, {
        one: `Only # place within ${km} km, so this shows up to ${shown} km.`,
        other: `Only # places within ${km} km, so this shows up to ${shown} km.`,
      });
}
