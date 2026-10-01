import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { getMe } from '../api/business';

const SECTIONS = [
  { to: '/appointments', label: 'Appointments' },
  { to: '/profile', label: 'Your shopfront' },
  { to: '/people', label: 'People' },
  { to: '/services', label: 'Services' },
  { to: '/hours', label: 'Branches & hours' },
  { to: '/getting-paid', label: 'Getting paid' },
  { to: '/help', label: 'Help' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });

  const business = me.data?.businessMembership?.businessProfile;
  const membership = me.data?.businessMembership;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          {business?.name ?? 'Business'}
          {membership && <div className="muted small">{membership.role.toLowerCase()}</div>}
        </div>

        {/* A business that is not APPROVED is invisible to customers and cannot
            be booked (§10.8). Saying so here stops an owner wondering why an
            empty appointment list is empty. */}
        {business && business.status !== 'APPROVED' && (
          <p className="notice small">
            This business is <strong>{business.status}</strong>, so it does not
            appear in search and cannot take new bookings.
          </p>
        )}

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
