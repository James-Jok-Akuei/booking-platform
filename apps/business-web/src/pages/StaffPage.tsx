import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import { useAccess } from '../access';
import {
  inviteMember,
  listInvitations,
  listLocations,
  listMembers,
  removeMember,
  revokeInvitation,
  setMemberBranches,
  setMemberRole,
  type Location,
  type Member,
  type MemberBranches,
  type StaffRole,
} from '../api/business';
import { Avatar } from '../ui/Avatar';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { BranchPicker, branchWords } from './BranchPicker';
import './staff.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { formatDate } from '../i18n/format';

const when = (iso: string) => formatDate(new Date(iso), { dateStyle: 'medium' });

/**
 * What each role may actually do, in the words of the person deciding (§277).
 *
 * Taken from the guards, not invented. The role says WHAT; the branches say
 * WHERE. Only the OWNER may change who has access, and where — that is the
 * line between OWNER and everyone else.
 */
const ROLE_MEANS: Record<'OWNER' | StaffRole, string> = {
  get OWNER() { return t`Runs everything at every branch: the money, the shopfront, and who works where. There is only one owner.`; },
  get MANAGER() { return t`Runs their branches: bookings, cancellations, hours, closures and photos. A manager of every branch also changes the shopfront, services and prices, and sees the money.`; },
  get STAFF() { return t`Works the front desk at their branches: checks customers in, marks visits done, and answers messages and reviews. Cannot cancel bookings or see the money.`; },
};

/** "Invited as manager on 3 Oct · expires 10 Oct" — a whole sentence per role, never a role word glued in. */
const invitedLine = (role: 'OWNER' | StaffRole, on: string, until: string) =>
  role === 'OWNER'
    ? t`Invited as owner on ${on} · expires ${until}`
    : role === 'MANAGER'
      ? t`Invited as manager on ${on} · expires ${until}`
      : t`Invited as staff on ${on} · expires ${until}`;

/** The same, in a few words, for a row. */
const ROLE_SHORT: Record<'OWNER' | StaffRole, string> = {
  get OWNER() { return t`Runs everything`; },
  get MANAGER() { return t`Runs their branches`; },
  get STAFF() { return t`Front desk`; },
};

const ROLE_LOOK: Record<'OWNER' | StaffRole, { label: string; icon: IconName; cls: string }> = {
  OWNER: {
    get label() { return t`Owner`; },
    icon: 'key',
    cls: 'owner'
  },
  MANAGER: {
    get label() { return t`Manager`; },
    icon: 'shield',
    cls: 'manager'
  },
  STAFF: {
    get label() { return t`Staff`; },
    icon: 'user',
    cls: 'staff'
  },
};

