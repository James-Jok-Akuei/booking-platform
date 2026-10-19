import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProfile,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/business';
import { ABOUT_THE_SHOP, lookFor } from '../lib/notificationLook';
import { Icon } from '../ui/Icon';
import { ShopLogo } from '../ui/ShopLogo';
import { Portal } from '../ui/Portal';
import { useDismiss } from '../ui/useDismiss';
import { useMediaQuery } from '../shell/useMediaQuery';

const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * The inbox, as a bell in the top bar (§96, §190).
 *
 * Live (§287): told over a socket the moment something new is made, with the
 * minute's check kept underneath for a connection that dropped.
 *
 * Opening a notification marks it read — the alternative is a separate control
 * per row for an action nobody deliberately performs.
 *
 * On a large screen it opens as a flyout down the right of the window (§220):
 * room for far more than a dropdown, with the page dimmed behind. On a phone
 * it stays a dropdown under the bar. Either way a press anywhere outside, Esc,
 * or moving to another page closes it.
 */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const wide = useMediaQuery('(min-width: 1024px)');
  const close = useCallback(() => setOpen(false), []);
  const wrap = useRef<HTMLDivElement>(null);
  // The dropdown closes on a press outside it; the flyout has its own backdrop.
  useDismiss(open && !wide, wrap, close);
  const { pathname } = useLocation();
  useEffect(close, [pathname, close]);
  const navigate = useNavigate();

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 30 }),
    refetchInterval: 60_000,
  });
  // The shop's logo, for news about the shop (§231) — the frame already asked.
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });

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
              // Opens what it is about (§287) — the same place its alert and email lead.
              const to = notification.link ?? lookFor(notification.type).to;
              if (to && to !== pathname) navigate(to);
              else close();
            }}
          >
            {ABOUT_THE_SHOP.has(notification.type) ? (
              <span className="bell-mark is-shop" aria-hidden="true">
                <ShopLogo
                  logoUrl={profile.data?.logoUrl ?? null}
                  name={profile.data?.name ?? 'Your business'}
                  size={36}
                  badge={lookFor(notification.type)}
                />
              </span>
            ) : (
              <span
                className={`bell-mark tone-${lookFor(notification.type).tone}`}
                aria-hidden="true"
              >
                <Icon name={lookFor(notification.type).icon} size={16} />
              </span>
            )}
            <div className="bell-text">
              <strong>{notification.subject ?? notification.type}</strong>
              {notification.body && <span className="bell-body">{notification.body}</span>}
              <span className="bell-when">{when(notification.createdAt)}</span>
            </div>
          </li>
        ))}
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
