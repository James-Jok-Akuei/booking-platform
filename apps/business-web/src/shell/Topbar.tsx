import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Notifications } from '../components/Notifications';
import { navItemFor } from '../nav';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { roleLabel, type ShellData } from './useShellData';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar across the top of every page (§190).
 *
 * Where you are (the group and the page), a search that jumps anywhere (⌘K),
 * and the things a seller reaches for between customers: checking someone in,
 * the inbox, notifications and their account. It stays put while the page
 * scrolls under it, frosted so the page shows through.
 */
export function Topbar({
  data,
  scrolled,
  onOpenMenu,
  onOpenSearch,
  onCheckIn,
  onSignOut,
}: {
  data: ShellData;
  scrolled: boolean;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onCheckIn: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const item = navItemFor(pathname);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      <div className="tb-left">
        <button type="button" className="tb-icon tb-menu" onClick={onOpenMenu} aria-label="Open the menu">
          <Icon name="menu" size={20} />
        </button>
        <div className="tb-where">
          <span className="tb-crumbs">
            <span>{item?.group ?? 'Today'}</span>
            <Icon name="chevronRight" size={13} stroke={2.2} />
            <strong>{item?.label ?? 'Business'}</strong>
          </span>
          <span className="tb-date">{today}</span>
        </div>
      </div>

      <button type="button" className="tb-search" onClick={onOpenSearch} aria-label="Search or jump to a page">
        <Icon name="search" size={17} />
        <span>Search or jump to…</span>
        <span className="tb-keys" aria-hidden="true">
          <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      <div className="tb-right">
        <button type="button" className="tb-icon tb-search-small" onClick={onOpenSearch} aria-label="Search">
          <Icon name="search" size={19} />
        </button>
        <button type="button" className="tb-checkin" onClick={onCheckIn}>
          <Icon name="ticket" size={18} />
          <span>Check in</span>
          {data.expectedToday > 0 && <span className="tb-checkin-count">{data.expectedToday}</span>}
        </button>
        <Link
          to="/messages"
          className="tb-icon"
          aria-label={data.unreadMessages > 0 ? `${data.unreadMessages} unread messages` : 'Messages'}
          title="Messages"
        >
          <Icon name="message" size={19} />
          {data.unreadMessages > 0 && <span className="tb-dot" aria-hidden="true" />}
        </Link>
        <Notifications />
        <AccountMenu data={data} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/** The avatar, and what it opens: the account's own pages and signing out. */
function AccountMenu({ data, onSignOut }: { data: ShellData; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const links = [
    { to: '/profile', label: 'Your shopfront', icon: 'store' as const },
    { to: '/people', label: 'People', icon: 'users' as const },
    { to: '/legal', label: 'Legal', icon: 'legal' as const },
    { to: '/help', label: 'Help', icon: 'help' as const },
  ];

  return (
    <div className="tb-account" ref={ref}>
      <button
        type="button"
        className={`tb-avatar ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-label="Your account"
        aria-expanded={open}
      >
        <Avatar label={data.email || 'You'} size={36} />
        <Icon name="chevronDown" size={15} stroke={2.2} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <Avatar label={data.email || 'You'} size={42} />
            <div>
              <strong>{data.email}</strong>
              <span>
                {[roleLabel(data.role), data.business?.name].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          {links.map((link) => (
            <Link key={link.to} to={link.to} className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name={link.icon} size={18} />
              {link.label}
            </Link>
          ))}
          <div className="menu-rule" />
          <button type="button" className="menu-item is-danger" role="menuitem" onClick={onSignOut}>
            <Icon name="logout" size={18} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
