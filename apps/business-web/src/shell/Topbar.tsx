import { useCallback, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Notifications } from '../components/Notifications';
import { navItemFor } from '../nav';
import { RwandaFlag } from '../ui/RwandaFlag';
import { ShopLogo } from '../ui/ShopLogo';
import { Icon } from '../ui/Icon';
import { useDismiss } from '../ui/useDismiss';
import { clock, useNow } from '../lib/time';
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
  // The date and a clock, on every page (§235) — the one place they are on a
  // wide screen. Ticking keeps both right past midnight with the tab left open.
  const now = useNow(15_000);
  const today = now.toLocaleDateString(undefined, {
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
        {/* Rwanda's flag before where you are, on every page (§234); on a
            phone the bar has no room, and Overview's first chip carries it. */}
        <span className="tb-flag" title="Made for Rwanda">
          <RwandaFlag width={32} />
        </span>
        <div className="tb-where">
          <span className="tb-crumbs">
            <span>{item?.group ?? 'Your day'}</span>
            <Icon name="chevronRight" size={13} stroke={2.2} />
            <strong>{item?.label ?? 'Business'}</strong>
          </span>
          <span className="tb-date">
            {today}
            <span className="tb-clock">{clock(now)}</span>
          </span>
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

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const name = data.business?.name ?? 'Your business';
  const live = data.live;

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
        className={`tb-avatar tb-shop ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-label={`${name} — your shop and account`}
        aria-expanded={open}
        title={name}
      >
        <ShopLogo logoUrl={data.logoUrl} name={name} size={38} state={live ? 'live' : 'off'} />
        <span className="tb-shop-text">
          <strong>{name}</strong>
          <span>
            {live ? 'Your shop · live' : data.paused ? 'Your shop · paused' : 'Your shop · not live'}
          </span>
        </span>
        <Icon name="chevronDown" size={15} stroke={2.2} />
      </button>
      {open && (
        <div className="menu tb-shop-menu" role="menu">
          <Link to="/profile" className="tb-shop-card" onClick={() => setOpen(false)}>
            <ShopLogo logoUrl={data.logoUrl} name={name} size={54} state={live ? 'live' : 'off'} />
            <span className="tb-shop-card-text">
              <strong>{name}</strong>
              <span className={`tb-shop-state ${live ? 'is-live' : 'is-off'}`}>
                <i /> {live ? 'Live · taking bookings' : data.paused ? 'Paused' : 'Not live yet'}
              </span>
            </span>
            <Icon name="chevronRight" size={16} className="tb-shop-go" />
          </Link>
          <div className="tb-shop-who">
            <span>Signed in as</span>
            <strong title={data.email}>{data.email}</strong>
            <em>{roleLabel(data.role)}</em>
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
