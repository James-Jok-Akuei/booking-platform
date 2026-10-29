import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getStatisticsMonths,
  getStatisticsPeriod,
  getStatisticsSummary,
  listAdminCategories,
  listAdminPlaces,
  type StatisticsScope,
} from '../../api/admin';
import { useCountries } from '../../lib/countries';

/** The stretches offered, and how many days back each one starts. */
export const PERIODS = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '3 months', days: 90 },
  { key: '12m', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
  { key: 'custom', label: 'Choose dates', days: null },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];

/** "2026-10-09" moved by some days — calendar arithmetic, no clock. */
export const shiftDay = (ymd: string, by: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

/** Today on a clock, as YYYY-MM-DD. */
export const todayOn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** A day the server names (YYYY-MM-DD), read as that day wherever the reader is. */
export const asDay = (ymd: string) => new Date(`${ymd}T12:00:00`);

export const dayWords = (ymd: string, withYear = false) =>
  asDay(ymd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

export const monthWords = (ym: string, long = false) =>
  asDay(`${ym}-01`).toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: 'numeric' });

/**
 * What the page is showing, kept in the address (§242) so a view can be
 * shared or come back to: the stretch, the part of the platform, and whether
 * test accounts are counted.
 */
export function useStatsView() {
  const [params, setParams] = useSearchParams();
  const countries = useCountries();
  const zone = countries.find((c) => c.isDefault)?.timeZone ?? 'Africa/Kigali';
  const today = todayOn(zone);

  const period = (PERIODS.find((p) => p.key === params.get('period'))?.key ?? '30d') as PeriodKey;
  const customFrom = params.get('from') ?? shiftDay(today, -29);
  const customTo = params.get('to') ?? today;
  const scope: StatisticsScope = {
    country: params.get('country') ?? undefined,
    category: params.get('category') ?? undefined,
    district: params.get('district') ?? undefined,
    includeTest: params.get('test') === '1' || undefined,
  };

  const preset = PERIODS.find((p) => p.key === period)!;
  const range =
    period === 'all'
      ? { from: undefined, to: today }
      : period === 'custom'
        ? { from: customFrom <= customTo ? customFrom : customTo, to: customTo >= customFrom ? customTo : customFrom }
        : { from: shiftDay(today, -((preset.days ?? 30) - 1)), to: today };

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (was) => {
        const next = new URLSearchParams(was);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  return { period, range, scope, today, zone, set, countries, customFrom, customTo };
}

export type StatsView = ReturnType<typeof useStatsView>;

/** The three answers the page is drawn from. Each keeps showing the last one while the next loads. */
export function useStatistics(view: StatsView) {
  const keep = { placeholderData: keepPreviousData, staleTime: 30_000 };
  const summary = useQuery({
    queryKey: ['statistics', 'summary', view.scope],
    queryFn: () => getStatisticsSummary(view.scope),
    ...keep,
  });
  const period = useQuery({
    queryKey: ['statistics', 'period', view.scope, view.range],
    queryFn: () => getStatisticsPeriod({ ...view.scope, ...view.range }),
    ...keep,
  });
  const months = useQuery({
    queryKey: ['statistics', 'months', view.scope],
    queryFn: () => getStatisticsMonths({ ...view.scope, months: 12 }),
    ...keep,
  });
  return { summary, period, months };
}

/** The categories and districts to narrow by, read once. */
export function useScopeChoices() {
  const categories = useQuery({ queryKey: ['admin-categories'], queryFn: listAdminCategories, staleTime: 5 * 60_000 });
  const places = useQuery({ queryKey: ['admin-places'], queryFn: listAdminPlaces, staleTime: 5 * 60_000 });
  return { categories: categories.data ?? [], provinces: places.data ?? [] };
}

/**
 * A number that counts up to its value when it first arrives, and glides to
 * a new one when it changes (§316) — still at once for anyone who asked
 * their device for less motion.
 */
export function useCountUp(target: number | null | undefined, duration = 900) {
  const [shown, setShown] = useState<number | null>(target ?? null);
  const from = useRef(0);
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  useEffect(() => {
    if (target === null || target === undefined) return;
    if (reduce) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(begin + (target - begin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduce]);
  return shown;
}

/** This stretch against the one before: "+40%", "−12%", "New" when the one before had none. */
export function change(now: number | null | undefined, before: number | null | undefined) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  if (before === 0 && now === 0) return { tone: 'flat' as const, words: 'Same as before' };
  if (before === 0) return { tone: 'up' as const, words: 'New' };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { tone: 'flat' as const, words: 'Same as before' };
  return { tone: pct > 0 ? ('up' as const) : ('down' as const), words: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` };
}

/** "45%" of a part, or a dash with nothing to divide by. */
export const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
