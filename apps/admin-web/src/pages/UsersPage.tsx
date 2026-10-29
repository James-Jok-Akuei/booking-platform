import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  clearDisplayName,
  inviteAdmin,
  listAdminInvitations,
  listUsers,
  markTestCustomer,
  resetTwoStep,
  revokeAdminAccess,
  revokeAdminInvitation,
  type DirectoryUser,
} from '../api/admin';
import { ago } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { ShopMark } from '../ui/ShopMark';
import { Switch } from '../ui/Switch';
import { markedWords } from '../lib/statsWords';
import { PersonActPanel, PersonSupportSection, type PersonAct } from './PersonSupport';
import './users.css';
import { WriteFirst } from '../components/WriteFirst';
import { EmptyState } from '../ui/EmptyState';

type Role = 'ALL' | 'CUSTOMER' | 'BUSINESS' | 'ADMIN';

const TABS: Array<{ value: Role; label: string; icon: IconName }> = [
  { value: 'ALL', label: 'Everyone', icon: 'users' },
  { value: 'CUSTOMER', label: 'Customers', icon: 'user' },
  { value: 'BUSINESS', label: 'Shop accounts', icon: 'store' },
  { value: 'ADMIN', label: 'Administrators', icon: 'shield' },
];

const ROLE_WORD: Record<DirectoryUser['role'], string> = {
  CUSTOMER: 'Customer',
  BUSINESS: 'Shop account',
  ADMIN: 'Administrator',
};

const MEMBER_WORD: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', STAFF: 'Staff' };

const PAGE = 30;

const joined = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Everyone with an account (§250, §94, §99).
 *
 * The console reaches a person three ways — by what they booked, what they
 * wrote, or what they asked — and this is the fourth: the person. Each row
 * says who they are (their photo or initials, the name they chose, their
 * email), what kind of account it is, where they work if they run a shop or
 * the area they call home if they book, how much they have done, and when
 * their app last came back. Opening one shows the same at full size with a
 * way into each of their bookings, reviews and tickets.
 *
 * Two decisions live here. Clearing a name a customer chose — there is
 * deliberately no edit: replacing a name with wording an administrator
 * preferred would publish words under their byline they never wrote. And,
 * for the primary administrator only, who else is one: invitations under the
 * Administrators tab, and removing access from a person's panel.
 */
