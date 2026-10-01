import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Notifications } from './Notifications';

/** Only the sections that exist. Others are added as they are built. */
const SECTIONS = [
  { to: '/businesses', label: 'Businesses' },
  { to: '/payout-destinations', label: 'Payout destinations' },
  { to: '/payouts', label: 'Payouts' },
  { to: '/ledger', label: 'Money' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/appointments', label: 'Appointments' },
  { to: '/users', label: 'Users' },
  { to: '/tickets', label: 'Support' },
  { to: '/settings', label: 'Settings' },
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
            <NavLink key={section.to} to={section.to}>
              {section.label}
            </NavLink>
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
