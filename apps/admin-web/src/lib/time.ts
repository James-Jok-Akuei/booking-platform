import { useEffect, useState } from 'react';

/** Times and days, said the same way on every screen (§190). */

export const DAY_MS = 86_400_000;

export const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "16:00". */
export const clock = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Mon 12 Oct". */
export const shortDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "Today", "Tomorrow", "Yesterday", or "Mon 12 Oct". */
export const relativeDay = (iso: string | Date, now = new Date()) => {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, addDays(now, 1))) return 'Tomorrow';
  if (sameDay(d, addDays(now, -1))) return 'Yesterday';
  return shortDay(d);
};

/** "25 min", "1 h 20 min". */
export const span = (minutes: number) => {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
};

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export const ago = (iso: string, now = Date.now()) => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (60 * 24));
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Minutes from `start` to `end`. */
export const minutesBetween = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);

/** "Good morning" / "Good afternoon" / "Good evening". */
export const greeting = (now = new Date()) => {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

/** The current time, ticking every `everyMs` — for clocks and countdowns. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
