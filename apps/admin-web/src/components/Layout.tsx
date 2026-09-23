import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

/** Only the sections that exist. Others are added as they are built. */
const SECTIONS = [
  { to: '/businesses', label: 'Businesses' },
  { to: '/payout-destinations', label: 'Payout destinations' },
  { to: '/payouts', label: 'Payouts' },
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
          <span title={user?.email}>{user?.email}</span>
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
