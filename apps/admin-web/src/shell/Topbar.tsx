import { useCallback, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Notifications } from '../components/Notifications';
import { navItemFor } from '../nav';
import { clock, useNow } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { RwandaFlag } from '../ui/RwandaFlag';
import { useDismiss } from '../ui/useDismiss';
import type { ShellData } from './useShellData';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar across the top of every page (§242) — the business app's (§190,
 * §234–§237): the flag, where you are and the time, a search that jumps
 * anywhere (⌘K), and the things an administrator reaches for: what is waiting,
 * notifications, and their account.
 */
export function Topbar({
  data,
  scrolled,
  onOpenMenu,
  onOpenSearch,
  onSignOut,
}: {
  data: ShellData;
  scrolled: boolean;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const item = navItemFor(pathname);
  const now = useNow(15_000);
  const today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      <div className="tb-left">
        <button type="button" className="tb-icon tb-menu" onClick={onOpenMenu} aria-label="Open the menu">
          <Icon name="menu" size={20} />
        </button>
        <span className="tb-flag" title="Made for Rwanda">
          <RwandaFlag width={32} />
        </span>
        <div className="tb-where">
          <span className="tb-crumbs">
            <span>{item?.group ?? 'Admin'}</span>
            <Icon name="chevronRight" size={13} stroke={2.2} />
            <strong>{item?.label ?? 'Overview'}</strong>
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
        <WaitingMenu data={data} />
        <Notifications />
        <AccountMenu data={data} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/**
 * Everything waiting for an administrator, in one place (§242): the coral
 * button that, in the business app, checks a customer in. Its number is the
 * sum of the four queues; it opens on each queue with its own count.
 */
function WaitingMenu({ data }: { data: ShellData }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const { waiting } = data;
  const rows: Array<{ to: string; icon: IconName; n: number; one: string; many: string }> = [
    { to: '/businesses', icon: 'store', n: waiting.businesses, one: 'shop to approve', many: 'shops to approve' },
    { to: '/payout-destinations', icon: 'wallet', n: waiting.destinations, one: 'payout number to check', many: 'payout numbers to check' },
    { to: '/payouts', icon: 'send', n: waiting.payouts, one: 'payout to send', many: 'payouts to send' },
    { to: '/tickets', icon: 'help', n: waiting.tickets, one: 'new support ticket', many: 'new support tickets' },
  ];
  const total = rows.reduce((sum, row) => sum + row.n, 0);

  if (!data.known) {
    return (
      <div className="tb-account">
        <button type="button" className="tb-checkin is-checking" disabled aria-label="Checking the queues">
          <Icon name="inbox" size={18} />
          <span>Checking…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="tb-account" ref={ref}>
      <button
        type="button"
        className={`tb-checkin${total === 0 ? ' is-clear' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-label={total > 0 ? `${total} things waiting for you` : 'Nothing waiting'}
      >
        <Icon name={total > 0 ? 'inbox' : 'checkCircle'} size={18} />
        <span>{total > 0 ? 'Waiting' : 'All clear'}</span>
        {total > 0 && <span className="tb-checkin-count">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="menu tb-waiting-menu" role="menu">
          <p className="tb-waiting-head">{total > 0 ? 'Waiting for you' : 'Nothing is waiting'}</p>
          {rows.map((row) => (
            <Link
              key={row.to}
              to={row.to}
              role="menuitem"
              className={`menu-item tb-waiting-row${row.n === 0 ? ' is-done' : ''}`}
              onClick={close}
            >
              <Icon name={row.icon} size={18} />
              <span>
                {row.n === 0 ? 'No' : row.n} {row.n === 1 ? row.one : row.many}
              </span>
              {row.n > 0 ? <b>{row.n}</b> : <Icon name="check" size={16} stroke={2.4} />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Who is signed in, and the way out. */
function AccountMenu({ data, onSignOut }: { data: ShellData; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  return (
    <div className="tb-account" ref={ref}>
      <button
        type="button"
        className={`tb-avatar tb-shop ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-label={`${data.email} — your account`}
        aria-expanded={open}
        title={data.email}
      >
        <Avatar label={data.email || 'Admin'} size={38} />
        <span className="tb-shop-text">
          <strong>{data.email.split('@')[0]}</strong>
          <span>Administrator</span>
        </span>
        <Icon name="chevronDown" size={15} stroke={2.2} />
      </button>
      {open && (
        <div className="menu tb-shop-menu" role="menu">
          <div className="tb-shop-who">
            <span>Signed in as</span>
            <strong title={data.email}>{data.email}</strong>
            <em>Administrator</em>
          </div>
          <Link to="/users" className="menu-item" role="menuitem" onClick={close}>
            <Icon name="users" size={18} />
            Administrators
          </Link>
          <Link to="/settings" className="menu-item" role="menuitem" onClick={close}>
            <Icon name="sliders" size={18} />
            Settings
          </Link>
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
