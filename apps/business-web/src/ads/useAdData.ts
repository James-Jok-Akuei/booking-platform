import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMe,
  getPayoutDestination,
  getProfile,
  getToday,
  listLocationReviews,
  listNotifications,
  listLocations,
  listServices,
  type Service,
} from '../api/business';
import { listThreads } from '../api/chat';
import { discoverServices, type DiscoveredService } from '../api/discovery';
import { bookingsBetween, REAL_STATUSES } from '../lib/bookings';
import { addDays, startOfDay } from '../lib/time';
import type { IconName } from '../ui/Icon';
import { useAccess } from '../access';
import { plural, t } from '@lingui/core/macro';

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
 * - **Just in** (§206): the one newest notification or unread message of the
 *   last day — a headline; the bell and the inbox keep the rest.
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

type Thread = NonNullable<Awaited<ReturnType<typeof listThreads>>['threads']>[number];
type Notice = NonNullable<Awaited<ReturnType<typeof listNotifications>>['notifications']>[number];
export type JustIn = { kind: 'message'; thread: Thread } | { kind: 'notification'; notification: Notice };

const isSaleOn = (s: Service) =>
  Boolean(s.discountPercent) && (!s.discountEndsOn || s.discountEndsOn.slice(0, 10) >= new Date().toISOString().slice(0, 10));

