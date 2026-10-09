import { useQuery } from '@tanstack/react-query';
import { listBusinesses, listPayoutDestinations, listPayouts, listTickets } from '../api/admin';
import { useAuth } from '../auth/auth-context';

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

  const count = <T,>(key: string, fn: () => Promise<{ total: number } & T>) =>
    useQuery({
      queryKey: ['shell-count', key],
      queryFn: fn,
      refetchInterval: 60_000,
      select: (page) => page.total,
    });

  // Applications waiting for a decision (§42).
  const businesses = count('businesses', () => listBusinesses({ status: 'PENDING', limit: 1 }));
  // Payout numbers waiting to be checked: a business left here is not paid (§48.3).
  const destinations = count('destinations', () => listPayoutDestinations({ status: 'UNVERIFIED', limit: 1 }));
  // Payouts created and not yet sent (§36).
  const payouts = count('payouts', () => listPayouts({ status: 'PENDING', limit: 1 }));
  // New tickets nobody has picked up yet (§24).
  const tickets = count('tickets', () => listTickets({ status: 'OPEN', limit: 1 }));

  return {
    email: user?.email ?? '',
    // Until every queue has answered, the frame says nothing about them rather
    // than "All clear" — which, a second later, may not be true.
    known: [businesses, destinations, payouts, tickets].every((q) => q.data !== undefined),
    waiting: {
      businesses: businesses.data ?? 0,
      destinations: destinations.data ?? 0,
      payouts: payouts.data ?? 0,
      tickets: tickets.data ?? 0,
    },
  };
}

export type ShellData = ReturnType<typeof useShellData>;
