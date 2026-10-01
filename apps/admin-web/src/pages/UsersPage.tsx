import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  clearDisplayName,
  listUsers,
  type DirectoryUser,
} from '../api/admin';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const ROLES = [
  { value: '', label: 'Everyone' },
  { value: 'CUSTOMER', label: 'Customers' },
  { value: 'BUSINESS', label: 'Business accounts' },
  { value: 'ADMIN', label: 'Administrators' },
] as const;

/**
 * The user directory.
 *
 * The only action here is clearing a display name, and until §94 there was no
 * list, search or lookup to reach a user by — the PATCH took an id nothing
 * produced. So this is mostly a way to find someone, and the moderation is one
 * button on the row.
 *
 * There is deliberately no edit. Replacing a name with wording an admin
 * preferred would publish words under that customer's byline they never wrote.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<string>('');
  const [search, setSearch] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);

  const users = useQuery({
    queryKey: ['users', role, search, namedOnly],
    queryFn: () =>
      listUsers({
        limit: 100,
        ...(role ? { role: role as 'ADMIN' | 'BUSINESS' | 'CUSTOMER' } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(namedOnly ? { withDisplayName: 'true' } : {}),
      }),
  });

  const clear = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      clearDisplayName(input.id, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const onClear = (user: DirectoryUser) => {
    const reason = window.prompt(
      `Clear the name "${user.displayName}" from ${user.email}?\n\n` +
        'Their reviews will show as "Anonymous" instead. They are told this ' +
        'happened and given the reason, so write something that can be read ' +
        'by the person it is about.\n\n' +
        'Why?',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert('A reason of at least three characters is required.');
      return;
    }
    clear.mutate({ id: user.id, reason: reason.trim() });
  };

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Users</h1>
          <p className="muted">Every account on the platform.</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="filters">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email or name"
          />
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="inline small">
            <input
              type="checkbox"
              checked={namedOnly}
              onChange={(event) => setNamedOnly(event.target.checked)}
            />
            Only those with a chosen name
          </label>
        </div>
        {users.data && <span className="muted small">{users.data.total} accounts</span>}
      </div>

      {clear.error && (
        <p className="error" role="alert">
          {clear.error instanceof ApiError ? clear.error.message : 'That did not work.'}
        </p>
      )}

      {users.isLoading && <p className="muted">Loading…</p>}
      {users.data?.users.length === 0 && <p className="muted empty">Nobody matches.</p>}

      {users.data && users.data.users.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Shows as</th>
              <th>Role</th>
              <th>Activity</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.email}</strong>
                  {user.businesses.length > 0 && (
                    <div className="muted small">
                      {user.businesses
                        .map((b) => `${b.name ?? 'Unnamed'} · ${b.role.toLowerCase()}`)
                        .join(', ')}
                    </div>
                  )}
                </td>
                <td>
                  {user.displayName ?? <span className="muted">Anonymous</span>}
                </td>
                <td className="small">{user.role.toLowerCase()}</td>
                <td className="small muted">
                  {/* Enough to tell a real account from an empty one, which is
                      the question a directory row has to answer. */}
                  {user.appointmentCount} bookings · {user.reviewCount} reviews ·{' '}
                  {user.ticketCount} tickets
                </td>
                <td className="small">{formatDate(user.createdAt)}</td>
                <td>
                  {user.displayName && (
                    <button
                      type="button"
                      disabled={clear.isPending}
                      onClick={() => onClear(user)}
                    >
                      Clear name
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
