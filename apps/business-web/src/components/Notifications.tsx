import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/business';
import { Icon, type IconName } from '../ui/Icon';

const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * Each kind of notification with its own mark and colour (§190), so a glance
 * down the list tells a new booking from a cancellation from a review.
 */
const LOOK: Partial<Record<string, { icon: IconName; tone: string }>> = {
  APPOINTMENT_BOOKED: { icon: 'calendar', tone: 'ask' },
  DEPOSIT_CONFIRMED: { icon: 'calendarCheck', tone: 'ok' },
  APPOINTMENT_REMINDER: { icon: 'clock', tone: 'ask' },
  APPOINTMENT_MANUALLY_VERIFIED: { icon: 'userCheck', tone: 'ok' },
  APPOINTMENT_CANCELLED: { icon: 'calendarX', tone: 'danger' },
  APPOINTMENT_NO_SHOW: { icon: 'userX', tone: 'danger' },
  DEPOSIT_FAILED: { icon: 'alert', tone: 'danger' },
  NEW_MESSAGE: { icon: 'message', tone: 'accent' },
  TICKET_CREATED: { icon: 'help', tone: 'accent' },
  TICKET_MESSAGE: { icon: 'help', tone: 'accent' },
  TICKET_STATUS_CHANGED: { icon: 'help', tone: 'accent' },
  REVIEW_CREATED: { icon: 'star', tone: 'star' },
  REVIEW_RESPONSE: { icon: 'star', tone: 'star' },
  REVIEW_HIDDEN: { icon: 'eye', tone: 'warn' },
  BUSINESS_APPROVED: { icon: 'checkCircle', tone: 'ok' },
  BUSINESS_REINSTATED: { icon: 'checkCircle', tone: 'ok' },
  BUSINESS_REJECTED: { icon: 'xCircle', tone: 'danger' },
  BUSINESS_SUSPENDED: { icon: 'pause', tone: 'danger' },
  BUSINESS_INVITATION: { icon: 'users', tone: 'ask' },
  PAYOUT_DESTINATION_SUBMITTED: { icon: 'wallet', tone: 'warn' },
  PAYOUT_DESTINATION_VERIFIED: { icon: 'wallet', tone: 'ok' },
  PAYOUT_DESTINATION_REJECTED: { icon: 'wallet', tone: 'danger' },
};

/**
 * The inbox, as a bell in the top bar (§96, §190).
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
        className={`tb-icon bell ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
      >
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <>
          <div className="bell-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-panel" role="dialog" aria-label="Notifications">
            <header>
              <div>
                <strong>Notifications</strong>
                <span className="muted small">
                  {unread > 0 ? `${unread} unread` : 'All caught up'}
                </span>
              </div>
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

            {rows.length === 0 && (
              <div className="bell-empty">
                <span>
                  <Icon name="inbox" size={22} />
                </span>
                <strong>Nothing yet.</strong>
              </div>
            )}

            <ul>
              {rows.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.readAt ? 'read' : 'unread'}
                  onClick={() => {
                    if (!notification.readAt) readOne.mutate(notification.id);
                  }}
                >
                  <span
                    className={`bell-mark tone-${LOOK[notification.type]?.tone ?? 'accent'}`}
                    aria-hidden="true"
                  >
                    <Icon name={LOOK[notification.type]?.icon ?? 'bell'} size={16} />
                  </span>
                  <div className="bell-text">
                    <strong>{notification.subject ?? notification.type}</strong>
                    {notification.body && <span className="bell-body">{notification.body}</span>}
                    <span className="bell-when">{when(notification.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
