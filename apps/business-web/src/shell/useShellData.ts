import { useQuery } from '@tanstack/react-query';
import { getMe, getProfile, getReadiness, listAppointments } from '../api/business';
import { listThreads } from '../api/chat';

/** Today, from local midnight to the next one, as the instants the API takes. */
export const todayRange = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
};

/**
 * What the frame around every page needs to know (§190): who is signed in, the
 * shop's name, logo and state, and the two numbers worth a badge — customers
 * still expected today, and messages nobody has read.
 *
 * The queries share their keys with the pages that ask the same thing
 * ('me', 'profile'), so the frame costs nothing extra once a page has loaded.
 * The today count sits under 'appointments', so checking someone in on any
 * screen refreshes the badge with it.
 */
export function useShellData() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  // Whether a shop that is not live has been sent for review, and what it
  // still needs (§256) — so the frame can say so in words.
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: getReadiness, retry: false });

  const expectedToday = useQuery({
    queryKey: ['appointments', 'badge', 'expected-today'],
    queryFn: () => listAppointments({ status: 'BOOKED', ...todayRange(), limit: 1 }),
    refetchInterval: 60_000,
  });

  const threads = useQuery({
    queryKey: ['threads', 'badge'],
    queryFn: () => listThreads({ limit: 100 }),
    refetchInterval: 60_000,
  });

  const membership = me.data?.businessMembership ?? null;
  const business = membership?.businessProfile ?? null;

  return {
    email: me.data?.email ?? '',
    role: membership?.role ?? null,
    business,
    logoUrl: profile.data?.logoUrl ?? null,
    paused: Boolean(profile.data?.pausedAt),
    readiness: readiness.data ?? null,
    expectedToday: expectedToday.data?.total ?? 0,
    unreadMessages: (threads.data?.threads ?? []).reduce((sum, t) => sum + (t.unreadCount ?? 0), 0),
  };
}

export type ShellData = ReturnType<typeof useShellData>;

/** "OWNER" → "Owner". */
export const roleLabel = (role: string | null) =>
  role ? role.charAt(0) + role.slice(1).toLowerCase() : '';
