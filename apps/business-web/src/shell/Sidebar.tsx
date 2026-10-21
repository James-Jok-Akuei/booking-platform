import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAccess } from '../access';
import { sectionsFor } from '../nav';
import { initialsOf } from '../ui/Avatar';
import { ShopLogo } from '../ui/ShopLogo';
import { Icon, type IconName } from '../ui/Icon';
import { roleLabel, type ShellData } from './useShellData';
import { shopStateWord } from '../onboarding/steps';

/** What the welcome tour calls each group of the menu (§307). */
const GROUP_KEYS: Record<string, string> = {
  'Your shop': 'shop',
  Customers: 'customers',
  Money: 'money',
  'Manage account': 'account',
};

/**
 * The menu down the left (§131, §190).
 *
 * A floating white panel on the warm canvas: the shop at the top, the same
 * grouped links as before with an icon each, and who is signed in at the foot.
 * The page you are on is a night pill, so it is found without reading.
 *
 * On a laptop it can fold to a rail of icons (the choice is remembered); on a
 * tablet it is always the rail, with each label shown on hover; on a phone it
 * becomes a drawer (`variant="drawer"`), opened from the top bar or the tab bar.
 */
export function Sidebar({
  data,
  rail = false,
  variant = 'desktop',
  onToggleRail,
  onNavigate,
  onSignOut,
}: {
  data: ShellData;
  rail?: boolean;
  variant?: 'desktop' | 'drawer';
  onToggleRail?: () => void;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  const { business } = data;
  const sections = sectionsFor(useAccess());
  // The rail's labels, shown beside an icon on hover or focus. Drawn fixed to
  // the window rather than inside the rail, so the rail can still scroll on a
  // short screen without cutting them off.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (label: string) => (event: React.SyntheticEvent<HTMLElement>) => {
    if (!rail) return;
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ label, top: box.top + box.height / 2, left: box.right + 14 });
  };
  const hideTip = () => setTip(null);
  const name = business?.name ?? 'Your business';
  const live = data.live;
  // Why customers cannot see the shop, in the seller's words rather than
  // the status's (§256), and where to go about it.
  const left = (data.readiness?.items ?? []).filter((i) => i.required && !i.done).length;
  /** `spotlight`: the button on the Overview it takes them to, lit when they arrive (§306). */
  type Standing = { head: string; text: string; to: string; icon: IconName; tone: string; spotlight?: string };
  const standingFor = (): Standing | null => {
    if (!business || live) return null;
    if (business.status === 'APPROVED') {
      return data.posted
        ? { head: 'Your shop is paused', text: 'Customers cannot book until you resume it.', to: '/profile', icon: 'pause', tone: 'warn' }
        : { head: 'Approved — post it', text: 'Customers see your shop once you post it.', to: '/', icon: 'send', tone: 'ok', spotlight: 'post-shop' };
    }
    if (business.status === 'PENDING' && data.readiness?.submittedAt) {
      return { head: 'Waiting for review', text: 'We are checking your shop. You get an email when it is approved.', to: '/', icon: 'hourglass', tone: 'warn' };
    }
    if (business.status === 'PENDING') {
      return left
        ? {
            head: 'Finish setting up',
            text: `${left} ${left === 1 ? 'thing' : 'things'} left before we can check your shop.`,
            to: '/welcome',
            icon: 'clock',
            tone: 'warn',
          }
        : { head: 'Ready to send', text: 'Send your shop for review from your Overview.', to: '/', icon: 'send', tone: 'warn', spotlight: 'send-review' };
    }
    return business.status === 'REJECTED'
      ? { head: 'Needs a change', text: 'See what we said, fix it, and send your shop back.', to: '/', icon: 'alert', tone: 'danger', spotlight: 'send-review' }
      : { head: 'Shop suspended', text: 'Customers cannot find or book it. Talk to support.', to: '/help', icon: 'alert', tone: 'danger' };
  };
  const standing = standingFor();
  const state = !business ? '' : shopStateWord(business.status, data.paused, data.readiness?.submittedAt, data.posted);

  const badgeFor = (to: string) =>
    to === '/appointments' ? data.expectedToday : to === '/messages' ? data.unreadMessages : 0;

  return (
    <aside className={`sidebar ${rail ? 'is-rail' : ''} ${variant === 'drawer' ? 'is-drawer' : ''}`}>
      <div className="sb-top">
        <Link to="/" className="sb-brand" onClick={onNavigate} title={name}>
          <span className="sb-logo">
            {data.logoUrl ? <img src={data.logoUrl} alt="" /> : <span>{initialsOf(name)}</span>}
            {!live && business && <i className="sb-logo-flag" aria-hidden="true" />}
          </span>
          <span className="sb-brand-text">
            <strong>{name}</strong>
            <span className="sb-sub">
              <i className={`sb-dot ${live ? 'is-live' : 'is-off'}`} aria-hidden="true" />
              {[roleLabel(data.role), state].filter(Boolean).join(' · ')}
            </span>
          </span>
        </Link>
        {variant === 'desktop' && onToggleRail && (
          <button
            type="button"
            className="sb-fold"
            onClick={onToggleRail}
            aria-label={rail ? 'Open the menu' : 'Fold the menu'}
            title={rail ? 'Open the menu' : 'Fold the menu'}
          >
            <Icon name="sidebar" size={18} />
          </button>
        )}
      </div>

      <nav className="sb-nav" aria-label="Main">
        {sections.map((section) => (
          <div className="sb-group" key={section.group ?? 'top'} data-tour={`group:${GROUP_KEYS[section.group ?? ''] ?? 'top'}`}>
            {section.group && <p className="sb-group-title">{section.group}</p>}
            {section.items.map((item) => {
              const badge = badgeFor(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
                  data-tour={`page:${item.to}`}
                  aria-label={rail ? item.label : undefined}
                  onMouseEnter={showTip(item.label)}
                  onMouseLeave={hideTip}
                  onFocus={showTip(item.label)}
                  onBlur={hideTip}
                >
                  <span className="sb-icon">
                    <Icon name={item.icon} size={19} />
                  </span>
                  <span className="sb-label">{item.label}</span>
                  {badge > 0 && (
                    <span className="sb-badge" aria-label={`${badge} waiting`}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {rail && tip && (
        <div className="sb-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">
          {tip.label}
        </div>
      )}

      <div className="sb-foot">
        {/* Only when customers CANNOT see the shop (§10.8, §119, §218): a
            business that is not APPROVED, or is paused, is invisible and
            unbookable, so its empty appointment list is correct — and looks
            like a bug unless something says so. A live shop needs no card:
            the green dot on its logo, top right, says it. */}
        {standing && (
          <Link
            to={standing.to}
            // Takes them to the very button, lit (§306) — from any page, the Overview included.
            state={standing.spotlight ? { spotlight: standing.spotlight } : undefined}
            className={`sb-status is-off${standing.spotlight ? ' is-go' : ''}`}
            onClick={onNavigate}
          >
            {/* The shop's own logo, with why it is hidden on the corner (§231). */}
            <ShopLogo
              logoUrl={data.logoUrl}
              name={name}
              size={34}
              className="sb-status-logo"
              badge={{ icon: standing.icon, tone: standing.tone }}
            />
            <span className="sb-status-body">
              <span className="sb-status-head">{standing.head}</span>
              <span className="sb-status-text">{standing.text}</span>
            </span>
            <span className="sb-status-go" aria-hidden="true">
              <Icon name="arrowRight" size={15} stroke={2.4} />
            </span>
          </Link>
        )}

        <div className="sb-user">
          <ShopLogo logoUrl={data.logoUrl} name={name} size={36} className="sb-user-logo" />
          <span className="sb-user-text">
            <strong title={data.email}>{data.email}</strong>
            <span>{roleLabel(data.role) || 'Signed in'}</span>
          </span>
          <button type="button" className="sb-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
