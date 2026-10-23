import { api } from './client';
import type { components } from './schema';

/** What changes booking today, or on a chosen day (§310): mobile money's health, Umuganda, a holiday, Kwibuka. */
export type RwandaToday = components['schemas']['PublicTodayDto'];

export const getToday = (date?: string) =>
  api<RwandaToday>(date ? `/today?date=${encodeURIComponent(date)}` : '/today', { anonymous: true });
