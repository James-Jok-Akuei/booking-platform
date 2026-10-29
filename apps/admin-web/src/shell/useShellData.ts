import { useQuery } from '@tanstack/react-query';
import { listAdminStories, listBusinesses, listPayoutDestinations, listPayouts, listTickets } from '../api/admin';
import { useAuth } from '../auth/auth-context';
import { useMyAccess } from '../lib/access';

/**
 * What the frame needs to know (§242): who is signed in, and the work waiting
 * in each queue — a count on the queue's link, so the menu itself says where
 * to go next.
 *
 * Each count is one list request for a single row, read for its `total`; the
 * pages ask the same lists under their own keys, and every count refreshes
 * once a minute and when the tab comes back into focus.
 */
export function useShellData() {
  const { user } = useAuth();

  // The payout queues are money work (§317): counted only for those who do it.
  const { money, known: accessKnown } = useMyAccess();

  const count = <T,>(key: string, fn: () => Promise<{ total: number } & T>, enabled = true) =>
    useQuery({
      queryKey: ['shell-count', key],
      queryFn: fn,
      refetchInterval: 60_000,
      select: (page) => page.total,
      enabled,
    });

  // Shops that have asked for a decision (§42, §255) — not those still setting up.
  const businesses = count('businesses', () => listBusinesses({ status: 'PENDING', submitted: 'true', limit: 1 }));
  // Payout numbers waiting to be checked: a business left here is not paid (§48.3).
  const destinations = count('destinations', () => listPayoutDestinations({ status: 'UNVERIFIED', limit: 1 }), money);
  // Payouts created and not yet sent (§36).
  const payouts = count('payouts', () => listPayouts({ status: 'PENDING', limit: 1 }), money);
  // New tickets nobody has picked up yet (§24).
  const tickets = count('tickets', () => listTickets({ status: 'OPEN', limit: 1 }));
  // Stories customers reported, still up (§285).
  const stories = count('stories', async () => ({ total: (await listAdminStories('reported')).reported }));

  return {
    email: user?.email ?? '',
    // Until every queue has answered, the frame says nothing about them rather
    // than "All clear" — which, a second later, may not be true.
    known: accessKnown && [businesses, tickets, stories, ...(money ? [destinations, payouts] : [])].every((q) => q.data !== undefined),
    money,
    waiting: {
      businesses: businesses.data ?? 0,
      destinations: money ? destinations.data ?? 0 : 0,
      payouts: money ? payouts.data ?? 0 : 0,
      tickets: tickets.data ?? 0,
      stories: stories.data ?? 0,
    },
  };
}

export type ShellData = ReturnType<typeof useShellData>;
