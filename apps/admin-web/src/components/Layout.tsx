import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Notifications } from './Notifications';

/**
 * The sidebar, grouped (§131). Only the sections that exist; others are added
 * as they are built.
 *
 * Twelve flat links in no order meant reading all twelve to find one — and the
 * three money screens were not even next to each other. Same twelve links, same
 * addresses, so every bookmark still works. Only the menu changed.
 */
type NavGroup = {
  group: string;
  items: Array<{ to: string; label: string }>;
};

const SECTIONS: NavGroup[] = [
  {
    // Deciding what stays on the platform.
    group: 'Moderation',
    items: [
      { to: '/businesses', label: 'Businesses' },
      { to: '/reviews', label: 'Reviews' },
      { to: '/appointments', label: 'Appointments' },
    ],
  },
  {
    group: 'People',
    items: [
      { to: '/users', label: 'Users' },
      { to: '/tickets', label: 'Support' },
    ],
  },
  {
    // The three that have to be read together to answer "did the money move".
    group: 'Money',
    items: [
      { to: '/payouts', label: 'Payouts' },
      { to: '/payout-destinations', label: 'Payout destinations' },
      { to: '/ledger', label: 'Money' },
    ],
  },
  {
    // Reference data and rules. Rarely touched, and dangerous when it is.
    group: 'Platform',
    items: [
      { to: '/categories', label: 'Categories' },
      { to: '/places', label: 'Places' },
      { to: '/legal', label: 'Legal' },
      { to: '/settings', label: 'Settings' },
    ],
  },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside>
        <div className="brand">Admin</div>
        <nav>
          {SECTIONS.map((section) => (
            <div className="nav-group" key={section.group}>
              <p className="nav-group-title">{section.group}</p>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="who">
          <div className="who-top">
            <span title={user?.email}>{user?.email}</span>
            <Notifications />
          </div>
          <button
            type="button"
            className="link"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
