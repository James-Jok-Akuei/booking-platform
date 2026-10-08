import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import { useCheckIn } from '../checkin/CheckIn';
import {
  getAppointment,
  cancelAppointment,
  completeAppointment,
  getMe,
  listAppointments,
  markNoShow,
  type Appointment,
  type AppointmentStatus,
} from '../api/business';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { MoreMenu } from '../ui/MoreMenu';
import { Icon, type IconName } from '../ui/Icon';
import { clock, minutesBetween, relativeDay, sameDay, span, startOfDay } from '../lib/time';
import './appointments.css';

type TabKey = 'expected' | 'in-progress' | 'awaiting-payment' | 'done' | 'all';

const TABS: Array<{ key: TabKey; status: AppointmentStatus | 'ALL'; label: string; icon: IconName }> = [
  { key: 'expected', status: 'BOOKED', label: 'Expected', icon: 'calendarCheck' },
  { key: 'in-progress', status: 'IN_PROGRESS', label: 'In progress', icon: 'timer' },
  { key: 'awaiting-payment', status: 'PENDING_PAYMENT', label: 'Awaiting payment', icon: 'hourglass' },
  { key: 'done', status: 'COMPLETED', label: 'Done', icon: 'checkCircle' },
  { key: 'all', status: 'ALL', label: 'All', icon: 'layers' },
];

/** The tabs where the next thing to do is still ahead: read soonest first. */
const ACTIVE: Array<AppointmentStatus | 'ALL'> = ['BOOKED', 'IN_PROGRESS', 'PENDING_PAYMENT'];

const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  BOOKED: { label: 'Expected', cls: 'booked' },
  IN_PROGRESS: { label: 'In progress', cls: 'in-progress' },
  COMPLETED: { label: 'Done', cls: 'completed' },
  NO_SHOW: { label: 'No-show', cls: 'no-show' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'pending-payment' },
};

const PAGE = 25;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Every booking of one status, a hundred at a time — the active tabs are short. */
async function allOf(status: AppointmentStatus) {
  const rows: Appointment[] = [];
  let total = 0;
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await listAppointments({ status, limit: 100, offset });
    total = page.total;
    rows.push(...page.appointments);
    if (rows.length >= page.total || page.appointments.length < 100) break;
  }
  return { appointments: rows, total };
}

/**
 * The day's work (§70.2, §193).
 *
 * Opens on **Expected** — the people who have not arrived — because that is
 * what someone opens this to deal with; each tab says how many it holds. The
 * waiting tabs (expected, in progress, awaiting payment) are read soonest
 * first and grouped by day; the history tabs newest first, a page at a time.
 *
 * Each customer carries the one next step as a button — **Check in** (§191),
 * **Mark done** — and the rarer ones (no code, no-show, cancel) behind "⋯".
 * Clicking a row opens everything about the booking, including the payment
 * trail a business needs when a customer disputes a charge (§96).
 */
