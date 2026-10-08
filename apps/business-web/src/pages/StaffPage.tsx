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
import { Avatar } from '../ui/Avatar';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import './staff.css';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

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

const ROLE_LOOK: Record<'OWNER' | StaffRole, { label: string; icon: IconName; cls: string }> = {
  OWNER: { label: 'Owner', icon: 'key', cls: 'owner' },
  MANAGER: { label: 'Manager', icon: 'shield', cls: 'manager' },
  STAFF: { label: 'Staff', icon: 'user', cls: 'staff' },
};

/** People who work here, and what each may do (§14, §202). */
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
    <section className="st">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">Who works here, and what each of them can do.</p>
        </div>
      </header>

      <div className="st-layout">
        <div className="st-main">
          {!isOwner && members.data && (
            <p className="st-note">
              <Icon name="shield" size={16} /> Only the owner can add or remove people. You can see who works
              here.
            </p>
          )}

          {members.isLoading && <div className="skeleton st-skeleton" />}

          {active.length > 0 && (
            <article className="st-card">
              <header>
                <h2>Working here</h2>
                <span>{active.length}</span>
              </header>
              <ul className="st-people">
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
            </article>
          )}

          {pending.length > 0 && (
            <article className="st-card">
              <header>
                <h2>Invited, not joined yet</h2>
                <span>{pending.length}</span>
              </header>
              <ul className="st-people">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="st-person is-invited">
                    <span className="st-invite-avatar">
                      <Icon name="mail" size={18} />
                    </span>
                    <div className="st-who">
                      <strong>{invitation.email}</strong>
                      <span>
                        Invited as {invitation.role.toLowerCase()} on {when(invitation.createdAt)} · expires{' '}
                        {when(invitation.expiresAt)}
                      </span>
                    </div>
                    {isOwner && <RevokeButton id={invitation.id} onDone={refresh} />}
                  </li>
                ))}
              </ul>
            </article>
          )}

          {removed.length > 0 && (
            <article className="st-card is-quiet">
              <header>
                <h2>No longer here</h2>
                <span>{removed.length}</span>
              </header>
              <p className="st-sub">Kept on purpose: this is the record that they once had access.</p>
              <ul className="st-people">
                {removed.map((member) => (
                  <li key={member.id} className="st-person is-removed">
                    <Avatar label={member.email} size={38} />
                    <div className="st-who">
                      <strong>{member.email}</strong>
                      <span>was {member.role.toLowerCase()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>

        <aside className="st-side">
          {isOwner && <InviteForm onDone={refresh} />}
          <article className="st-roles">
            <h2>What each role can do</h2>
            {(['OWNER', 'MANAGER', 'STAFF'] as const).map((role) => (
              <div key={role} className={`st-role is-${ROLE_LOOK[role].cls}`}>
                <span>
                  <Icon name={ROLE_LOOK[role].icon} size={17} />
                </span>
                <div>
                  <strong>{ROLE_LOOK[role].label}</strong>
                  <p>{ROLE_MEANS[role]}</p>
                </div>
              </div>
            ))}
          </article>
        </aside>
      </div>
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
    <form className="st-invite" onSubmit={submit}>
      <span className="st-invite-icon">
        <Icon name="users" size={20} />
      </span>
      <h2>Add someone</h2>
      <p>
        They get an email. If they do not have an account yet, one is made when they accept — they do not
        need to sign up first.
      </p>

      <label className="st-field">
        <span>Their email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
        />
      </label>

      <div className="st-field">
        <span>What they can do</span>
        <div className="st-choice" role="radiogroup">
          {(['STAFF', 'MANAGER'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              className={role === r ? 'is-on' : ''}
              onClick={() => setRole(r)}
            >
              <Icon name={ROLE_LOOK[r].icon} size={15} /> {ROLE_LOOK[r].label}
            </button>
          ))}
        </div>
        <p className="st-means">{ROLE_MEANS[role]}</p>
      </div>

      {invite.error && (
        <p className="error small" role="alert">
          {invite.error instanceof ApiError ? invite.error.message : 'That did not send.'}
        </p>
      )}
      {sent && !invite.isPending && (
        <p className="st-sent">
          <Icon name="checkCircle" size={16} /> Invitation sent to {sent}.
        </p>
      )}

      <button type="submit" className="primary st-send" disabled={invite.isPending || email.trim() === ''}>
        <Icon name="send" size={16} />
        {invite.isPending ? 'Sending…' : 'Send invitation'}
      </button>
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
  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : 'That did not work.');

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
  const look = ROLE_LOOK[member.role as 'OWNER' | StaffRole] ?? ROLE_LOOK.STAFF;

  return (
    <li className="st-person">
      <Avatar label={member.email} size={44} />
      <div className="st-who">
        <strong>
          {member.email}
          {isMe && <em>you</em>}
        </strong>
        <span>{ROLE_MEANS[member.role as 'OWNER' | StaffRole]}</span>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
      </div>

      <div className="st-actions">
        {editable ? (
          <div className="st-mini-choice" role="radiogroup" aria-label={`Role of ${member.email}`}>
            {(['STAFF', 'MANAGER'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={member.role === r}
                className={member.role === r ? 'is-on' : ''}
                disabled={changeRole.isPending}
                onClick={() => member.role !== r && changeRole.mutate(r)}
              >
                {ROLE_LOOK[r].label}
              </button>
            ))}
          </div>
        ) : (
          <span className={`st-badge is-${look.cls}`}>
            <Icon name={look.icon} size={14} /> {look.label}
          </span>
        )}

        {editable && (
          <button
            type="button"
            className="st-remove"
            disabled={remove.isPending}
            aria-label={`Remove ${member.email}`}
            title="Remove"
            onClick={async () => {
              if (
                await confirmDialog({
                  title: `Remove ${member.email}?`,
                  body: (
                    <p>
                      They lose access straight away. Their name stays on anything they already did, and you
                      can invite them again later.
                    </p>
                  ),
                  tone: 'danger',
                  icon: 'userX',
                  confirmLabel: 'Remove',
                })
              ) {
                remove.mutate();
              }
            }}
          >
            {remove.isPending ? '…' : <Icon name="userX" size={17} />}
          </button>
        )}
      </div>
    </li>
  );
}

function RevokeButton({ id, onDone }: { id: string; onDone: () => void }) {
  const revoke = useMutation({ mutationFn: () => revokeInvitation(id), onSuccess: onDone });
  return (
    <button type="button" className="st-revoke" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
      {revoke.isPending ? 'Cancelling…' : 'Cancel invitation'}
    </button>
  );
}
