import { Fragment, useEffect, useMemo, useState } from 'react';
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
  listLocations,
  markNoShow,
  type Appointment,
  type AppointmentStatus,
} from '../api/business';
import { bookingsBetween } from '../lib/bookings';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { MoreMenu, type MoreItem } from '../ui/MoreMenu';
import { Portal } from '../ui/Portal';
import { Select } from '../ui/Select';
import { Icon, type IconName } from '../ui/Icon';
import { addDays, clock, minutesBetween, relativeDay, sameDay, startOfDay, useNow } from '../lib/time';
import { STATUS, Thumb, dueAtShop, payment, reservationNo, standing, useServiceCovers, type Actions, type Money } from '../lib/bookingLook';
import { CalendarBody, CalendarHead, useCalendar } from './calendar/AppointmentCalendar';
import './appointments.css';

export { reservationNo };

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

const PAGE = 25;

const MODE_KEY = 'booking-business.appointments-view';
const readMode = (): 'list' | 'calendar' => {
  try {
    return localStorage.getItem(MODE_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Filters = { locationId?: string; q?: string };

/** Every booking of one status, a hundred at a time — the active tabs are short. */
async function allOf(status: AppointmentStatus, filters: Filters) {
  const rows: Appointment[] = [];
  let total = 0;
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await listAppointments({ status, limit: 100, offset, ...filters });
    total = page.total;
    rows.push(...page.appointments);
    if (rows.length >= page.total || page.appointments.length < 100) break;
  }
  return { appointments: rows, total };
}

/** A value that settles a moment after typing stops. */
function useSettled<T>(value: T, ms = 280) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The day's work (§70.2, §193, §213) — a work list, laid out as a table.
 *
 * Opens on **Expected**, the people who have not arrived. At the top, today
 * at a glance: who is still to come, who is with you, who is done, and the
 * money still to collect at the shop. Then the bookings as a table whose
 * columns never move — Time, Customer, Service, Payment, Status, Action —
 * with the headings pinned while the list scrolls under them, grouped by
 * day, with a "now" line through today.
 *
 * Every row carries its one next step as a button in the same place —
 * **Check in** (§191), **Mark done** — and the rest behind "⋯". Search
 * (email, service, branch or the reservation number the customer's app
 * shows) and the branch filter run on the server, so they reach every
 * booking, not just the ones loaded. What is shown can be downloaded.
 */
export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];
  // Changes some of the address's settings, keeping the rest.
  const patch = (next: Record<string, string | null>) =>
    setParams(
      (was) => {
        const out = new URLSearchParams(was);
        for (const [key, value] of Object.entries(next)) {
          if (value === null) out.delete(key);
          else out.set(key, value);
        }
        return out;
      },
      { replace: true },
    );
  // A list or a calendar (§229), remembered for next time.
  const [savedMode] = useState(readMode);
  const mode: 'list' | 'calendar' =
    params.get('view') === 'calendar' ? 'calendar' : params.get('view') === 'list' ? 'list' : savedMode;
  const setMode = (next: 'list' | 'calendar') => {
    patch({ view: next });
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private mode: it is remembered for this visit only.
    }
  };
  const setTab = (key: TabKey) => {
    patch({ tab: key === 'expected' ? null : key });
    if (mode === 'calendar') setMode('list');
  };
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const money = useMoney();
  const covers = useServiceCovers();
  const openCheckIn = useCheckIn();
  const now = useNow(30_000);

  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const canVerifyManually =
    me.data?.businessMembership?.role === 'OWNER' || me.data?.businessMembership?.role === 'MANAGER';
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const branches = (locations.data ?? []).filter((l) => l.isActive);

  const cal = useCalendar({ active: mode === 'calendar', params, patch, branch, branches, search: search.trim(), now });
  const q = useSettled(search.trim());
  const filters: Filters = { ...(branch ? { locationId: branch } : {}), ...(q ? { q } : {}) };
  const filterKey = [branch, q];

  // How many each tab holds, for the counts on the tabs — with the filters.
  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ['appointments', 'count', t.status, ...filterKey],
      queryFn: () =>
        listAppointments(t.status === 'ALL' ? { limit: 1, ...filters } : { status: t.status, limit: 1, ...filters }),
    })),
  });

  const active = ACTIVE.includes(tab.status);
  const waiting = useQuery({
    queryKey: ['appointments', 'list', tab.status, 'all', ...filterKey],
    queryFn: () => allOf(tab.status as AppointmentStatus, filters),
    enabled: active,
  });
  const history = useInfiniteQuery({
    queryKey: ['appointments', 'list', tab.status, 'paged', ...filterKey],
    queryFn: ({ pageParam }) =>
      listAppointments({
        ...(tab.status === 'ALL' ? {} : { status: tab.status }),
        ...filters,
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

  // Today, for the strip at the top — by branch, whatever is being searched.
  const today = startOfDay(now);
  const withYou = useQuery({
    queryKey: ['appointments', 'count', 'IN_PROGRESS', branch, ''],
    queryFn: () => listAppointments({ status: 'IN_PROGRESS', limit: 1, ...(branch ? { locationId: branch } : {}) }),
  });
  const todays = useQuery({
    queryKey: ['appointments', 'today', today.toISOString()],
    queryFn: () => bookingsBetween(today, addDays(today, 1)),
    refetchInterval: 60_000,
  });

  const rows = active
    ? waiting.data?.appointments ?? []
    : history.data?.pages.flatMap((p) => p.appointments) ?? [];
  const total = active ? waiting.data?.total ?? 0 : history.data?.pages[0]?.total ?? 0;
  const loading = active ? waiting.isLoading : history.isLoading;
  const searching = Boolean(q) || Boolean(branch);

  const shown = useMemo(() => {
    const t = (a: Appointment) => new Date(a.startTime).getTime();
    return [...rows].sort((x, y) => (active ? t(x) - t(y) : t(y) - t(x)));
  }, [rows, active]);

  const groups = useMemo(() => {
    const start = startOfDay();
    const out: Array<{ key: string; title: string; overdue: boolean; today: boolean; rows: Appointment[] }> = [];
    for (const a of shown) {
      const begins = new Date(a.startTime);
      const overdue = a.status === 'BOOKED' && begins < start;
      const key = overdue ? 'overdue' : startOfDay(begins).toISOString();
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          title: overdue ? 'Earlier — not checked in' : relativeDay(begins),
          overdue,
          today: !overdue && sameDay(begins, new Date()),
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

  const actions: Actions = {
    checkIn: (a) => openCheckIn(a),
    noCode: (a) => openCheckIn(a, { manual: true }),
    complete: (a) => act.mutate({ id: a.id, action: 'complete' }),
    noShow: askNoShow,
    cancel: askCancel,
    open: (a) => setDetail(a.id),
  };

  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        `appointments-${tab.key}-${new Date().toISOString().slice(0, 10)}.csv`,
        tab.status,
        filters,
        money.toMajor,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="ap">
      <div className="page-top ap-top">
        <header className="page-head ap-head">
          <div>
            <h1>Appointments</h1>
            <p className="muted">Who is coming, checking them in, and what they still owe you.</p>
          </div>
        </header>

        <TodayStrip
          rows={(todays.data ?? []).filter((a) => !branch || a.location.id === branch)}
          withYou={withYou.data?.total}
          loading={todays.isLoading}
          now={now}
          money={money.format}
          onTab={setTab}
        />

        <div className={`ap-card-top${mode === 'calendar' ? ' is-cal' : ' pin-from'}`}>
          <div className="ap-toolbar">
            <div className="ap-mode" role="tablist" aria-label="Show as">
              <button type="button" role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'is-on' : ''} onClick={() => setMode('list')} title="As a list">
                <Icon name="list" size={16} />
                <span>List</span>
              </button>
              <button type="button" role="tab" aria-selected={mode === 'calendar'} className={mode === 'calendar' ? 'is-on' : ''} onClick={() => setMode('calendar')} title="On a calendar">
                <Icon name="calendar" size={16} />
                <span>Calendar</span>
              </button>
            </div>
            <div className="ap-find">
              <label className="ap-search">
                <Icon name="search" size={18} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={mode === 'calendar' ? 'Find on the calendar' : 'Email, service, branch or No.'}
                  aria-label="Find a booking"
                />
                {search && (
                  <button type="button" className="ap-search-clear" onClick={() => setSearch('')} aria-label="Clear">
                    <Icon name="close" size={14} stroke={2.2} />
                  </button>
                )}
              </label>
              {branches.length > 1 && (
                <div className={`ap-branch${branch ? ' is-on' : ''}`}>
                  <Icon name="pin" size={16} />
                  <Select
                    variant="bare"
                    value={branch}
                    onChange={setBranch}
                    label="Branch"
                    options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                  />
                </div>
              )}
            </div>
            {mode === 'list' && (
            <button
              type="button"
              className="ap-export"
              onClick={download}
              disabled={shown.length === 0 || exporting}
              title={`Download all ${total} bookings in this list, for a spreadsheet`}
            >
              <Icon name={exporting ? 'refresh' : 'upload'} size={15} className={exporting ? 'ap-export-spin' : 'ap-export-icon'} />
              <span>{exporting ? 'Exporting…' : 'Export'}</span>
            </button>
            )}
          </div>
          {mode === 'list' && (
          <>
          <div className="ap-tabs-row pin-phone">
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
                    <Icon name={t.icon} size={16} />
                    {t.label}
                    {count !== undefined && <span className="ap-tab-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="ap-cols" aria-hidden="true">
            <span>Time</span>
            <span className="col-customer">Customer</span>
            <span className="col-service">Service</span>
            <span className="col-booking">Booking</span>
            <span>Payment</span>
            <span>Status</span>
            <span className="col-action">Action</span>
          </div>
          </>
          )}
        </div>
        {mode === 'calendar' && (
          <div className="acal-head-card pin-from">
            <CalendarHead cal={cal} />
          </div>
        )}
      </div>

      {act.error && (
        <p className="notice ap-notice" role="alert">
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}

      {mode === 'calendar' ? (
        <div className="ap-board is-cal">
          <CalendarBody cal={cal} actions={actions} covers={covers} money={money.format} />
        </div>
      ) : (
      <div className="ap-board">
        {loading && (
          <div className="ap-skeletons" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="ap-skel-row">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        )}

        {!loading && shown.length === 0 && <EmptyTab tab={tab.key} searching={searching} />}

        {groups.map((group) => {
          // Where "now" falls in today's list.
          const nowAt = group.today && active ? group.rows.findIndex((a) => new Date(a.startTime) > now) : -2;
          return (
            <section key={group.key} className={`ap-group${group.overdue ? ' is-overdue' : ''}`}>
              <h2 className="ap-group-title">
                {group.overdue ? <Icon name="alert" size={15} /> : <Icon name="calendar" size={15} />}
                {group.title}
                <span>{group.rows.length}</span>
              </h2>
              {group.rows.map((a, i) => (
                <Fragment key={a.id}>
                  {i === nowAt && <NowLine now={now} />}
                  <Row
                    appointment={a}
                    cover={covers.get(a.service.id) ?? null}
                    money={money.format}
                    now={now}
                    picked={detail === a.id}
                    busy={act.isPending && act.variables?.id === a.id}
                    canVerifyManually={canVerifyManually}
                    actions={actions}
                  />
                </Fragment>
              ))}
              {nowAt === -1 && <NowLine now={now} />}
            </section>
          );
        })}

        {!loading && shown.length > 0 && (
          <footer className="ap-foot">
            <span>
              Showing <strong>{rows.length}</strong> of <strong>{total}</strong>
              {searching ? ' that match' : ''}
            </span>
            {!active && history.hasNextPage && (
              <button type="button" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
                {history.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            )}
          </footer>
        )}
      </div>
      )}

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

/** Today at a glance: still to come, with you, done, and the money still to collect. */
function TodayStrip({
  rows,
  withYou,
  loading,
  now,
  money,
  onTab,
}: {
  rows: Appointment[];
  withYou: number | undefined;
  loading: boolean;
  now: Date;
  money: Money;
  onTab: (key: TabKey) => void;
}) {
  const expected = rows.filter((a) => a.status === 'BOOKED').sort((a, b) => a.startTime.localeCompare(b.startTime));
  const late = expected.filter((a) => new Date(a.startTime) < now).length;
  const next = expected.find((a) => new Date(a.startTime) >= now);
  const done = rows.filter((a) => a.status === 'COMPLETED').length;
  const owing = rows.filter((a) => a.status === 'BOOKED' || a.status === 'IN_PROGRESS');
  const toCollect = owing.reduce((sum, a) => sum + (dueAtShop(a) ?? 0), 0);
  const currency = rows[0]?.currency;

  const tiles: Array<{ key: string; icon: IconName; tone: string; label: string; value: string; note: string; to?: TabKey }> = [
    {
      key: 'expected',
      icon: 'calendarCheck',
      tone: 'accent',
      label: 'To come today',
      value: String(expected.length),
      note: late ? `${late} running late` : next ? `Next at ${clock(next.startTime)}` : 'Nobody else today',
      to: 'expected',
    },
    {
      key: 'with',
      icon: 'timer',
      tone: 'warn',
      label: 'With you now',
      value: withYou === undefined ? '–' : String(withYou),
      note: withYou ? 'Mark done when finished' : 'Nobody checked in',
      to: 'in-progress',
    },
    {
      key: 'done',
      icon: 'checkCircle',
      tone: 'ok',
      label: 'Done today',
      value: String(done),
      note: done === 1 ? '1 customer served' : done ? `${done} customers served` : 'None yet',
      to: 'done',
    },
    {
      key: 'collect',
      icon: 'banknote',
      tone: 'night',
      label: 'To collect today',
      value: money(toCollect, currency),
      note: owing.length ? `from ${owing.length} ${owing.length === 1 ? 'customer' : 'customers'}` : 'Nothing left to collect',
    },
  ];

  return (
    <div className="ap-today" aria-label="Today">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="ap-today-icon">
              <Icon name={t.icon} size={18} />
            </span>
            <span className="ap-today-text">
              <em>{t.label}</em>
              <strong>{loading ? '–' : t.value}</strong>
              <small>{loading ? ' ' : t.note}</small>
            </span>
          </>
        );
        return t.to ? (
          <button key={t.key} type="button" className={`ap-today-tile tone-${t.tone}`} onClick={() => onTab(t.to!)}>
            {body}
          </button>
        ) : (
          <div key={t.key} className={`ap-today-tile tone-${t.tone}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  return (
    <div className="ap-now" aria-label={`Now, ${clock(now)}`}>
      <span>Now · {clock(now)}</span>
      <i />
    </div>
  );
}

function Row({
  appointment: a,
  cover,
  money,
  now,
  picked,
  busy,
  canVerifyManually,
  actions,
}: {
  appointment: Appointment;
  cover: string | null;
  money: Money;
  now: Date;
  picked: boolean;
  busy: boolean;
  canVerifyManually: boolean;
  actions: Actions;
}) {
  const look = STATUS[a.status];
  const pay = payment(a, money);
  const stand = standing(a, now);
  const number = reservationNo(a.id);
  const late = a.status === 'BOOKED' && stand.tone === 'late';
  const [copied, setCopied] = useState(false);

  const menu: MoreItem[] = [
    { label: 'Open details', icon: 'eye', onClick: () => actions.open(a) },
    {
      label: copied ? 'Copied' : `Copy No. ${number}`,
      icon: copied ? 'check' : 'copy',
      onClick: () => {
        navigator.clipboard?.writeText(number);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
    },
    ...(a.status === 'BOOKED'
      ? [
          ...(canVerifyManually ? [{ label: 'Check in without a code', icon: 'key' as const, onClick: () => actions.noCode(a) }] : []),
          { label: 'Mark as no-show', icon: 'userX' as const, onClick: () => actions.noShow(a) },
          { label: 'Cancel booking', icon: 'calendarX' as const, onClick: () => actions.cancel(a), danger: true },
        ]
      : []),
  ];

  return (
    <article
      className={`ap-row is-${look.cls}${late ? ' is-late' : ''}${picked ? ' is-picked' : ''}`}
      onClick={() => actions.open(a)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) actions.open(a);
      }}
      tabIndex={0}
      aria-label={`${a.customer.email}, ${a.service.name} at ${clock(a.startTime)}, ${look.label}. Open details.`}
    >
      <div className="ap-time">
        <strong>{clock(a.startTime)}</strong>
        <span>{minutesBetween(a.startTime, a.endTime)} min</span>
      </div>

      <div className="ap-customer">
        <Avatar label={a.customer.email} size={36} />
        <div className="ap-two">
          <strong title={a.customer.email}>{a.customer.email}</strong>
          <span className="ap-no" title="Booking number — the customer sees the same one in their app">
            No. {number}
          </span>
        </div>
      </div>

      <div className="ap-service">
        <Thumb cover={cover} size={44} />
        <div className="ap-two">
          <strong title={a.service.name}>
            {a.service.name}
            {a.quantity > 1 && <em className="ap-qty">×{a.quantity}</em>}
          </strong>
          <span className="sub-branch">
            <Icon name="pin" size={12} /> {a.location.name}
          </span>
          <span className="sub-customer" title={a.customer.email}>
            {a.customer.email} · {a.location.name}
          </span>
        </div>
      </div>

      <div className="ap-pay">
        <strong>
          {pay.amount}
          {pay.unit && <small> {pay.unit}</small>}
        </strong>
        <span className={`tone-${pay.tone}`}>
          <Icon name={pay.icon} size={13} stroke={2.2} /> {pay.note}
        </span>
      </div>

      <div className="ap-state" title={a.cancellationReason ?? undefined}>
        <span className={`pill ${look.cls}`}>{look.label}</span>
        <span className={`ap-when tone-${stand.tone}`}>{stand.text}</span>
      </div>

      <div className="ap-act" onClick={(event) => event.stopPropagation()}>
        {a.status === 'BOOKED' && (
          <button type="button" className="primary ap-btn" disabled={busy} onClick={() => actions.checkIn(a)}>
            <Icon name="ticket" size={16} /> Check in
          </button>
        )}
        {a.status === 'IN_PROGRESS' && (
          <button type="button" className="dark ap-btn" disabled={busy} onClick={() => actions.complete(a)}>
            <Icon name="check" size={16} stroke={2.4} /> {busy ? 'Saving…' : 'Mark done'}
          </button>
        )}
        {a.status === 'PENDING_PAYMENT' && (
          <span className="ap-btn ap-btn-wait">
            <Icon name="hourglass" size={15} /> Waiting
          </span>
        )}
        {(a.status === 'COMPLETED' || a.status === 'CANCELLED' || a.status === 'NO_SHOW') && (
          <button type="button" className="ap-btn ap-btn-quiet" onClick={() => actions.open(a)}>
            View <Icon name="chevronRight" size={15} />
          </button>
        )}
        <MoreMenu items={menu} disabled={busy} label="More for this booking" />
      </div>
    </article>
  );
}

/** What the shop actually earned and paid on a booking — as its ledger records it (§25, §213). */
export function earned(a: Appointment) {
  const paid = Boolean(a.depositPaidAt);
  // A deposit never paid was never earned; one the shop cancelled was refunded in full, fee and all.
  const kept = paid && !(a.status === 'CANCELLED' && a.cancelledBy === 'BUSINESS');
  return { share: kept ? a.businessAmountMinor : 0, fee: kept ? a.platformFeeAmountMinor : 0, paid, refunded: paid && !kept };
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Every booking matching the tab, branch and search — not only the rows on
 * screen — as a spreadsheet (§213, §216). Dates are written YYYY-MM-DD and
 * amounts as plain numbers in major units, with the currency in its own
 * column, so a spreadsheet reads them as dates and numbers it can add up.
 * Your share and the platform fee are what was actually earned and charged:
 * nothing on a deposit never paid, nothing on one the shop refunded.
 */
async function downloadCsv(
  name: string,
  status: AppointmentStatus | 'ALL',
  filters: Filters,
  major: (minor: number) => string,
) {
  const rows: Appointment[] = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const page = await listAppointments({ ...(status === 'ALL' ? {} : { status }), ...filters, limit: 100, offset });
    rows.push(...page.appointments);
    if (rows.length >= page.total || page.appointments.length < 100) break;
  }
  rows.sort((x, y) => y.startTime.localeCompare(x.startTime));

  const head = [
    'Reservation no.',
    'Date',
    'Start',
    'End',
    'Customer',
    'Service',
    'People',
    'Branch',
    'Status',
    'Currency',
    'Full price',
    'Deposit',
    'Deposit paid on',
    'Deposit refunded',
    'Your share',
    'Platform fee',
    'Balance at the shop',
    'Cancelled by',
    'Reason',
  ];
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((a) => {
    const start = new Date(a.startTime);
    const money = earned(a);
    const due = dueAtShop(a);
    const open = a.status === 'BOOKED' || a.status === 'IN_PROGRESS';
    return [
      reservationNo(a.id),
      isoDay(start),
      hhmm(start),
      hhmm(new Date(a.endTime)),
      a.customer.email,
      a.service.name,
      a.quantity,
      a.location.name,
      STATUS[a.status].label,
      a.currency,
      a.servicePriceMinor === null ? '' : major(a.servicePriceMinor),
      major(a.depositAmountMinor),
      a.depositPaidAt ? `${isoDay(new Date(a.depositPaidAt))} ${hhmm(new Date(a.depositPaidAt))}` : 'Not paid',
      money.refunded ? 'Yes' : '',
      major(money.share),
      major(money.fee),
      // Only a booking still to happen has anything left to pay at the shop.
      open && due !== null ? major(due) : '',
      a.cancelledBy === 'BUSINESS' ? 'Shop' : a.cancelledBy === 'CUSTOMER' ? 'Customer' : a.cancelledBy ? 'Not paid in time' : '',
      a.cancellationReason ?? '',
    ]
      .map(cell)
      .join(',');
  });
  // A byte-order mark, so a spreadsheet opens it as UTF-8 (names, "—").
  const blob = new Blob(['\ufeff' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
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
    ? {
        icon: 'search' as const,
        title: 'Nothing matches',
        text: 'Try part of the email, the service, the branch — or the reservation number, like 3F2A-1C9B.',
      }
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
  const covers = useServiceCovers();
  const detail = useQuery({ queryKey: ['appointment', id], queryFn: () => getAppointment(id) });
  const d = detail.data;
  const [copied, setCopied] = useState(false);
  const [numberCopied, setNumberCopied] = useState(false);

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
    <Portal>
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

        {detail.isError ? (
          <div className="ap-empty">
            <span>
              <Icon name="alert" size={26} />
            </span>
            <strong>This booking could not be opened</strong>
            <p>{detail.error instanceof ApiError ? detail.error.message : 'Check your connection and try again.'}</p>
          </div>
        ) : !d ? (
          <div className="ap-skeletons ap-drawer-skel">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : (
          <>
            <div className="ap-drawer-who">
              <span className="ap-drawer-cover">
                <Thumb cover={covers.get(d.service.id) ?? null} size={72} />
                <Avatar label={d.customer.email} size={30} className="ap-drawer-avatar" />
              </span>
              <div>
                <h2>{d.customer.email}</h2>
                <div className="ap-drawer-tags">
                  <span className={`pill ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                  <button
                    type="button"
                    className="ap-no-chip"
                    title="The booking's number — the customer sees the same one in their app and on their receipt. Click to copy."
                    onClick={() => {
                      navigator.clipboard?.writeText(reservationNo(d.id));
                      setNumberCopied(true);
                      setTimeout(() => setNumberCopied(false), 1600);
                    }}
                  >
                    Booking no. {reservationNo(d.id)}
                    <Icon name={numberCopied ? 'check' : 'copy'} size={13} />
                  </button>
                </div>
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
                      <dt>
                        Mobile money reference
                        <span className="ap-dt-hint">The payment's own number at the mobile money operator — quote it if a customer says the money left their phone.</span>
                      </dt>
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
    </Portal>
  );
}
