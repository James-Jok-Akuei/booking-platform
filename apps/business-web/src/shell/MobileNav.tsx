import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import { Sidebar } from './Sidebar';
import type { ShellData } from './useShellData';

/**
 * The phone's way round the app (§190).
 *
 * A seller is often on their feet with a phone in hand, so on a narrow screen
 * the menu moves to a floating bar at the bottom, in thumb's reach — the same
 * night pill as the customer app's (§133) — with checking someone in as the
 * raised coral button in the middle. Everything else is one tap away under
 * "Menu", which opens the full sidebar as a drawer.
 */
export function TabBar({
  data,
  onCheckIn,
  onOpenMenu,
}: {
  data: ShellData;
  onCheckIn: () => void;
  onOpenMenu: () => void;
}) {
  const tab = (to: string, label: string, icon: IconName, badge = 0) => (
    <NavLink to={to} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
      <span className="tab-icon">
        <Icon name={icon} size={21} />
        {badge > 0 && <span className="tab-badge">{badge > 9 ? '9+' : badge}</span>}
      </span>
      <span>{label}</span>
    </NavLink>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/appointments', 'Bookings', 'calendarCheck', data.expectedToday)}
      {tab('/services', 'Services', 'tag')}
      <button type="button" className="tab-checkin" onClick={onCheckIn} aria-label="Check in a customer">
        <Icon name="ticket" size={24} />
      </button>
      {tab('/messages', 'Messages', 'message', data.unreadMessages)}
      <button type="button" className="tab-item" onClick={onOpenMenu}>
        <span className="tab-icon">
          <Icon name="menu" size={21} />
        </span>
        <span>Menu</span>
      </button>
    </nav>
  );
}

/** The whole sidebar, slid in from the left over the page. */
export function MenuDrawer({
  data,
  onClose,
  onSignOut,
}: {
  data: ShellData;
  onClose: () => void;
  onSignOut: () => void;
}) {
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
