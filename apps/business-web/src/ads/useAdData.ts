import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMe,
  getPayoutDestination,
  getProfile,
  listLocationReviews,
  listLocations,
  listServices,
  type Service,
} from '../api/business';
import { discoverServices, type DiscoveredService } from '../api/discovery';
import { bookingsBetween, REAL_STATUSES } from '../lib/bookings';
import { addDays, startOfDay } from '../lib/time';
import type { IconName } from '../ui/Icon';

/**
 * Everything the "For you" adverts are made from (§204), from what the app
 * already knows — nothing here is invented, and nothing is paid for.
 *
 * - **Your shop**: what is missing from it (photos, words, hours, a payout
 *   number), your best seller over the last 30 days, reviews waiting for a
 *   reply.
 * - **The platform**: what customers are booking most right now, from the same
 *   public list the customer app's home shows — in your own kind of business
 *   first, then everywhere — never your own services.
 *
 * Every query shares its key with the page that asks the same thing, so the
 * adverts cost almost nothing once the seller has looked around.
 */

export type HealthCheck = {
  key: string;
  label: string;
  done: boolean;
  to: string;
  icon: IconName;
  /** Why it matters, in one line. */
  why: string;
};

export type BestSeller = { service: Service | null; name: string; count: number; onSale: boolean };

const isSaleOn = (s: Service) =>
  Boolean(s.discountPercent) && (!s.discountEndsOn || s.discountEndsOn.slice(0, 10) >= new Date().toISOString().slice(0, 10));

