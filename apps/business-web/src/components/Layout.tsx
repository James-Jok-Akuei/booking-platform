import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { getMe } from '../api/business';
import { Notifications } from './Notifications';
import { LegalBanner } from './LegalGate';

/**
 * The sidebar, grouped (§131).
 *
 * Twelve flat links meant reading all twelve to find one. They are the same
 * twelve, at the same addresses — nothing has moved, so a bookmark or a link
 * someone was sent still works. Only the menu changed.
 *
 * `group: null` is a link that sits above the headings. Appointments is there
 * because it is the landing page, and a heading above the first thing you see
 * every morning is a heading nobody reads.
 */
type NavGroup = {
  group: string | null;
  items: Array<{ to: string; label: string }>;
};

const SECTIONS: NavGroup[] = [
  {
    group: null,
    items: [{ to: '/appointments', label: 'Appointments' }],
  },
  {
    // What a customer sees, and what they can book.
    group: 'Your shop',
    items: [
      { to: '/profile', label: 'Your shopfront' },
      { to: '/services', label: 'Services' },
      { to: '/hours', label: 'Branches & hours' },
      { to: '/closures', label: 'Closures & breaks' },
    ],
  },
  {
    group: 'Customers',
    items: [
      { to: '/messages', label: 'Messages' },
      { to: '/reviews', label: 'Reviews' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/getting-paid', label: 'Getting paid' },
      { to: '/analytics', label: 'How it is going' },
    ],
  },
  {
    // Not "Settings": everything here is about the account rather than about
    // the shop, and People is where someone goes to add a colleague.
    group: 'Manage account',
    items: [
      { to: '/people', label: 'People' },
      { to: '/legal', label: 'Legal' },
      { to: '/help', label: 'Help' },
    ],
  },
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
            <div className="nav-group" key={section.group ?? 'top'}>
              {section.group && (
                <p className="nav-group-title">{section.group}</p>
              )}
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
        <LegalBanner />
        <Outlet />
      </main>
    </div>
  );
}
