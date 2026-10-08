import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SECTIONS } from '../nav';
import { initialsOf } from '../ui/Avatar';
import { ShopLogo } from '../ui/ShopLogo';
import { Icon } from '../ui/Icon';
import { roleLabel, type ShellData } from './useShellData';

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
  const live = business?.status === 'APPROVED' && !data.paused;
  const state = !business ? '' : data.paused ? 'Paused' : live ? 'Live' : business.status.toLowerCase();

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
        {SECTIONS.map((section) => (
          <div className="sb-group" key={section.group ?? 'top'}>
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
        {/* Whether customers can see the shop at all (§10.8, §119). A business
            that is not APPROVED is invisible and unbookable, so its empty
            appointment list is correct — and looks like a bug unless
            something here says so. */}
        {business && (
          <Link to="/profile" className={`sb-status ${live ? 'is-live' : 'is-off'}`} onClick={onNavigate}>
            <span className="sb-status-head">
              <i className="sb-pulse" aria-hidden="true" />
              {live ? 'Your shop is live' : data.paused ? 'Your shop is paused' : 'Not live yet'}
            </span>
            <span className="sb-status-text">
              {live ? (
                'Customers can find you and book.'
              ) : data.paused ? (
                'Customers cannot book until you resume it.'
              ) : (
                <>
                  This business is <strong>{business.status}</strong>, so it does not appear in
                  search and cannot take new bookings.
                </>
              )}
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