export function UsersPage() {
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const role = (params.get('role')?.toUpperCase() as Role | undefined) ?? 'ALL';
  const named = params.get('named') === '1';
  const openId = params.get('open');
  const q = params.get('q') ?? '';
  const [typed, setTyped] = useState(q);

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (was) => {
        const out = new URLSearchParams(was);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === '') out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) patch({ q: typed.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const filters = (r: Role) => ({
    ...(r !== 'ALL' ? { role: r } : {}),
    ...(q ? { search: q } : {}),
    ...(named ? { withDisplayName: 'true' } : {}),
  });

  const list = useInfiniteQuery({
    queryKey: ['users', role, q, named],
    queryFn: ({ pageParam }) => listUsers({ ...filters(role), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.users.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.users) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ['users', 'count', t.value, q, named],
      queryFn: () => listUsers({ ...filters(t.value), limit: 1 }),
      select: (page: { total: number }) => page.total,
    })),
  });

  // Only the primary administrator may list invitations; a 403 is the answer
  // to "may I manage administrators?" and cannot disagree with the server.
  const invites = useQuery({ queryKey: ['admin-invitations'], queryFn: listAdminInvitations, retry: false });
  const canManage = invites.isSuccess;

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [list]);

  const open = rows.find((u) => u.id === openId) ?? null;

  return (
    <section className="us">
      <div className="page-top us-top">
        <header className="page-head">
          <div>
            <h1>Users</h1>
            <p className="muted">Everyone with an account: the people who book, the people who run shops, and administrators.</p>
          </div>
        </header>

        <div className="us-card-top pin-from">
          <div className="us-toolbar">
            <label className="us-search">
              <Icon name="search" size={18} />
              <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="An email or a name" aria-label="Find a person" />
              {typed && (
                <button type="button" className="us-search-clear" onClick={() => setTyped('')} aria-label="Clear">
                  <Icon name="close" size={14} stroke={2.2} />
                </button>
              )}
            </label>
            <button
              type="button"
              className={`us-chip${named ? ' is-on' : ''}`}
              aria-pressed={named}
              onClick={() => patch({ named: named ? null : '1' })}
              title="Only people who chose a name — the names shown on reviews, which can be cleared"
              aria-label="Only people who chose a name"
            >
              <Icon name={named ? 'check' : 'pencil'} size={14} />
              <span className="us-chip-text">Has a chosen name</span>
            </button>
          </div>
          <div className="us-tabs pin-phone" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={role === t.value}
                className={`us-tab${role === t.value ? ' is-on' : ''}`}
                onClick={() => patch({ role: t.value === 'ALL' ? null : t.value.toLowerCase() })}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
                {counts[i]?.data !== undefined && <span className="us-tab-count">{counts[i].data!.toLocaleString()}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`us-board${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
        {role === 'ADMIN' && <Invitations canManage={canManage} invites={invites.data ?? []} />}

        {list.isLoading && (
          <div className="us-skeletons" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="us-skel">
                <i />
                <div>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        )}

        {list.data && rows.length === 0 && (
          <EmptyState
            size="card"
            className="is-list"
            art={q ? 'search' : 'people'}
            title={q ? `Nobody matches “${q}”` : 'Nobody here yet'}
            text={q ? 'Try part of their email, or the name they chose.' : 'Accounts appear here as people sign up.'}
          />
        )}

        <ul className="us-list">
          {rows.map((u, i) => (
            <li key={u.id} style={{ animationDelay: `${Math.min(i % PAGE, 8) * 25}ms` }}>
              <Row u={u} me={me?.id} picked={u.id === openId} onOpen={() => patch({ open: u.id })} />
            </li>
          ))}
        </ul>

        <div ref={end} />
        {rows.length > 0 && (
          <footer className="us-foot">
            <span>
              Showing <strong>{rows.length.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong>
            </span>
            {list.hasNextPage && (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            )}
          </footer>
        )}
      </div>

      {open && <Person key={open.id} u={open} me={me?.id} canManage={canManage} onClose={() => patch({ open: null })} />}
    </section>
  );
}

function Row({ u, me, picked, onOpen }: { u: DirectoryUser; me?: string; picked: boolean; onOpen: () => void }) {
  const closed = Boolean(u.closedAt);
  return (
    <button type="button" className={`us-row is-${u.role.toLowerCase()}${picked ? ' is-picked' : ''}${closed ? ' is-closed' : ''}`} onClick={onOpen}>
      <Avatar label={u.displayName || u.email} src={u.imageUrl} size={42} />
      <span className="us-who">
        <strong>
          <span>{u.displayName ?? u.email}</span>
          {u.id === me && <em className="us-you">You</em>}
        </strong>
        <span>{u.displayName ? u.email : 'No name chosen'}</span>
      </span>

      <span className="us-kind">
        <span className={`us-role is-${u.role.toLowerCase()}`}>
          {u.role === 'ADMIN' && <Icon name="shield" size={12} />}
          {u.isPrimaryAdmin ? 'Primary administrator' : ROLE_WORD[u.role]}
        </span>
        {closed && <span className="us-closed">Closed {u.closedAt && ago(u.closedAt)}</span>}
      </span>

      <span className="us-where">
        {u.businesses.length > 0 ? (
          <>
            <ShopMark name={u.businesses[0].name} logoUrl={u.businesses[0].logoUrl} size={22} />
            <span>
              <b>{u.businesses[0].name ?? 'Unnamed shop'}</b>
              <em>
                {MEMBER_WORD[u.businesses[0].role] ?? u.businesses[0].role}
                {u.businesses.length > 1 && ` · +${u.businesses.length - 1} more`}
              </em>
            </span>
          </>
        ) : u.homeArea ? (
          <>
            <span className="us-pin">
              <Icon name="pin" size={13} />
            </span>
            <span>
              <b>{u.homeArea}</b>
              <em>Home</em>
            </span>
          </>
        ) : (
          <span className="us-none">—</span>
        )}
      </span>

      <span className="us-did">
        <span title="Bookings">
          <Icon name="calendar" size={13} /> {u.appointmentCount}
        </span>
        <span title="Reviews">
          <Icon name="star" size={13} /> {u.reviewCount}
        </span>
        <span title="Support tickets">
          <Icon name="help" size={13} /> {u.ticketCount}
        </span>
      </span>

      <span className="us-when">
        <b>{u.lastSeenAt ? `Seen ${ago(u.lastSeenAt)}` : 'Never signed in'}</b>
        <em>Joined {joined(u.createdAt)}</em>
      </span>
      <Icon name="chevronRight" size={16} className="us-chev" />
    </button>
  );
}

/** Administrators-to-be (§99): who has been asked and has not joined, and asking someone new. */
function Invitations({ canManage, invites }: { canManage: boolean; invites: Array<{ id: string; email: string; expiresAt: string; createdAt: string; invitedBy: { email: string } }> }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
  };
  const invite = useMutation({
    mutationFn: () => inviteAdmin(email.trim()),
    onSuccess: () => {
      setEmail('');
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: revokeAdminInvitation, onSuccess: refresh });

  if (!canManage) {
    return (
      <div className="us-invites is-readonly">
        <Icon name="lock" size={16} />
        <span>Only the primary administrator can invite administrators or remove one.</span>
      </div>
    );
  }

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) invite.mutate();
  };

  return (
    <div className="us-invites">
      <form className="us-invite" onSubmit={send}>
        <span className="us-invite-icon">
          <Icon name="mail" size={18} />
        </span>
        <div>
          <strong>Invite an administrator</strong>
          <span>They get an email with a link to sign in. The address must not have an account of any kind yet.</span>
        </div>
        <div className="us-invite-row">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="their@email.com" aria-label="Their email" />
          <button type="submit" className="primary" disabled={invite.isPending || !email.trim()}>
            <Icon name="send" size={15} /> {invite.isPending ? 'Sending…' : 'Send the invitation'}
          </button>
        </div>
        {invite.error && (
          <p className="error small" role="alert">
            {invite.error instanceof ApiError ? invite.error.message : 'That did not send.'}
          </p>
        )}
      </form>

      {invites.length > 0 && (
        <ul className="us-pending">
          {invites.map((inv) => {
            const expired = new Date(inv.expiresAt).getTime() < Date.now();
            return (
              <li key={inv.id}>
                <Avatar label={inv.email} size={34} />
                <span className="us-who">
                  <strong>{inv.email}</strong>
                  <span>
                    Invited {ago(inv.createdAt)} by {inv.invitedBy.email} · {expired ? 'the link has expired' : `the link works until ${joined(inv.expiresAt)}`}
                  </span>
                </span>
                <span className={`us-wait${expired ? ' is-expired' : ''}`}>{expired ? 'Expired' : 'Not joined yet'}</span>
                <button
                  type="button"
                  className="us-act"
                  disabled={revoke.isPending}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Cancel this invitation?',
                      body: (
                        <p>
                          The link sent to <strong>{inv.email}</strong> stops working. You can invite them again later.
                        </p>
                      ),
                      tone: 'warn',
                      icon: 'mail',
                      confirmLabel: 'Cancel the invitation',
                      cancelLabel: 'Keep it',
                    });
                    if (ok) revoke.mutate(inv.id);
                  }}
                >
                  Cancel
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One person, at full size: who they are, what they have done, and the decisions about them. */
function Person({ u, me, canManage, onClose }: { u: DirectoryUser; me?: string; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['users'] });
  const clear = useMutation({ mutationFn: (reason: string) => clearDisplayName(u.id, reason), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: () => revokeAdminAccess(u.id), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => resetTwoStep(u.id), onSuccess: refresh });
  // Whether the statistics count them (§316).
  const test = useMutation({
    mutationFn: (isTest: boolean) => markTestCustomer(u.id, isTest),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['statistics'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });
  const error = clear.error ?? revoke.error ?? reset.error ?? test.error;
  const flipTest = async (isTest: boolean) => {
    if (
      isTest &&
      !(await confirmDialog({
        title: 'Leave them out of the statistics?',
        body: (
          <p>
            <strong>{u.email}</strong> and their bookings stop counting in every number on the statistics page and the Overview. Nothing else
            changes for them. You can count them again at any time.
          </p>
        ),
        tone: 'warn',
        icon: 'chart',
        confirmLabel: 'Mark as a test account',
        cancelLabel: 'Keep counting them',
      }))
    )
      return;
    test.mutate(isTest);
  };
  const self = u.id === me;
  const [act, setAct] = useState<PersonAct | null>(null);

  const onClear = async () => {
    const reason = await promptDialog({
      title: 'Clear this display name?',
      body: (
        <p>
          “<strong>{u.displayName}</strong>” from {u.email}. Their reviews show as “Anonymous” instead, and they can choose a new name. They are
          told this happened, and why.
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
    if (reason !== null) clear.mutate(reason.trim());
  };

  const onRevoke = async () => {
    const ok = await confirmDialog({
      title: 'Remove administrator access?',
      body: (
        <p>
          <strong>{u.email}</strong> loses it at once, even if signed in now. The account becomes an ordinary customer account — nothing they did
          is deleted, and anything they handled still names them.
        </p>
      ),
      tone: 'danger',
      icon: 'userX',
      confirmLabel: 'Remove access',
      cancelLabel: 'Keep them',
    });
    if (ok) revoke.mutate();
  };

  const linkFor = (to: string) => ({ to, onClick: onClose });

  if (act) return <PersonActPanel user={u} act={act} onBack={() => setAct(null)} onClose={onClose} />;

  return (
    <Panel eyebrow={u.isPrimaryAdmin ? 'Primary administrator' : ROLE_WORD[u.role]} title={u.displayName ?? u.email} onClose={onClose} width={640}>
      <div className="up-hero">
        <Avatar label={u.displayName || u.email} src={u.imageUrl} size={72} />
        <div>
          <strong>{u.displayName ?? <span className="us-noname">No name chosen</span>}</strong>
          <a href={`mailto:${u.email}`}>{u.email}</a>
          <span>
            Joined {joined(u.createdAt)} · {u.lastSeenAt ? `last seen ${ago(u.lastSeenAt)}` : 'never signed in'}
            {u.homeArea && ` · lives around ${u.homeArea}`}
          </span>
        </div>
      </div>

      {u.closedAt && (
        <div className="up-banner">
          <Icon name="lock" size={17} />
          <span>
            <strong>They closed their account {ago(u.closedAt)}.</strong> What they did is kept — bookings are financial records — but they can no
            longer sign in.
          </span>
        </div>
      )}

      <div className="up-tiles">
        <Link className="up-tile" {...linkFor(`/appointments?q=${encodeURIComponent(u.email)}`)}>
          <Icon name="calendar" size={18} />
          <strong>{u.appointmentCount}</strong>
          <span>{u.appointmentCount === 1 ? 'booking' : 'bookings'}</span>
        </Link>
        <Link className="up-tile" {...linkFor(`/reviews?show=all&q=${encodeURIComponent(u.email)}`)}>
          <Icon name="star" size={18} />
          <strong>{u.reviewCount}</strong>
          <span>{u.reviewCount === 1 ? 'review' : 'reviews'}</span>
        </Link>
        <Link className="up-tile" {...linkFor(`/tickets?status=ALL&q=${encodeURIComponent(u.email)}`)}>
          <Icon name="help" size={18} />
          <strong>{u.ticketCount}</strong>
          <span>{u.ticketCount === 1 ? 'ticket' : 'tickets'}</span>
        </Link>
      </div>

      {/* Writing first (§287): a support conversation they can answer. */}
      {u.role !== 'ADMIN' && !u.closedAt && (
        <section className="up-section">
          <WriteFirst userId={u.id} who={u.displayName ?? 'them'} />
        </section>
      )}

      {u.businesses.length > 0 && (
        <section className="up-section">
          <h4>
            <Icon name="store" size={15} /> Where they work
          </h4>
          <ul className="up-shops">
            {u.businesses.map((b) => (
              <li key={b.id}>
                <Link {...linkFor(`/businesses?status=ALL&open=${b.id}`)}>
                  <ShopMark name={b.name} logoUrl={b.logoUrl} size={36} />
                  <span>
                    <strong>{b.name ?? 'Unnamed shop'}</strong>
                    <em>{MEMBER_WORD[b.role] ?? b.role}</em>
                  </span>
                  <Icon name="chevronRight" size={15} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Support acting for them (§297). */}
      {u.role !== 'ADMIN' && !u.closedAt && <PersonSupportSection userId={u.id} onAct={setAct} onClose={onClose} />}

      <section className="up-section">
        <h4>
          <Icon name="shield" size={15} /> Decisions
        </h4>
        <div className="up-decisions">
          {u.displayName ? (
            <div className="up-decision">
              <span>
                <strong>The name on their reviews</strong>
                <em>“{u.displayName}”. Clear it if it breaks the rules; there is no editing someone else’s name.</em>
              </span>
              <button type="button" disabled={clear.isPending} onClick={() => void onClear()}>
                <Icon name="xCircle" size={15} /> Clear the name
              </button>
            </div>
          ) : (
            <p className="up-quiet">They have not chosen a name, so their reviews show as “Anonymous”.</p>
          )}

          {u.role === 'CUSTOMER' && (
            <div className="up-decision">
              <span>
                <strong>{u.isTest ? 'A test account — left out' : 'Counted in the statistics'}</strong>
                <em>
                  {u.isTest
                    ? `Their bookings are left out of the statistics. ${markedWords(u.testMarkedBy, u.testMarkedAt)}`
                    : 'If it is ours or a demo, mark it as a test account: its bookings are then left out of the statistics, and nothing else changes.'}
                </em>
              </span>
              <Switch checked={u.isTest} disabled={test.isPending} onChange={(on) => void flipTest(on)} label="A test account, left out of the statistics" />
            </div>
          )}

          {u.role === 'ADMIN' && (
            <div className="up-decision">
              <span>
                <strong>Administrator access</strong>
                <em>
                  {self
                    ? 'This is you. Nobody can remove their own access.'
                    : u.isPrimaryAdmin
                      ? 'The primary administrator cannot be removed: there must always be one.'
                      : canManage
                        ? 'They can see and change everything in this console.'
                        : 'Only the primary administrator can remove an administrator.'}
                </em>
              </span>
              {canManage && !self && !u.isPrimaryAdmin && (
                <button type="button" className="danger" disabled={revoke.isPending} onClick={() => void onRevoke()}>
                  <Icon name="userX" size={15} /> Remove access
                </button>
              )}
            </div>
          )}

          {/* Two-step sign-in (§298): on or off, and turning it off for someone who lost their phone. */}
          {u.role === 'ADMIN' && (
            <div className="up-decision">
              <span>
                <strong>Two-step sign-in</strong>
                <em>
                  {u.twoStepOn
                    ? 'On — they sign in with the emailed code and their authenticator app.'
                    : 'Not set up yet. They are asked to set it up when they next open the console.'}
                </em>
              </span>
              {canManage && !self && u.twoStepOn && (
                <button
                  type="button"
                  disabled={reset.isPending}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Turn off their two-step sign-in?',
                      body: (
                        <p>
                          Only when <strong>{u.email}</strong> lost their phone and their recovery codes. They are signed out everywhere, and set
                          it up again on their next sign-in. You will be asked for a code first.
                        </p>
                      ),
                      tone: 'warn',
                      icon: 'shield',
                      confirmLabel: 'Turn it off',
                      cancelLabel: 'Leave it on',
                    });
                    if (ok) reset.mutate();
                  }}
                >
                  <Icon name="shield" size={15} /> Turn it off
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {error && (
        <p className="error" role="alert">
          {error instanceof ApiError ? error.message : 'That did not work.'}
        </p>
      )}
    </Panel>
  );
}