export function useAdData() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const businessId = me.data?.businessMembership?.businessProfile.id ?? null;
  const role = me.data?.businessMembership?.role ?? null;

  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  const destination = useQuery({ queryKey: ['payout-destination'], queryFn: getPayoutDestination, retry: false });

  const today = startOfDay();
  const recent = useQuery({
    queryKey: ['appointments', 'ads-30d', today.toISOString()],
    queryFn: () => bookingsBetween(addDays(today, -29), addDays(today, 1)),
    staleTime: 5 * 60_000,
  });

  const branchIds = (locations.data ?? []).filter((l) => l.isActive).map((l) => l.id);
  const reviews = useQuery({
    queryKey: ['ads-reviews', branchIds.join(',')],
    queryFn: async () => {
      const pages = await Promise.all(branchIds.map((id) => listLocationReviews(id, 50)));
      return pages.flatMap((p) => p.reviews);
    },
    enabled: branchIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const subcategoryId = profile.data?.subcategory?.id ?? null;
  const trendingSame = useQuery({
    queryKey: ['ads-trending', 'sub', subcategoryId],
    queryFn: () => discoverServices({ sort: 'popular', subcategoryId: subcategoryId!, limit: 12 }),
    enabled: Boolean(subcategoryId),
    staleTime: 10 * 60_000,
  });
  const trendingAll = useQuery({
    queryKey: ['ads-trending', 'all'],
    queryFn: () => discoverServices({ sort: 'popular', limit: 16 }),
    staleTime: 10 * 60_000,
  });

  return useMemo(() => {
    const p = profile.data;
    const branches = (locations.data ?? []).filter((l) => l.isActive);
    const catalogue = services.data ?? [];
    const onSale = catalogue.filter((s) => s.isActive && s.locations.some((o) => o.isOffered));

    // ---- what is missing from the shop ----
    const checks: HealthCheck[] = [];
    if (p) {
      checks.push(
        { key: 'cover', label: 'A cover photo', done: Boolean(p.coverImageUrl), to: '/profile', icon: 'image', why: 'The first thing a customer sees on your page.' },
        { key: 'logo', label: 'Your logo', done: Boolean(p.logoUrl), to: '/profile', icon: 'store', why: 'It sits on every card customers see of you.' },
        {
          key: 'about',
          label: 'What you do, in a few lines',
          done: (p.description ?? '').trim().length >= 40,
          to: '/profile',
          icon: 'pencil',
          why: 'Read by customers before they book.',
        },
        { key: 'type', label: 'Your category and type', done: Boolean(p.category && p.subcategory), to: '/profile', icon: 'tag', why: 'How customers find you when they browse.' },
        { key: 'phone', label: 'A phone number', done: Boolean(p.phone), to: '/profile', icon: 'phone', why: 'So customers can reach you.' },
      );
    }
    for (const b of branches) {
      checks.push({
        key: `gallery-${b.id}`,
        label: `Photos of ${b.name}`,
        done: (b._count?.media ?? 0) > 0,
        to: '/profile',
        icon: 'camera',
        why: 'Customers want to see the place they are walking into.',
      });
      checks.push({
        key: `hours-${b.id}`,
        label: `Opening hours at ${b.name}`,
        done: b.hours.some((h) => !h.isClosed),
        to: '/hours',
        icon: 'clock',
        why: 'Without hours, nothing there can be booked.',
      });
      checks.push({
        key: `where-${b.id}`,
        label: `Where ${b.name} is`,
        done: Boolean(b.district) && b.latitude !== null && b.longitude !== null,
        to: '/hours',
        icon: 'pin',
        why: 'How customers nearby find you.',
      });
    }
    if (catalogue.length === 0) {
      checks.push({ key: 'service', label: 'Your first service', done: false, to: '/services', icon: 'tag', why: 'Customers book services — this is where it starts.' });
    } else {
      const noPhoto = onSale.filter((s) => s.images.length === 0);
      checks.push({
        key: 'service-photos',
        label: noPhoto.length ? `Photos on ${noPhoto.length} ${noPhoto.length === 1 ? 'service' : 'services'}` : 'Photos on every service',
        done: noPhoto.length === 0,
        to: '/services',
        icon: 'image',
        why: 'A service with a photo is easier to choose.',
      });
      const noWords = onSale.filter((s) => !s.description);
      checks.push({
        key: 'service-words',
        label: noWords.length ? `A description on ${noWords.length} ${noWords.length === 1 ? 'service' : 'services'}` : 'A description on every service',
        done: noWords.length === 0,
        to: '/services',
        icon: 'pencil',
        why: 'Shown under “About this service” before they book.',
      });
    }
    if (destination.data) {
      checks.push({
        key: 'payout',
        label: 'A confirmed payout number',
        done: destination.data.destination?.status === 'VERIFIED',
        to: '/getting-paid',
        icon: 'wallet',
        why: 'Your share of deposits is paid to it.',
      });
    }
    const done = checks.filter((c) => c.done).length;
    const missing = checks.filter((c) => !c.done);
    const score = checks.length ? Math.round((done / checks.length) * 100) : 0;

    // ---- your best seller, last 30 days ----
    const counts = new Map<string, { name: string; count: number }>();
    for (const a of recent.data ?? []) {
      if (!REAL_STATUSES.includes(a.status)) continue;
      const row = counts.get(a.service.id) ?? { name: a.service.name, count: 0 };
      row.count += a.quantity > 1 ? a.quantity : 1;
      counts.set(a.service.id, row);
    }
    const top = [...counts.entries()].sort((x, y) => y[1].count - x[1].count)[0];
    const bestService = top ? catalogue.find((s) => s.id === top[0]) ?? null : null;
    const best: BestSeller | null =
      top && top[1].count > 0
        ? { service: bestService, name: top[1].name, count: top[1].count, onSale: bestService ? isSaleOn(bestService) : false }
        : null;

    // ---- trending elsewhere ----
    // Someone else's, and actually booked: "trending" with nobody booking it
    // would be a claim the list cannot back.
    const notMine = (s: DiscoveredService) => s.business.id !== businessId && s.bookingCount > 0;
    const seen = new Set<string>();
    const dedupe = (s: DiscoveredService) => {
      const k = `${s.id}:${s.location.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    };
    const same = (trendingSame.data?.services ?? []).filter(notMine).filter(dedupe).slice(0, 4);
    const everywhere = (trendingAll.data?.services ?? []).filter(notMine).filter(dedupe).slice(0, 4);

    const unanswered = (reviews.data ?? []).filter((r) => !r.responseText).length;
    const saleRunning = onSale.some(isSaleOn);

    return {
      ready: Boolean(p && locations.data && services.data),
      role,
      businessName: p?.name ?? null,
      subcategoryName: p?.subcategory?.name ?? null,
      checks,
      missing,
      score,
      best,
      trendingSame: same,
      trendingEverywhere: everywhere,
      unanswered,
      saleRunning,
      hasServices: onSale.length > 0,
      payoutStatus: destination.data ? destination.data.destination?.status ?? 'NONE' : null,
    };
  }, [
    profile.data,
    locations.data,
    services.data,
    destination.data,
    recent.data,
    reviews.data,
    trendingSame.data,
    trendingAll.data,
    businessId,
    role,
  ]);
}

export type AdData = ReturnType<typeof useAdData>;