export function useAdData() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const businessId = me.data?.businessMembership?.businessProfile.id ?? null;
  const role = me.data?.businessMembership?.role ?? null;
  const access = useAccess();

  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  // Asked only by those who may see the money (§277) — anyone else is refused.
  const destination = useQuery({
    queryKey: ['payout-destination'],
    queryFn: getPayoutDestination,
    retry: false,
    enabled: access.ready && access.money,
  });

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
      // One review is enough: the counts come with every page (§215).
      const pages = await Promise.all(branchIds.map((id) => listLocationReviews(id, 1)));
      return pages.reduce((sum, p) => sum + p.breakdown.waiting, 0);
    },
    enabled: branchIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // The one thing that just came in (§206). Same keys as the bell and the
  // frame's badges, so they never disagree and nothing is fetched twice.
  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 30 }),
    refetchInterval: 60_000,
  });
  const threads = useQuery({
    queryKey: ['threads', 'badge'],
    queryFn: () => listThreads({ limit: 100 }),
    refetchInterval: 60_000,
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
  // Rwanda today (§310): MoMo's health is worth knowing within minutes; the rest changes slowly.
  const rwandaToday = useQuery({ queryKey: ['today'], queryFn: getToday, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });

  return useMemo(() => {
    const p = profile.data;
    const branches = (locations.data ?? []).filter((l) => l.isActive);
    const catalogue = services.data ?? [];
    const onSale = catalogue.filter((s) => s.isActive && s.locations.some((o) => o.isOffered));

    // ---- what is missing from the shop ----
    const checks: HealthCheck[] = [];
    if (p) {
      checks.push(
        { key: 'cover', label: t`A cover photo`, done: Boolean(p.coverImageUrl), to: '/profile', icon: 'image', why: t`The first thing a customer sees on your page.` },
        { key: 'logo', label: t`Your logo`, done: Boolean(p.logoUrl), to: '/profile', icon: 'store', why: t`It sits on every card customers see of you.` },
        {
          key: 'about',
          label: t`What you do, in a few lines`,
          done: (p.description ?? '').trim().length >= 40,
          to: '/profile',
          icon: 'pencil',
          why: t`Read by customers before they book.`,
        },
        { key: 'type', label: t`Your category and type`, done: Boolean(p.category && p.subcategory), to: '/profile', icon: 'tag', why: t`How customers find you when they browse.` },
        { key: 'phone', label: t`A phone number`, done: Boolean(p.phone), to: '/profile', icon: 'phone', why: t`So customers can reach you.` },
      );
    }
    for (const b of branches) {
      checks.push({
        key: `gallery-${b.id}`,
        label: t`Photos of ${b.name}`,
        done: (b._count?.media ?? 0) > 0,
        to: '/profile',
        icon: 'camera',
        why: t`Customers want to see the place they are walking into.`,
      });
      checks.push({
        key: `hours-${b.id}`,
        label: t`Opening hours at ${b.name}`,
        done: b.hours.some((h) => !h.isClosed),
        to: '/hours',
        icon: 'clock',
        why: t`Without hours, nothing there can be booked.`,
      });
      checks.push({
        key: `where-${b.id}`,
        label: t`Where ${b.name} is`,
        done: Boolean(b.district) && b.latitude !== null && b.longitude !== null,
        to: '/hours',
        icon: 'pin',
        why: t`How customers nearby find you.`,
      });
    }
    if (catalogue.length === 0) {
      checks.push({ key: 'service', label: t`Your first service`, done: false, to: '/services', icon: 'tag', why: t`Customers book services — this is where it starts.` });
    } else {
      const noPhoto = onSale.filter((s) => s.images.length === 0);
      checks.push({
        key: 'service-photos',
        label: noPhoto.length ? plural(noPhoto.length, { one: 'Photos on # service', other: 'Photos on # services' }) : t`Photos on every service`,
        done: noPhoto.length === 0,
        to: '/services',
        icon: 'image',
        why: t`A service with a photo is easier to choose.`,
      });
      const noWords = onSale.filter((s) => !s.description);
      checks.push({
        key: 'service-words',
        label: noWords.length
          ? plural(noWords.length, { one: 'A description on # service', other: 'A description on # services' })
          : t`A description on every service`,
        done: noWords.length === 0,
        to: '/services',
        icon: 'pencil',
        why: t`Shown under “About this service” before they book.`,
      });
    }
    if (destination.data) {
      checks.push({
        key: 'payout',
        label: t`A confirmed payout number`,
        done: destination.data.destination?.status === 'VERIFIED',
        to: '/getting-paid',
        icon: 'wallet',
        why: t`Your share of deposits is paid to it.`,
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

    const unanswered = reviews.data ?? 0;

    // ---- just in ----
    // ONE thing, the newest of the last day: a notification of any kind, or a
    // customer's message still unread. Everything else stays in the bell and
    // the inbox (§206) — this is a headline, not a second inbox.
    const dayAgo = Date.now() - 86_400_000;
    const fresh = (iso: string | null | undefined) => Boolean(iso) && new Date(iso!).getTime() > dayAgo;
    const note = (inbox.data?.notifications ?? []).find((n) => fresh(n.createdAt)) ?? null;
    const message =
      (threads.data?.threads ?? [])
        .filter((t) => t.unreadCount > 0 && t.lastMessage !== null && fresh(t.lastMessageAt))
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))[0] ?? null;
    // A message notification is told better by the message itself.
    const justIn: JustIn | null =
      message && (!note || note.type === 'NEW_MESSAGE' || (message.lastMessageAt ?? '') >= note.createdAt)
        ? { kind: 'message', thread: message }
        : note
          ? { kind: 'notification', notification: note }
          : null;
    // The platform's fee as the seller is actually charged it: from their own
    // latest booking, never a number written into the app.
    const latest = [...(recent.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const feePercent = latest?.platformFeePercentage ? String(Number(latest.platformFeePercentage)) : null;
    const saleRunning = onSale.some(isSaleOn);

    return {
      ready: Boolean(p && locations.data && services.data),
      role,
      access,
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
      branchCount: branches.length,
      justIn,
      feePercent,
      today: rwandaToday.data ?? null,
    };
  }, [
    rwandaToday.data,
    profile.data,
    locations.data,
    services.data,
    destination.data,
    recent.data,
    reviews.data,
    trendingSame.data,
    trendingAll.data,
    inbox.data,
    threads.data,
    businessId,
    role,
    access,
  ]);
}

export type AdData = ReturnType<typeof useAdData>;
