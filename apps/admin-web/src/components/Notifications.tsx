import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../api/admin';
import { destinationFor, lookFor } from '../lib/notificationLook';
import { useMediaQuery } from '../shell/useMediaQuery';
import { Icon } from '../ui/Icon';
import { Portal } from '../ui/Portal';
import { useDismiss } from '../ui/useDismiss';

const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * The inbox, as a bell in the top bar (§96, §242) — the business app's
 * (§190, §220): a flyout down the right on a large screen, a dropdown under
 * the bar on a phone; a press outside, Esc or another page closes it.
 *
 * Polled once a minute rather than pushed. Pressing a notice marks it read
 * and opens the page that deals with it — a new ticket opens Support, a
 * number to check opens Payout numbers.
 */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1024px)');
  const close = useCallback(() => setOpen(false), []);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open && !wide, wrap, close);
  const { pathname } = useLocation();
  useEffect(close, [pathname, close]);

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

  const list = (
    <>
      <header>
        <div>
          <strong>Notifications</strong>
          <span className="muted small">{unread > 0 ? `${unread} unread` : 'All caught up'}</span>
        </div>
        {unread > 0 && (
          <button type="button" className="link" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
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
        {rows.map((notification) => {
          const look = lookFor(notification.type);
          return (
            <li
              key={notification.id}
              className={notification.readAt ? 'read' : 'unread'}
              onClick={() => {
                if (!notification.readAt) readOne.mutate(notification.id);
                close();
                navigate(destinationFor(notification));
              }}
            >
              <span className={`bell-mark tone-${look.tone}`} aria-hidden="true">
                <Icon name={look.icon} size={16} />
              </span>
              <div className="bell-text">
                <strong>{notification.subject ?? notification.type}</strong>
                {notification.body && <span className="bell-body">{notification.body}</span>}
                <span className="bell-when">{when(notification.createdAt)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <div className="bell-wrap" ref={wrap}>
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

      {open && !wide && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          {list}
        </div>
      )}
      {open && wide && (
        <Flyout onClose={close} unread={unread}>
          {list}
        </Flyout>
      )}
    </div>
  );
}

/** Down the right of the window, over the page, which is dimmed behind it (§220). */
function Flyout({ onClose, unread, children }: { onClose: () => void; unread: number; children: ReactNode }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <Portal>
      <div className="nf-backdrop" onPointerDown={onClose} />
      <aside className="nf-flyout" role="dialog" aria-modal="true" aria-label="Notifications">
        <button type="button" className="nf-close" onClick={onClose} ref={closeBtn} aria-label="Close notifications">
          <Icon name="close" size={18} />
        </button>
        <div className="nf-scroll bell-panel-body">{children}</div>
        <footer className="nf-foot">
          <Icon name="bell" size={14} />
          {unread > 0 ? `${unread} unread · ` : ''}arrives as it happens
          <Link to="/notifications" className="nf-settings" onClick={onClose}>
            <Icon name="sliders" size={14} /> Choose what you get
          </Link>
        </footer>
      </aside>
    </Portal>
  );
}
