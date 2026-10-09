import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SECTIONS } from '../nav';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import type { ShellData } from './useShellData';

/**
 * The menu down the left (§131, §242) — the business app's (§190), for the
 * people who run the platform.
 *
 * A floating white panel on the warm canvas: the platform's own mark and
 * "Admin console" at the top, §131's four groups with an icon per link, and
 * who is signed in at the foot. Each queue's link carries the count of what is
 * waiting in it, so the menu itself says where to go next.
 *
 * On a laptop it folds to a rail of icons (remembered); on a tablet it is
 * always the rail, labels on hover; on a phone it is a drawer from the top bar.
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
  // The rail's labels, drawn fixed to the window so the rail can still scroll
  // on a short screen without cutting them off.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (label: string) => (event: React.SyntheticEvent<HTMLElement>) => {
    if (!rail) return;
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ label, top: box.top + box.height / 2, left: box.right + 14 });
  };
  const hideTip = () => setTip(null);

  return (
    <aside className={`sidebar ${rail ? 'is-rail' : ''} ${variant === 'drawer' ? 'is-drawer' : ''}`}>
      <div className="sb-top">
        <Link to="/" className="sb-brand" onClick={onNavigate} title="BwanguReservations — Admin console">
          <span className="sb-logo sb-mark">
            <Logo size={42} />
          </span>
          <span className="sb-brand-text">
            <strong className="sb-wordmark">
              Bwangu<b>Reservations</b>
            </strong>
            <span className="sb-sub">
              <Icon name="shield" size={13} />
              Admin console
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
          <div className="sb-group" key={section.group}>
            <p className="sb-group-title">{section.group}</p>
            {section.items.map((item) => {
              const badge = item.badge ? data.waiting[item.badge] : 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
                  aria-label={rail ? `${item.label}${badge ? `, ${badge} waiting` : ''}` : undefined}
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
        <div className="sb-user">
          <Avatar label={data.email || 'Admin'} size={36} />
          <span className="sb-user-text">
            <strong title={data.email}>{data.email}</strong>
            <span>Administrator</span>
          </span>
          <button type="button" className="sb-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** On a phone, the same menu as a drawer from the left. */
export function MenuDrawer({ data, onClose, onSignOut }: { data: ShellData; onClose: () => void; onSignOut: () => void }) {
  return (
    <div className="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu" onMouseDown={onClose}>
      <div className="nav-drawer-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="nav-drawer-close" onClick={onClose} aria-label="Close the menu">
          <Icon name="close" size={20} />
        </button>
        <Sidebar data={data} variant="drawer" onNavigate={onClose} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
