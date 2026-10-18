import { useSyncExternalStore } from 'react';
import { deviceStore } from '../api/client';
import type { FeedStory, StoryShop } from '../api/stories';

/**
 * Which stories this phone has seen (§285): a shop's ring turns from coral to
 * grey once it has been watched, and opening it again starts at the first one
 * not yet seen — the way every app with stories works.
 *
 * Kept as "seen up to", one time per shop — a shop's stories play in the order
 * they were posted — so it stays tiny: the phone's store takes about 2 KB a
 * value. A shop not looked at for two days is forgotten; its stories ended
 * long ago.
 */
const KEY = 'booking.storiesSeen';
const FORGET_AFTER = 2 * 24 * 60 * 60 * 1000;

/** The first eight characters of the shop's id → the newest seen story's time. */
type Seen = Readonly<Record<string, number>>;

let seen: Seen = {};
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const keyOf = (businessId: string) => businessId.slice(0, 8);
const timeOf = (story: FeedStory) => Date.parse(story.createdAt);

function read(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [key, time] = pair.split(':');
    const ms = parseInt(time ?? '', 36);
    if (key && ms) out[key] = ms;
  }
  return out;
}

function save() {
  const cutoff = Date.now() - FORGET_AFTER;
  const value = Object.entries(seen)
    .filter(([, ms]) => ms > cutoff)
    .map(([key, ms]) => `${key}:${ms.toString(36)}`)
    .join(',');
  deviceStore.setItemAsync(KEY, value).catch(() => undefined);
}

function start() {
  if (started) return;
  started = true;
  deviceStore
    .getItemAsync(KEY)
    .then((raw) => {
      if (!raw) return;
      const stored = read(raw);
      // Anything seen while this was loading stays seen.
      for (const [key, ms] of Object.entries(seen)) stored[key] = Math.max(stored[key] ?? 0, ms);
      seen = stored;
      emit();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useSeenStories = () => useSyncExternalStore(subscribe, () => seen);

export function markSeen(businessId: string, story: FeedStory) {
  const key = keyOf(businessId);
  const ms = timeOf(story);
  if ((seen[key] ?? 0) >= ms) return;
  seen = { ...seen, [key]: ms };
  emit();
  save();
}

const upTo = (state: Seen, shop: StoryShop) => state[keyOf(shop.business.id)] ?? 0;

export const allSeen = (state: Seen, shop: StoryShop) =>
  shop.stories.every((story) => timeOf(story) <= upTo(state, shop));

/** Where to start a shop's stories: the first not yet seen, or the beginning. */
export function firstUnseen(state: Seen, shop: StoryShop | undefined) {
  if (!shop) return 0;
  const i = shop.stories.findIndex((story) => timeOf(story) > upTo(state, shop));
  return i < 0 ? 0 : i;
}

/** The shops with something new first, as the server ordered them; the rest after. */
export const unseenFirst = (state: Seen, shops: StoryShop[]) => [
  ...shops.filter((shop) => !allSeen(state, shop)),
  ...shops.filter((shop) => allSeen(state, shop)),
];
