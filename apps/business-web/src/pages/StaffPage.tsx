import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  setMemberRole,
  type Member,
  type StaffRole,
} from '../api/business';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * What each role may actually do, in the words of the person deciding.
 *
 * Taken from the guards, not invented: OWNER and MANAGER may write; STAFF reads
 * everything and writes nothing. Only the OWNER may change who has access —
 * that is the line between OWNER and MANAGER.
 */
const ROLE_MEANS: Record<'OWNER' | StaffRole, string> = {
  OWNER: 'Runs everything, including who works here. Only one person can be the owner.',
  MANAGER: 'Can change services, hours, prices and bookings. Cannot add or remove people.',
  STAFF: 'Can see everything and handle bookings, but cannot change the business.',
};

export function StaffPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const members = useQuery({ queryKey: ['members'], queryFn: listMembers });
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: listInvitations });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['members'] });
    queryClient.invalidateQueries({ queryKey: ['invitations'] });
  };

  // Only the owner may manage people. Everyone else still sees the list —
  // knowing who you work with is not a privilege — so the page renders either
  // way and the controls are what disappear.
  const me = members.data?.find((m) => m.userId === user?.id);
  const isOwner = me?.role === 'OWNER';

  const active = members.data?.filter((m) => m.status === 'ACTIVE') ?? [];
  const removed = members.data?.filter((m) => m.status === 'REMOVED') ?? [];
  const pending = invitations.data ?? [];

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">
            Who works here, and what each of them can do.
          </p>
        </div>
      </header>

      {isOwner && <InviteForm onDone={refresh} />}
      {!isOwner && members.data && (
        <p className="notice">
          Only the owner can add or remove people. You can see who works here.
        </p>
      )}

      {members.isLoading && <p className="muted">Loading…</p>}

      {active.length > 0 && (
        <div className="panel">
          <h2>Working here</h2>
          <ul className="people">
            {active.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isOwner={isOwner}
                isMe={member.userId === user?.id}
                onDone={refresh}
              />
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className="panel">
          <h2>Invited, not joined yet</h2>
          <ul className="people">
            {pending.map((invitation) => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <div className="muted small">
                    Invited as {invitation.role.toLowerCase()} on{' '}
                    {when(invitation.createdAt)} · expires {when(invitation.expiresAt)}
                  </div>
                </div>
                {isOwner && <RevokeButton id={invitation.id} onDone={refresh} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {removed.length > 0 && (
        <div className="panel">
          <h2>No longer here</h2>
          <p className="muted small">
            Kept on purpose: this is the record that they once had access.
          </p>
          <ul className="people">
            {removed.map((member) => (
              <li key={member.id} className="muted">
                <div>
                  <strong>{member.email}</strong>
                  <div className="small">was {member.role.toLowerCase()}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const [sent, setSent] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => inviteMember(email.trim(), role),
    onSuccess: () => {
      setSent(email.trim());
      setEmail('');
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSent(null);
    invite.mutate();
  };

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Add someone</h2>
      <p className="muted small">
        They get an email. If they do not have an account yet, one is made when they
        accept — they do not need to sign up first.
      </p>

      <div className="two-up">
        <label>
          Their email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </label>
        <label>
          What they can do
          <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
          </select>
        </label>
      </div>

      <p className="muted small">{ROLE_MEANS[role]}</p>

      {invite.error && (
        <p className="error small" role="alert">
          {invite.error instanceof ApiError ? invite.error.message : 'That did not send.'}
        </p>
      )}
      {sent && !invite.isPending && (
        <p className="muted small">Invitation sent to {sent}.</p>
      )}

      <div className="row-end">
        <button
          type="submit"
          className="primary"
          disabled={invite.isPending || email.trim() === ''}
        >
          {invite.isPending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </form>
  );
}

function MemberRow({
  member,
  isOwner,
  isMe,
  onDone,
}: {
  member: Member;
  isOwner: boolean;
  isMe: boolean;
  onDone: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (error: unknown) =>
    setProblem(error instanceof ApiError ? error.message : 'That did not work.');

  const changeRole = useMutation({
    mutationFn: (role: StaffRole) => setMemberRole(member.id, role),
    onSuccess: () => {
      setProblem(null);
      onDone();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => removeMember(member.id),
    onSuccess: () => {
      setProblem(null);
      onDone();
    },
    onError: fail,
  });

  // The owner is untouchable in both directions: they cannot be demoted, and
  // nobody can be promoted into a second owner. The server enforces it; showing
  // the controls would only offer a refusal.
  const editable = isOwner && member.role !== 'OWNER' && !isMe;

  return (
    <li>
      <div>
        <strong>{member.email}</strong>
        {isMe && <span className="muted small"> · you</span>}
        <div className="muted small">{ROLE_MEANS[member.role]}</div>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
      </div>

      <div className="people-actions">
        {editable ? (
          <select
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(event) => changeRole.mutate(event.target.value as StaffRole)}
          >
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
          </select>
        ) : (
          <span className="pill tkt-closed">{member.role.toLowerCase()}</span>
        )}

        {editable && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${member.email}?\n\n` +
                    'They lose access straight away. Their name stays on anything ' +
                    'they already did, and you can invite them again later.',
                )
              ) {
                remove.mutate();
              }
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>
    </li>
  );
}

function RevokeButton({ id, onDone }: { id: string; onDone: () => void }) {
  const revoke = useMutation({ mutationFn: () => revokeInvitation(id), onSuccess: onDone });
  return (
    <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
      {revoke.isPending ? 'Cancelling…' : 'Cancel invitation'}
    </button>
  );
}