/** People who work here, and what each may do (§14, §202). */
export function StaffPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const access = useAccess();
  const members = useQuery({ queryKey: ['members'], queryFn: listMembers });
  // Invitations are the owner's to see (§90).
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: listInvitations,
    enabled: access.ready && access.people,
  });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const branches = locations.data ?? [];
  const open = branches.filter((b) => b.isActive);
  const [choosing, setChoosing] = useState<Member | null>(null);

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
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>People</Trans></h1>
            <p className="muted"><Trans>Who works here, and what each of them can do.</Trans></p>
          </div>
        </header>
      </div>

      <div className="st-layout">
        <div className="st-main">
          {!isOwner && members.data && (
            <p className="st-note">
              <Icon name="shield" size={16} />
              <span><Trans>Only the owner can add people and choose where they work.{' '}</Trans>
                {access.allBranches
                  ? t`You work at every branch.`
                  : t`You work at ${branchWords({ allLocations: false, locationIds: access.branchIds }, branches)} — you see the people there.`}
              </span>
            </p>
          )}

          {members.isLoading && <div className="skeleton st-skeleton" />}

          {active.length > 0 && (
            <article className="st-card">
              <header>
                <h2><Trans>Working here</Trans></h2>
                <span>{active.length}</span>
              </header>
              <ul className="st-people">
                {active.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isOwner={isOwner}
                    isMe={member.userId === user?.id}
                    branches={branches}
                    onChooseBranches={() => setChoosing(member)}
                    onDone={refresh}
                  />
                ))}
              </ul>
            </article>
          )}

          {pending.length > 0 && (
            <article className="st-card">
              <header>
                <h2><Trans>Invited, not joined yet</Trans></h2>
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
                        {invitedLine(invitation.role, when(invitation.createdAt), when(invitation.expiresAt))}
                      </span>
                      <BranchChips value={invitation} branches={branches} />
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
                <h2><Trans>No longer here</Trans></h2>
                <span>{removed.length}</span>
              </header>
              <p className="st-sub"><Trans>Kept on purpose: this is the record that they once had access.</Trans></p>
              <ul className="st-people">
                {removed.map((member) => (
                  <li key={member.id} className="st-person is-removed">
                    <Avatar label={member.email} size={38} />
                    <div className="st-who">
                      <strong>{member.email}</strong>
                      <span>{member.role === 'OWNER' ? t`was the owner` : member.role === 'MANAGER' ? t`was a manager` : t`was staff`}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>

        <aside className="st-side">
          {isOwner && <InviteForm branches={open} onDone={refresh} />}
          <article className="st-roles">
            <h2><Trans>What each role can do</Trans></h2>
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
            <div className="st-role is-branches">
              <span>
                <Icon name="pin" size={17} />
              </span>
              <div>
                <strong><Trans>Branches</Trans></strong>
                <p>
                  <Trans>
                    Choose where each person works. They see only the bookings, messages and reviews of their branches.
                    “Every branch” includes any you open later.
                  </Trans>
                </p>
              </div>
            </div>
          </article>
        </aside>
      </div>

      {choosing && (
        <BranchesPanel member={choosing} branches={open} onClose={() => setChoosing(null)} onDone={refresh} />
      )}
    </section>
  );
}

/** Where someone works, as small tags: every branch, or each by name. */
function BranchChips({ value, branches }: { value: MemberBranches; branches: Location[] }) {
  if (value.allLocations) {
    return (
      <span className="st-branches">
        <span className="st-branch is-every">
          <Icon name="layers" size={12} />{' '}
          <Trans>Every branch</Trans>
        </span>
      </span>
    );
  }
  const named = value.locationIds
    .map((id) => branches.find((b) => b.id === id))
    .filter((b): b is Location => Boolean(b));
  return (
    <span className="st-branches">
      {named.length === 0 && <span className="st-branch is-none"><Trans>No branch yet</Trans></span>}
      {named.map((b) => (
        <span key={b.id} className={`st-branch${b.isActive ? '' : ' is-closed'}`}>
          <Icon name="pin" size={12} /> {b.name}
        </span>
      ))}
    </span>
  );
}

/** Changing where someone works (§277), in the panel from the right. */
function BranchesPanel({
  member,
  branches,
  onClose,
  onDone,
}: {
  member: Member;
  branches: Location[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState<MemberBranches>({
    allLocations: member.allLocations,
    // Only open branches can be chosen; a closed one they had stays theirs only if left alone.
    locationIds: member.locationIds.filter((id) => branches.some((b) => b.id === id)),
  });
  const save = useMutation({
    mutationFn: () => setMemberBranches(member.id, value),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const unchanged =
    value.allLocations === member.allLocations &&
    (value.allLocations ||
      (value.locationIds.length === member.locationIds.length &&
        value.locationIds.every((id) => member.locationIds.includes(id))));
  const empty = !value.allLocations && value.locationIds.length === 0;

  return (
    <Panel
      eyebrow={t`Where they work`}
      title={member.email}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            <Trans>Cancel</Trans>
          </button>
          <button type="button" className="primary" disabled={save.isPending || unchanged || empty} onClick={() => save.mutate()}>
            {save.isPending ? t`Saving…` : t`Save`}
          </button>
        </>
      }
    >
      <p className="st-panel-lead">
        {member.role === 'MANAGER'
          ? t`A manager runs the branches you choose — their bookings, hours, closures and photos. With every branch, they also run the shopfront, the services and prices, and see the money.`
          : t`Staff work the front desk at the branches you choose. They see only those branches’ bookings, messages and reviews.`}
      </p>
      <BranchPicker branches={branches} value={value} onChange={setValue} />
      <p className="st-panel-note">
        <Icon name="info" size={14} />{' '}
        <Trans>It changes straight away — they do not need to sign in again.</Trans>
      </p>
      {save.error && (
        <p className="error small" role="alert">
          {save.error instanceof ApiError ? save.error.message : t`That did not save.`}
        </p>
      )}
    </Panel>
  );
}

function InviteForm({ branches, onDone }: { branches: Location[]; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const [where, setWhere] = useState<MemberBranches>({ allLocations: true, locationIds: [] });
  const [sent, setSent] = useState<string | null>(null);
  const noBranch = !where.allLocations && where.locationIds.length === 0;

  const invite = useMutation({
    mutationFn: () => inviteMember(email.trim(), role, where),
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
      <h2><Trans>Add someone</Trans></h2>
      <p>
        <Trans>
          They get an email. If they do not have an account yet, one is made when they accept — they do not
          need to sign up first.
        </Trans>
      </p>

      <label className="st-field">
        <span><Trans>Their email</Trans></span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t`name@example.com`}
        />
      </label>

      <div className="st-field">
        <span><Trans>What they can do</Trans></span>
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

      {branches.length > 0 && (
        <div className="st-field">
          <span><Trans>Where they work</Trans></span>
          <BranchPicker branches={branches} value={where} onChange={setWhere} compact />
        </div>
      )}

      {invite.error && (
        <p className="error small" role="alert">
          {invite.error instanceof ApiError ? invite.error.message : t`That did not send.`}
        </p>
      )}
      {sent && !invite.isPending && (
        <p className="st-sent">
          <Icon name="checkCircle" size={16} />{' '}
          <Trans>Invitation sent to {sent}.</Trans>
        </p>
      )}

      <button type="submit" className="primary st-send" disabled={invite.isPending || email.trim() === '' || noBranch}>
        <Icon name="send" size={16} />
        {invite.isPending ? t`Sending…` : t`Send invitation`}
      </button>
    </form>
  );
}

function MemberRow({
  member,
  isOwner,
  isMe,
  branches,
  onChooseBranches,
  onDone,
}: {
  member: Member;
  isOwner: boolean;
  isMe: boolean;
  branches: Location[];
  onChooseBranches: () => void;
  onDone: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : t`That did not work.`);

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
          {isMe && <em><Trans>you</Trans></em>}
        </strong>
        <span title={ROLE_MEANS[member.role as 'OWNER' | StaffRole]}>
          {ROLE_SHORT[member.role as 'OWNER' | StaffRole]}
        </span>
        <BranchChips value={member} branches={branches} />
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
      </div>

      <div className="st-actions">
        {editable ? (
          <div className="st-mini-choice" role="radiogroup" aria-label={t`Role of ${member.email}`}>
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
            className="st-where"
            onClick={onChooseBranches}
            aria-label={t`Where ${member.email} works`}
            title={t`Where they work`}
          >
            <Icon name="pin" size={16} />
            <span><Trans>Branches</Trans></span>
          </button>
        )}

        {editable && (
          <button
            type="button"
            className="st-remove"
            disabled={remove.isPending}
            aria-label={t`Remove ${member.email}`}
            title={t`Remove`}
            onClick={async () => {
              if (
                await confirmDialog({
                  title: t`Remove ${member.email}?`,
                  body: (
                    <p>
                      <Trans>
                        They lose access straight away. Their name stays on anything they already did, and you
                        can invite them again later.
                      </Trans>
                    </p>
                  ),
                  tone: 'danger',
                  icon: 'userX',
                  confirmLabel: t`Remove`,
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
      {revoke.isPending ? t`Cancelling…` : t`Cancel invitation`}
    </button>
  );
}