export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];
  const setTab = (key: TabKey) => setParams(key === 'expected' ? {} : { tab: key }, { replace: true });
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const money = useMoney();
  const openCheckIn = useCheckIn();

  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const canVerifyManually =
    me.data?.businessMembership?.role === 'OWNER' || me.data?.businessMembership?.role === 'MANAGER';

  // How many each tab holds, for the counts on the tabs.
  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ['appointments', 'count', t.status],
      queryFn: () => listAppointments(t.status === 'ALL' ? { limit: 1 } : { status: t.status, limit: 1 }),
    })),
  });

  const active = ACTIVE.includes(tab.status);
  const waiting = useQuery({
    queryKey: ['appointments', 'list', tab.status, 'all'],
    queryFn: () => allOf(tab.status as AppointmentStatus),
    enabled: active,
  });
  const history = useInfiniteQuery({
    queryKey: ['appointments', 'list', tab.status, 'paged'],
    queryFn: ({ pageParam }) =>
      listAppointments({
        ...(tab.status === 'ALL' ? {} : { status: tab.status }),
        limit: PAGE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.appointments.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    enabled: !active,
  });

  const rows = active
    ? waiting.data?.appointments ?? []
    : history.data?.pages.flatMap((p) => p.appointments) ?? [];
  const total = active ? waiting.data?.total ?? 0 : history.data?.pages[0]?.total ?? 0;
  const loading = active ? waiting.isLoading : history.isLoading;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(
      (a) => !q || `${a.customer.email} ${a.service.name} ${a.location.name}`.toLowerCase().includes(q),
    );
    const t = (a: Appointment) => new Date(a.startTime).getTime();
    return [...filtered].sort((x, y) => (active ? t(x) - t(y) : t(y) - t(x)));
  }, [rows, search, active]);

  const groups = useMemo(() => {
    const today = startOfDay();
    const out: Array<{ key: string; title: string; overdue: boolean; rows: Appointment[] }> = [];
    for (const a of shown) {
      const start = new Date(a.startTime);
      const overdue = a.status === 'BOOKED' && start < today;
      const key = overdue ? 'overdue' : startOfDay(start).toISOString();
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          title: overdue ? 'Earlier — not checked in' : relativeDay(start),
          overdue,
          rows: [],
        };
        out.push(group);
      }
      group.rows.push(a);
    }
    return out;
  }, [shown]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['appointments'] });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'complete' | 'no-show' | 'cancel'; text?: string }) => {
      switch (input.action) {
        case 'complete':
          return completeAppointment(input.id);
        case 'no-show':
          return markNoShow(input.id);
        case 'cancel':
          return cancelAppointment(input.id, input.text!);
      }
    },
    onSuccess: refresh,
  });

  const askNoShow = async (a: Appointment) => {
    const ok = await confirmDialog({
      title: 'Mark as a no-show?',
      body: (
        <p>
          Use this when <strong>{a.customer.email}</strong> did not come for their{' '}
          {clock(a.startTime)} booking. Their deposit is not refunded — that is what it is for.
        </p>
      ),
      tone: 'danger',
      icon: 'userX',
      confirmLabel: 'Mark no-show',
      cancelLabel: 'Not yet',
    });
    if (ok) act.mutate({ id: a.id, action: 'no-show' });
  };

  const askCancel = async (a: Appointment) => {
    const reason = await promptDialog({
      title: 'Cancel this booking?',
      body: (
        <p>
          The customer is told this reason, and if they have paid a deposit it is refunded in full —
          including our fee.
        </p>
      ),
      label: 'Reason',
      placeholder: 'For example: the barber is ill today — we are sorry.',
      minLength: 3,
      tone: 'danger',
      icon: 'calendarX',
      confirmLabel: 'Cancel the booking',
      cancelLabel: 'Keep it',
    });
    if (reason) act.mutate({ id: a.id, action: 'cancel', text: reason });
  };

  const actions = {
    checkIn: (a: Appointment) => openCheckIn(a),
    noCode: (a: Appointment) => openCheckIn(a, { manual: true }),
    complete: (a: Appointment) => act.mutate({ id: a.id, action: 'complete' }),
    noShow: askNoShow,
    cancel: askCancel,
    open: (a: Appointment) => setDetail(a.id),
  };

  return (
    <section className="ap">
      <header className="page-head ap-head">
        <div>
          <h1>Appointments</h1>
          <p className="muted">Who is coming, and checking them in.</p>
        </div>
        <label className="ap-search">
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find by email, service or branch"
            aria-label="Find a booking"
          />
          {search && (
            <button type="button" className="ap-search-clear" onClick={() => setSearch('')} aria-label="Clear">
              <Icon name="close" size={14} stroke={2.2} />
            </button>
          )}
        </label>
      </header>

      <div className="ap-tabs" role="tablist">
        {TABS.map((t, i) => {
          const count = counts[i].data?.total;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === tab.key}
              className={`ap-tab${t.key === tab.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <Icon name={t.icon} size={17} />
              {t.label}
              {count !== undefined && <span className="ap-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {act.error && (
        <p className="notice" role="alert">
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}

      <div className="ap-board">
        <div className="ap-cols" aria-hidden="true">
          <span>When</span>
          <span>Customer</span>
          <span>Service</span>
          <span>You earn</span>
          <span>Status</span>
          <span />
        </div>

        {loading && (
          <div className="ap-skeletons">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        )}

        {!loading && shown.length === 0 && <EmptyTab tab={tab.key} searching={Boolean(search)} />}

        {groups.map((group) => (
          <section key={group.key} className={`ap-group${group.overdue ? ' is-overdue' : ''}`}>
            <h2 className="ap-group-title">
              {group.overdue && <Icon name="alert" size={15} />}
              {group.title}
              <span>{group.rows.length}</span>
            </h2>
            {group.rows.map((a) => (
              <Row
                key={a.id}
                appointment={a}
                money={money.format}
                busy={act.isPending && act.variables?.id === a.id}
                canVerifyManually={canVerifyManually}
                actions={actions}
              />
            ))}
          </section>
        ))}
      </div>

      <footer className="ap-foot">
        {!loading && (
          <span className="muted">
            {search ? `${shown.length} found in ` : ''}
            {rows.length} of {total}
          </span>
        )}
        {!active && history.hasNextPage && (
          <button type="button" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
            {history.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </footer>

      {detail && (
        <AppointmentDetail
          id={detail}
          onClose={() => setDetail(null)}
          canVerifyManually={canVerifyManually}
          actions={actions}
        />
      )}
    </section>
  );
}

type Actions = {
  checkIn: (a: Appointment) => void;
  noCode: (a: Appointment) => void;
  complete: (a: Appointment) => void;
  noShow: (a: Appointment) => void;
  cancel: (a: Appointment) => void;
  open: (a: Appointment) => void;
};

function Row({
  appointment: a,
  money,
  busy,
  canVerifyManually,
  actions,
}: {
  appointment: Appointment;
  money: (minor: number | null | undefined, code?: string | null) => string;
  busy: boolean;
  canVerifyManually: boolean;
  actions: Actions;
}) {
  const now = new Date();
  const look = STATUS[a.status];
  const late = a.status === 'BOOKED' && new Date(a.startTime) < now && sameDay(new Date(a.startTime), now);
  return (
    <article
      className={`ap-row is-${look.cls}`}
      onClick={() => actions.open(a)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) actions.open(a);
      }}
      tabIndex={0}
      aria-label={`${a.customer.email}, ${a.service.name} at ${clock(a.startTime)}. Open details.`}
    >
      <div className="ap-time">
        <strong>{clock(a.startTime)}</strong>
        <span>{minutesBetween(a.startTime, a.endTime)} min</span>
      </div>

      <div className="ap-who">
        <Avatar label={a.customer.email} size={40} />
        <div>
          <strong>{a.customer.email}</strong>
          {/* The deposit is the platform's evidence the customer is serious. */}
          {a.depositPaidAt ? (
            <span className="ap-paid">
              <Icon name="check" size={12} stroke={2.6} /> Deposit paid
            </span>
          ) : (
            <span className="muted">No deposit yet</span>
          )}
        </div>
      </div>

      <div className="ap-what">
        <strong>
          {a.service.name}
          {a.quantity > 1 && <em> · {a.quantity} people</em>}
        </strong>
        <span>{a.location.name}</span>
      </div>

      <div className="ap-earn">
        <strong>{money(a.businessAmountMinor, a.currency)}</strong>
        {/* The deposit share is NOT the price. The balance is settled directly
            with the customer and the platform never sees it (§29.2). */}
        {a.servicePriceMinor !== null && (
          <span>of {money(a.servicePriceMinor, a.currency)} — rest paid to you directly</span>
        )}
      </div>

      <div className="ap-status">
        <span className={`pill ${late ? 'late' : look.cls}`}>
          {late ? `${span((now.getTime() - new Date(a.startTime).getTime()) / 60_000)} late` : look.label}
        </span>
        {a.cancellationReason && <span className="ap-reason">{a.cancellationReason}</span>}
      </div>

      <div className="ap-actions" onClick={(event) => event.stopPropagation()}>
        {a.status === 'BOOKED' && (
          <>
            <button type="button" className="primary ap-btn" disabled={busy} onClick={() => actions.checkIn(a)}>
              <Icon name="ticket" size={16} /> Check in
            </button>
            <MoreMenu
              items={[
                ...(canVerifyManually
                  ? [{ label: 'No code?', icon: 'key' as const, onClick: () => actions.noCode(a) }]
                  : []),
                { label: 'No-show', icon: 'userX' as const, onClick: () => actions.noShow(a) },
                { label: 'Cancel', icon: 'calendarX' as const, onClick: () => actions.cancel(a), danger: true },
              ]}
              disabled={busy}
            />
          </>
        )}
        {a.status === 'IN_PROGRESS' && (
          <button type="button" className="dark ap-btn" disabled={busy} onClick={() => actions.complete(a)}>
            <Icon name="check" size={16} stroke={2.4} /> {busy ? 'Saving…' : 'Mark done'}
          </button>
        )}
        {a.status === 'PENDING_PAYMENT' && (
          <span className="ap-waiting">Waiting for the customer to pay</span>
        )}
        {a.status !== 'BOOKED' && a.status !== 'IN_PROGRESS' && a.status !== 'PENDING_PAYMENT' && (
          <span className="ap-open">
            Details <Icon name="chevronRight" size={16} />
          </span>
        )}
      </div>
    </article>
  );
}

function EmptyTab({ tab, searching }: { tab: TabKey; searching: boolean }) {
  const copy: Record<TabKey, { icon: IconName; title: string; text: string }> = {
    expected: {
      icon: 'calendarCheck',
      title: 'Nobody is expected',
      text: 'Customers appear here once they have booked and paid their deposit.',
    },
    'in-progress': {
      icon: 'timer',
      title: 'Nobody is with you',
      text: 'When you check a customer in, they wait here until you mark them done.',
    },
    'awaiting-payment': {
      icon: 'hourglass',
      title: 'Nothing waiting for payment',
      text: 'A booking sits here while the customer approves their deposit on their phone.',
    },
    done: { icon: 'checkCircle', title: 'Nothing finished yet', text: 'Bookings you mark done are kept here.' },
    all: { icon: 'layers', title: 'No bookings yet', text: 'Every booking, in every state, will be listed here.' },
  };
  const c = searching
    ? { icon: 'search' as const, title: 'Nothing matches', text: 'Try part of the email, the service or the branch.' }
    : copy[tab];
  return (
    <div className="ap-empty">
      <span>
        <Icon name={c.icon} size={28} />
      </span>
      <strong>{c.title}</strong>
      <p>{c.text}</p>
    </div>
  );
}

/**
 * Everything about one booking (§96): what was booked, the money, and the
 * payment trail — when the deposit landed, the operator's reference, the rate
 * used — which is what a business reaches for when a customer disputes a
 * charge. Its history is drawn as the steps the booking went through.
 */
function AppointmentDetail({
  id,
  onClose,
  canVerifyManually,
  actions,
}: {
  id: string;
  onClose: () => void;
  canVerifyManually: boolean;
  actions: Actions;
}) {
  const money = useMoney();
  const detail = useQuery({ queryKey: ['appointment', id], queryFn: () => getAppointment(id) });
  const d = detail.data;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps = d
    ? [
        { label: 'Booked', at: d.createdAt, tone: 'ok' },
        { label: d.depositPaidAt ? 'Deposit paid' : 'Deposit not paid', at: d.depositPaidAt, tone: d.depositPaidAt ? 'ok' : 'wait' },
        ...(d.verifiedAt ? [{ label: 'Customer arrived', at: d.verifiedAt, tone: 'ok' }] : []),
        ...(d.completedAt ? [{ label: 'Done', at: d.completedAt, tone: 'ok' }] : []),
        ...(d.noShowAt ? [{ label: 'Did not come', at: d.noShowAt, tone: 'bad' }] : []),
        ...(d.cancelledAt
          ? [
              {
                label: `Cancelled by ${String(d.cancelledBy).toLowerCase()}`,
                at: d.cancelledAt,
                tone: 'bad',
                note: d.cancellationReason,
              },
            ]
          : []),
        ...(d.status === 'BOOKED' ? [{ label: 'Waiting for them to arrive', at: null, tone: 'wait' }] : []),
        ...(d.status === 'IN_PROGRESS' ? [{ label: 'With you now', at: null, tone: 'wait' }] : []),
      ]
    : [];

  const due =
    d && d.servicePriceMinor !== null ? Math.max(0, d.servicePriceMinor - d.depositAmountMinor) : null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer ap-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Booking details"
      >
        <header className="ap-drawer-head">
          <p className="ap-drawer-eyebrow">Booking details</p>
          <button type="button" className="ap-drawer-close" onClick={onClose} aria-label="Close this panel">
            <Icon name="close" size={18} />
          </button>
        </header>

        {!d ? (
          <div className="ap-skeletons">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : (
          <>
            <div className="ap-drawer-who">
              <Avatar label={d.customer.email} size={58} />
              <div>
                <h2>{d.customer.email}</h2>
                <span className={`pill ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
              </div>
            </div>

            <div className="ap-drawer-hero">
              <div>
                <span>{relativeDay(d.startTime)}</span>
                <strong>
                  {clock(d.startTime)} – {clock(d.endTime)}
                </strong>
              </div>
              <div>
                <span>Service</span>
                <strong>
                  {d.service.name}
                  {d.quantity > 1 && ` · ${d.quantity} people`}
                </strong>
              </div>
              <div>
                <span>Branch</span>
                <strong>{d.location.name}</strong>
              </div>
            </div>

            <h3 className="ap-drawer-h">What happened</h3>
            <ol className="ap-steps">
              {steps.map((step, i) => (
                <li key={i} className={`is-${step.tone}`}>
                  <i aria-hidden="true" />
                  <div>
                    <strong>{step.label}</strong>
                    {step.at && <span>{when(step.at)}</span>}
                    {'note' in step && step.note && <span className="ap-step-note">{step.note}</span>}
                  </div>
                </li>
              ))}
            </ol>

            <h3 className="ap-drawer-h">Money</h3>
            <dl className="detail ap-money">
              <div>
                <dt>Deposit</dt>
                <dd>
                  {money.format(d.depositAmountMinor, d.currency)}
                  <span className={d.depositPaidAt ? 'ok' : 'muted'}>
                    {d.depositPaidAt ? ` · paid ${when(d.depositPaidAt)}` : ' · not paid'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Your share</dt>
                <dd>{money.format(d.businessAmountMinor, d.currency)}</dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>{money.format(d.platformFeeAmountMinor, d.currency)}</dd>
              </div>
              {d.servicePriceMinor !== null && (
                <div>
                  <dt>Full price</dt>
                  <dd>
                    {money.format(d.servicePriceMinor, d.currency)}
                    <div className="muted small">The rest is paid to you directly, not through us.</div>
                  </dd>
                </div>
              )}
              {due !== null && (d.status === 'BOOKED' || d.status === 'IN_PROGRESS') && (
                <div className="ap-due">
                  <dt>To pay you at the shop</dt>
                  <dd>{money.format(due, d.currency)}</dd>
                </div>
              )}
            </dl>

            {(d.paymentProviderReferenceId || (d.providerAmountMinor !== null && d.providerCurrency)) && (
              <>
                <h3 className="ap-drawer-h">Payment trail</h3>
                <dl className="detail">
                  {d.paymentProviderReferenceId && (
                    <div>
                      <dt>Operator reference</dt>
                      <dd className="ap-ref">
                        <code>{d.paymentProviderReferenceId}</code>
                        <button
                          type="button"
                          className="ap-copy"
                          onClick={() => {
                            navigator.clipboard?.writeText(d.paymentProviderReferenceId!);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                          }}
                          aria-label="Copy the reference"
                        >
                          <Icon name={copied ? 'check' : 'copy'} size={15} />
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </dd>
                    </div>
                  )}
                  {d.providerAmountMinor !== null && d.providerCurrency && (
                    <div>
                      <dt>Charged by the operator</dt>
                      <dd>
                        {d.providerCurrency} {d.providerAmountMinor}
                        {d.exchangeRateUsed && <div className="muted small">rate used {d.exchangeRateUsed}</div>}
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}

            {(d.status === 'BOOKED' || d.status === 'IN_PROGRESS') && (
              <div className="ap-drawer-actions">
                {d.status === 'BOOKED' && (
                  <>
                    <button type="button" className="danger" onClick={() => actions.cancel(d)}>
                      Cancel
                    </button>
                    <button type="button" onClick={() => actions.noShow(d)}>
                      No-show
                    </button>
                    {canVerifyManually && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          actions.noCode(d);
                        }}
                      >
                        No code?
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        onClose();
                        actions.checkIn(d);
                      }}
                    >
                      <Icon name="ticket" size={17} /> Check in
                    </button>
                  </>
                )}
                {d.status === 'IN_PROGRESS' && (
                  <button
                    type="button"
                    className="dark"
                    onClick={() => {
                      actions.complete(d);
                      onClose();
                    }}
                  >
                    <Icon name="check" size={17} stroke={2.4} /> Mark done
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
