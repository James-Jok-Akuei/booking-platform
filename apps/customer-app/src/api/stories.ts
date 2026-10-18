import { api } from './client';
import type { ActionMessage } from './auth';
import type { components } from './schema';

/** A shop's stories (§285): a photo and a few words, up for 24 hours. */
export type StoryShop = components['schemas']['StoryShopDto'];
export type FeedStory = components['schemas']['FeedStoryDto'];
type StoryFeed = components['schemas']['StoryFeedDto'];

/** Every live story, a shop at a time, the shop that posted last first. Open to anyone. */
export const listStories = () => api<StoryFeed>('/stories', { anonymous: true });

/** Once a story has been looked at, so the shop sees how many saw it. */
export const viewStory = (id: string) => api<ActionMessage>(`/stories/${id}/view`, { method: 'POST', anonymous: true });

/** Something wrong with one: an administrator looks, and takes it down if it breaks the rules. */
export const reportStory = (id: string, reason: string) =>
  api<ActionMessage>(`/stories/${id}/report`, { method: 'POST', body: { reason } });
