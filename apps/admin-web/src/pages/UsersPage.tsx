import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  clearDisplayName,
  inviteAdmin,
  listAdminInvitations,
  listUsers,
  revokeAdminAccess,
  revokeAdminInvitation,
  type DirectoryUser,
} from '../api/admin';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Select } from '../ui/Select';

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

  const onClear = async (user: DirectoryUser) => {
    const reason = await promptDialog({
      title: 'Clear this display name?',
      body: (
        <p>
          “<strong>{user.displayName}</strong>” from {user.email}. Their reviews show as “Anonymous” instead. They
          are told this happened, and the reason.
        </p>
      ),
      label: 'Why? — written for the person it is about',
      placeholder: 'For example: the name included a phone number.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'warn',
      icon: 'user',
      confirmLabel: 'Clear the name',
      cancelLabel: 'Keep it',
    });
    if (reason === null) return;
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

      <Administrators />

      <div className="toolbar">
        <div className="filters">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email or name"
          />
          {/* The app's own dropdown (§227, §242); "Everyone" is a choice of its own. */}
          <Select
            value={role === '' ? 'ALL' : role}
            onChange={(next) => setRole(next === 'ALL' ? '' : next)}
            label="Who"
            sheetTitle="Show"
            options={ROLES.map((option) => ({ value: option.value === '' ? 'ALL' : option.value, label: option.label }))}
          />
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

/**
 * Administrators, and inviting more of them (§99).
 *
 * Only the primary administrator may invite or remove. Rather than ask who is
 * primary, the panel tries to list invitations: a 403 is the answer, and it
 * then shows the administrators without the controls. One request, no new
 * endpoint, and it cannot disagree with the server about who may act.
 */
function Administrators() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState('');

  const admins = useQuery({
    queryKey: ['users', 'ADMIN'],
    queryFn: () => listUsers({ role: 'ADMIN', limit: 100 }),
  });

  const invites = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: listAdminInvitations,
    retry: false,
  });

  // A 403 here means "you are not the primary administrator", which is the
  // only thing the controls depend on.
  const canManage = invites.isSuccess;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
  };

  const invite = useMutation({
    mutationFn: () => inviteAdmin(email.trim()),
    onSuccess: () => {
      setEmail('');
      refresh();
    },
  });

  /** The reader's own row, which is the one the server refuses outright. */
  const isSelf = (admin: { id: string }) => admin.id === user?.id;

  const revokeInvite = useMutation({ mutationFn: revokeAdminInvitation, onSuccess: refresh });
  const revokeAccess = useMutation({ mutationFn: revokeAdminAccess, onSuccess: refresh });

  return (
    <div className="card setting">
      <div className="setting-head">
        <h2>Administrators</h2>
        <p className="muted small">
          {canManage
            ? 'You are the primary administrator. Only you can invite or remove others.'
            : 'Only the primary administrator can invite or remove administrators.'}
        </p>
      </div>

      <ul className="people">
        {admins.data?.users.map((admin) => (
          <li key={admin.id}>
            <div>
              <strong>{admin.email}</strong>
              <div className="muted small">
                joined {new Date(admin.createdAt).toLocaleDateString()}
              </div>
            </div>
            {/* Two rows can never be removed, and the server says so plainly:
                your own ("You cannot remove your own access") and the primary
                administrator's ("there must always be one"). The button used to
                appear on both — including the reader's own row, which on a
                platform with one administrator is the ONLY row (§118). */}
            {canManage && (isSelf(admin) || admin.isPrimaryAdmin) && (
              <span className="muted small">
                {isSelf(admin)
                  ? admin.isPrimaryAdmin
                    ? 'You, the primary administrator'
                    : 'You'
                  : 'The primary administrator'}
              </span>
            )}
            {canManage && !isSelf(admin) && !admin.isPrimaryAdmin && (
              <button
                type="button"
                disabled={revokeAccess.isPending}
                onClick={async () => {
                  const sure = await confirmDialog({
                    title: 'Remove administrator access?',
                    body: (
                      <p>
                        <strong>{admin.email}</strong> loses it immediately, even if signed in. The account becomes an
                        ordinary customer account — nothing they did is deleted, and anything they handled still
                        names them.
                      </p>
                    ),
                    tone: 'danger',
                    icon: 'userX',
                    confirmLabel: 'Remove access',
                    cancelLabel: 'Keep them',
                  });
                  if (sure) revokeAccess.mutate(admin.id);
                }}
              >
                Remove access
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          {(invites.data?.length ?? 0) > 0 && (
            <ul className="people">
              {invites.data?.map((invitation) => (
                <li key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <div className="muted small">
                      invited, not joined yet · expires{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={revokeInvite.isPending}
                    onClick={() => revokeInvite.mutate(invitation.id)}
                  >
                    Cancel invitation
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="row-end"
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate();
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="their@email.com"
            />
            <button type="submit" className="primary" disabled={invite.isPending || !email.trim()}>
              {invite.isPending ? 'Sending…' : 'Invite an administrator'}
            </button>
          </form>

          {/* The address must have no account at all: a role decides what every
              guard lets someone reach, so promoting an existing customer would
              move their own bookings out of their app. */}
          <p className="muted small">
            The address must not already have an account of any kind.
          </p>

          {invite.error && (
            <p className="error small" role="alert">
              {invite.error instanceof ApiError ? invite.error.message : 'That did not send.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
