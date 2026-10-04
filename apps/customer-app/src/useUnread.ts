import { useQuery } from '@tanstack/react-query';
import { listThreads } from './api/chat';
import { useSignedIn } from './api/client';
import { listNotifications } from './api/notifications';

/**
 * How many things are waiting to be read (§134).
 *
 * Two numbers, kept apart: unread MESSAGES drive the badge on the Messages tab,
 * unread NOTIFICATIONS drive the bell. They are different inboxes — one is a
 * conversation, the other is the platform telling you something happened — and
 * one combined number would send people to the wrong screen half the time.
 *
 * Both reuse the query keys their own screens read, so opening either screen
 * costs no second request and the badge can never disagree with the list.
 * Refreshed once a minute while the app is open: often enough that a reply is
 * noticed, rare enough to be free.
 */
export function useUnread() {
  const signedIn = useSignedIn();

  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => listThreads({ limit: 50 }),
    enabled: signedIn,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 50 }),
    enabled: signedIn,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return {
    messages: signedIn
      ? (threads.data?.threads.reduce((sum, thread) => sum + thread.unreadCount, 0) ?? 0)
      : 0,
    // The server's own count, over the WHOLE inbox rather than the page fetched.
    notifications: signedIn ? (notifications.data?.unread ?? 0) : 0,
  };
}
