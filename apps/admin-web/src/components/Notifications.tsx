import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/admin';

const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * The inbox, as a bell in the shell (§96).
 *
 * Polled rather than pushed: there is no websocket in this platform, and a
 * count that is a minute stale is worth more than a connection to maintain.
 *
 * Opening a notification marks it read — the alternative is a separate control
 * per row for an action nobody deliberately performs.
 */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 30 }),
    refetchInterval: 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });

  const unread = inbox.data?.unread ?? 0;
  const rows = inbox.data?.notifications ?? [];

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="bell"
        onClick={() => setOpen((was) => !was)}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 2a3.5 3.5 0 0 0-3.5 3.5v2.2L3.3 10h9.4l-1.2-2.3V5.5A3.5 3.5 0 0 0 8 2zM6.5 11.5a1.5 1.5 0 0 0 3 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <>
          <div className="bell-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <header>
              <strong>Notifications</strong>
              {unread > 0 && (
                <button
                  type="button"
                  className="link"
                  disabled={readAll.isPending}
                  onClick={() => readAll.mutate()}
                >
                  Mark all read
                </button>
              )}
            </header>

            {rows.length === 0 && <p className="muted small empty">Nothing yet.</p>}

            <ul>
              {rows.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.readAt ? 'read' : 'unread'}
                  onClick={() => {
                    if (!notification.readAt) readOne.mutate(notification.id);
                  }}
                >
                  <div className="small">
                    <strong>{notification.subject ?? notification.type}</strong>
                  </div>
                  {notification.body && (
                    <div className="muted small">{notification.body}</div>
                  )}
                  <div className="muted small">{when(notification.createdAt)}</div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
