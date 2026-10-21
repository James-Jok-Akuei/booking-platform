import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  listExceptions,
  listTimeBlocks,
  type Appointment,
  type AppointmentStatus,
  type Location,
  type ScheduleException,
  type TimeBlock,
} from '../../api/business';
import { bookingsBetween } from '../../lib/bookings';
import { STATUS, Thumb, payment, reservationNo, standing, type Actions, type Money } from '../../lib/bookingLook';
import { addDays, clock, sameDay, span, startOfDay } from '../../lib/time';
import { useMediaQuery } from '../../shell/useMediaQuery';
import { Icon, type IconName } from '../../ui/Icon';
import { Portal } from '../../ui/Portal';
import {
  HOLDS_A_PLACE,
  clusters,
  dateOf,
  freeWindows,
  fullness,
  hhmm,
  mergePlans,
  minuteOfDay,
  monthGridStart,
  peak,
  placesTaken,
  planFor,
  rangeOf,
  spanOf,
  weekStart,
  ymdOf,
  type CalView,
  type Cluster,
  type DayPlan,
  type Interval,
} from './model';
import './calendar.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale, dayName } from '../../i18n/format';

/*
 * The Appointments calendar (§229): the same bookings as the list, laid out
 * in time — a day, a week or a month — with the branch's open hours, closures
 * and breaks drawn in, its free time marked, and bookings that overlap drawn
 * as a pile that fans open on hover, each one opening its details.
 */

const STATUS_ORDER: AppointmentStatus[] = ['BOOKED', 'IN_PROGRESS', 'PENDING_PAYMENT', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
const SHOWN_KEY = 'booking-business.calendar-statuses';
const DEFAULT_SHOWN: AppointmentStatus[] = ['BOOKED', 'IN_PROGRESS', 'PENDING_PAYMENT', 'COMPLETED'];

const readShown = (): AppointmentStatus[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? 'null');
    return Array.isArray(saved) ? saved : DEFAULT_SHOWN;
  } catch {
    return DEFAULT_SHOWN;
  }
};

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

/** The page area's width, which decides how much of the calendar fits. */
function useContentWidth() {
  const [width, setWidth] = useState(() => document.querySelector('.content')?.clientWidth ?? 1000);
  useEffect(() => {
    const el = document.querySelector('.content');
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return width;
}

const matches = (a: Appointment, q: string) =>
  !q ||
  `${a.customer.email} ${a.service.name} ${a.location.name} ${reservationNo(a.id)}`.toLowerCase().includes(q.toLowerCase());

export type Column = {
  key: string;
  day: Date;
  /** One branch, or null when several are drawn as one. */
  location: Location | null;
  title: string;
  sub: string;
  plan: DayPlan;
  visible: Appointment[];
  used: Int16Array | null;
  free: Interval[];
  isToday: boolean;
};

/**
 * Everything the calendar's head and body share: which view, which day, which
 * statuses, the bookings and each branch's schedule for the time shown.
 */
export function useCalendar({
  active,
  params,
  patch,
  branch,
  branches,
  search,
  now,
}: {
  active: boolean;
  params: URLSearchParams;
  patch: (next: Record<string, string | null>) => void;
  branch: string;
  branches: Location[];
  search: string;
  now: Date;
}) {
  const width = useContentWidth();
  const narrow = width < 640;
  const wide = width >= 1150;

  const asked = (params.get('cal') as CalView | null) ?? (narrow ? 'day' : 'week');
  // A phone has no room for seven columns: its week is a strip of days over one.
  const view: CalView = narrow && asked === 'week' ? 'day' : asked;
  const anchor = params.get('date') ? dateOf(params.get('date')!) : startOfDay(now);
  const setView = (next: CalView) => patch({ cal: next });
  const setAnchor = (next: Date) => patch({ date: sameDay(next, now) ? null : ymdOf(next) });
  const go = (by: number) =>
    setAnchor(
      view === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() + by, 1)
        : addDays(anchor, view === 'week' ? 7 * by : by),
    );

  const [shown, setShownState] = useState<AppointmentStatus[]>(readShown);
  const setShown = (next: AppointmentStatus[]) => {
    setShownState(next);
    try {
      localStorage.setItem(SHOWN_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the choice lasts this visit.
    }
  };
  const toggle = (status: AppointmentStatus) =>
    setShown(shown.includes(status) ? shown.filter((s) => s !== status) : [...shown, status]);

  const range = rangeOf(view, anchor);
  const scope = branch ? branches.filter((b) => b.id === branch) : branches;

  const bookings = useQuery({
    queryKey: ['appointments', 'calendar', range.from.toISOString(), range.to.toISOString(), branch],
    queryFn: () => bookingsBetween(range.from, range.to, branch || undefined),
    enabled: active,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  // The same lists Closures & breaks reads (§207), so they are shared.
  const exceptions = useQueries({
    queries: scope.map((b) => ({
      queryKey: ['exceptions', b.id],
      queryFn: () => listExceptions(b.id),
      enabled: active,
      staleTime: 60_000,
    })),
  });
  const blocks = useQueries({
    queries: scope.map((b) => ({
      queryKey: ['time-blocks', b.id],
      queryFn: () => listTimeBlocks(b.id),
      enabled: active,
      staleTime: 60_000,
    })),
  });

  const exceptionsOf = useMemo(() => {
    const map = new Map<string, ScheduleException[]>();
    scope.forEach((b, i) => map.set(b.id, exceptions[i]?.data ?? []));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.map((b) => b.id).join(','), exceptions.map((e) => e.dataUpdatedAt).join(',')]);
  const blocksOf = useMemo(() => {
    const map = new Map<string, TimeBlock[]>();
    scope.forEach((b, i) => map.set(b.id, blocks[i]?.data ?? []));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.map((b) => b.id).join(','), blocks.map((e) => e.dataUpdatedAt).join(',')]);

  const plan = useCallback(
    (location: Location, day: Date) => planFor(location, day, exceptionsOf.get(location.id) ?? [], blocksOf.get(location.id) ?? []),
    [exceptionsOf, blocksOf],
  );

  const all = bookings.data ?? [];
  const nowMinuteKey = Math.floor(now.getTime() / 60_000);

  const columns: Column[] = useMemo(() => {
    const onDay = (day: Date, locations: Location[]) =>
      all.filter((a) => spanOf(a, day) !== null && locations.some((l) => l.id === a.location.id));
    const make = (day: Date, locations: Location[], title: string, sub: string): Column => {
      const location = locations.length === 1 ? locations[0] : null;
      const plans = locations.map((l) => plan(l, day));
      const merged = plans.length ? mergePlans(plans) : { open: [], breaks: [], closed: t`No branch`, special: null };
      const dayBookings = onDay(day, locations);
      const used = location ? placesTaken(dayBookings, day) : null;
      return {
        key: `${ymdOf(day)}:${location?.id ?? 'all'}`,
        day,
        location,
        title,
        sub,
        plan: merged,
        visible: dayBookings.filter((a) => shown.includes(a.status)),
        used,
        free: location && used ? freeWindows(merged, used, day, now) : [],
        isToday: sameDay(day, now),
      };
    };
    if (view === 'month') return [];
    if (view === 'day' && !branch && scope.length > 1 && !narrow) {
      // Each branch side by side, like a salon's chairs.
      return scope.map((b) => make(range.days[0], [b], b.name, ''));
    }
    return range.days.map((day) =>
      make(day, scope, day.toLocaleDateString(dateLocale(), { weekday: 'short' }), String(day.getDate())),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, branch, scope.length, narrow, range.from.getTime(), shown.join(','), plan, nowMinuteKey]);

  const counts = useMemo(() => {
    const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<AppointmentStatus, number>;
    for (const a of all) out[a.status] += 1;
    return out;
  }, [all]);

  const full = useMemo(
    () => fullness(scope, view === 'month' ? range.days.filter((d) => d.getMonth() === anchor.getMonth()) : range.days, plan, all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope.length, view, range.from.getTime(), plan, all],
  );

  return {
    view,
    setView,
    anchor,
    setAnchor,
    go,
    range,
    narrow,
    wide,
    shown,
    toggle,
    scope,
    branch,
    plan,
    all,
    loading: bookings.isLoading,
    refreshing: bookings.isFetching && !bookings.isLoading,
    columns,
    counts,
    full,
    search,
    now,
  };
}

export type CalendarState = ReturnType<typeof useCalendar>;

const rangeLabel = (cal: CalendarState) => {
  const { view, anchor, range, narrow } = cal;
  // A phone keeps it short, so the arrows, the date and the views share one row.
  const long = narrow ? 'short' : 'long';
  if (view === 'day') return anchor.toLocaleDateString(dateLocale(), { weekday: long, day: 'numeric', month: long });
  if (view === 'month') return anchor.toLocaleDateString(dateLocale(), { month: long, year: 'numeric' });
  const first = range.days[0];
  const last = range.days[6];
  const sameMonth = first.getMonth() === last.getMonth();
  return `${first.getDate()}${sameMonth ? '' : ` ${first.toLocaleDateString(dateLocale(), { month: 'short' })}`} – ${last.getDate()} ${last.toLocaleDateString(dateLocale(), { month: 'short', year: 'numeric' })}`;
};

// ---------------------------------------------------------------------------
// The head: pinned above the grid

export function CalendarHead({ cal }: { cal: CalendarState }) {
  const [picking, setPicking] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);
  const { view } = cal;

  // ← → move, T today, D W M switch — when not typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (document.querySelector('.drawer, .dlg, .sel-pop, .acal-fan')) return;
      const k = event.key.toLowerCase();
      if (event.key === 'ArrowLeft') cal.go(-1);
      else if (event.key === 'ArrowRight') cal.go(1);
      else if (k === 't') cal.setAnchor(cal.now);
      else if (k === 'd') cal.setView('day');
      else if (k === 'w' && !cal.narrow) cal.setView('week');
      else if (k === 'm') cal.setView('month');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!picking) return;
    const away = (event: PointerEvent) => {
      if (!pickRef.current?.contains(event.target as Node)) setPicking(false);
    };
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && setPicking(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [picking]);

  const views: Array<{ key: CalView; label: string; icon: IconName }> = [
    { key: 'day', label: t`Day`, icon: 'columns' },
    ...(cal.narrow ? [] : [{ key: 'week' as CalView, label: t`Week`, icon: 'calendar' as IconName }]),
    { key: 'month', label: t`Month`, icon: 'overview' },
  ];

  return (
    <>
      <div className="acal-nav">
        <div className="acal-step">
          <button type="button" onClick={() => cal.go(-1)} aria-label={t`Earlier`} title={t`Earlier (←)`}>
            <Icon name="chevronLeft" size={17} />
          </button>
          <button type="button" className="acal-today" onClick={() => cal.setAnchor(cal.now)} title={t`Today (T)`}>
            <Trans>Today</Trans>
          </button>
          <button type="button" onClick={() => cal.go(1)} aria-label={t`Later`} title={t`Later (→)`}>
            <Icon name="chevronRight" size={17} />
          </button>
        </div>
        <div className="acal-pick" ref={pickRef}>
          <button type="button" className={`acal-range${picking ? ' is-open' : ''}`} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
            <span>{rangeLabel(cal)}</span>
            <Icon name="chevronDown" size={15} stroke={2.2} />
          </button>
          {picking && (
            <div className="acal-pick-pop">
              <MiniMonth
                cal={cal}
                onPick={(day) => {
                  cal.setAnchor(day);
                  setPicking(false);
                }}
              />
            </div>
          )}
        </div>
        {!cal.narrow && cal.scope.length > 0 && (
          <span className="acal-full" title={t`Booked time against open time, for the time shown`}>
            <Trans>
              <i style={{ '--share': cal.full.share } as CSSProperties} />
              {Math.round(cal.full.share * 100)}% booked
            </Trans>
          </span>
        )}
        <div className="acal-views" role="tablist" aria-label={t`Show`}>
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={view === v.key ? 'is-on' : ''}
              onClick={() => cal.setView(v.key)}
              title={`${v.label} (${v.label[0]})`}
            >
              <Icon name={v.icon} size={15} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="acal-legend" role="group" aria-label={t`Statuses shown`}>
        {STATUS_ORDER.map((status) => {
          const on = cal.shown.includes(status);
          return (
            <button
              key={status}
              type="button"
              className={`acal-chip st-${STATUS[status].cls}${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => cal.toggle(status)}
              title={on ? t`Hide ${STATUS[status].label.toLowerCase()}` : t`Show ${STATUS[status].label.toLowerCase()}`}
            >
              <i />
              {STATUS[status].label}
              <b>{cal.counts[status]}</b>
            </button>
          );
        })}
        <span className="acal-chip-key">
          <Trans>
            <i className="key-free" />Free
            <i className="key-closed" />Closed
            <i className="key-break" />Break
          </Trans>
        </span>
      </div>

      {cal.narrow && view === 'day' && <WeekStrip cal={cal} />}

      {!cal.narrow && view !== 'month' && <DayHeads cal={cal} />}
    </>
  );
}

/** On a phone, the week as a strip of days over the one shown. */
function WeekStrip({ cal }: { cal: CalendarState }) {
  const start = weekStart(cal.anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const week = useQuery({
    queryKey: ['appointments', 'calendar', start.toISOString(), addDays(start, 7).toISOString(), cal.branch],
    queryFn: () => bookingsBetween(start, addDays(start, 7), cal.branch || undefined),
    staleTime: 30_000,
  });
  return (
    <div className="acal-strip pin-phone" role="tablist" aria-label={t`Days`}>
      {days.map((day) => {
        const n = (week.data ?? []).filter((a) => sameDay(new Date(a.startTime), day) && a.status !== 'CANCELLED').length;
        const on = sameDay(day, cal.anchor);
        return (
          <button
            key={day.toISOString()}
            type="button"
            role="tab"
            aria-selected={on}
            className={`${on ? 'is-on' : ''}${sameDay(day, cal.now) ? ' is-today' : ''}`}
            onClick={() => cal.setAnchor(day)}
          >
            <em>{day.toLocaleDateString(dateLocale(), { weekday: 'narrow' })}</em>
            <strong>{day.getDate()}</strong>
            <i className={n ? 'has' : ''}>{n || ''}</i>
          </button>
        );
      })}
    </div>
  );
}

const GUTTER = 56;

function DayHeads({ cal }: { cal: CalendarState }) {
  return (
    <div className="acal-heads" style={{ '--cols': cal.columns.length, '--gutter': `${GUTTER}px` } as CSSProperties}>
      <span className="acal-heads-gutter">{cal.view === 'week' ? t`W${isoWeek(cal.range.days[0])}` : ''}</span>
      {cal.columns.map((col) => {
        const n = col.visible.length;
        const hours = col.plan.open.length ? col.plan.open.map((i) => `${hhmm(i.start)}–${hhmm(i.end)}`).join(', ') : null;
        return (
          <button
            key={col.key}
            type="button"
            className={`acal-head${col.isToday ? ' is-today' : ''}${col.plan.closed ? ' is-closed' : ''}`}
            onClick={() => cal.view === 'week' && (cal.setAnchor(col.day), cal.setView('day'))}
            disabled={cal.view !== 'week'}
            title={cal.view === 'week' ? t`Open this day` : undefined}
          >
            {cal.view === 'week' ? (
              <>
                <em>{col.title}</em>
                <strong>{col.sub}</strong>
              </>
            ) : (
              <strong className="acal-head-name">{cal.columns.length > 1 ? col.title : col.day.toLocaleDateString(dateLocale(), { weekday: 'long' })}</strong>
            )}
            <span className="acal-head-meta">
              {col.plan.closed ? (
                <span className="acal-head-closed">{col.plan.closed.replace(/^Closed — /, '')}</span>
              ) : (
                <>
                  {n > 0 && <b>{n}</b>}
                  {cal.view === 'day' && hours && <small>{hours}</small>}
                  {col.plan.special && <small className="acal-head-special"><Trans>Special hours</Trans></small>}
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const isoWeek = (d: Date) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
};

// ---------------------------------------------------------------------------
// The body

export function CalendarBody({
  cal,
  actions,
  covers,
  money,
}: {
  cal: CalendarState;
  actions: Actions;
  covers: Map<string, string | null>;
  money: Money;
}) {
  return (
    <div className={`acal-body${cal.wide ? ' has-side' : ''}${cal.refreshing ? ' is-refreshing' : ''}`}>
      {cal.wide && (
        <aside className="acal-side">
          <MiniMonth cal={cal} onPick={cal.setAnchor} />
          <Insight cal={cal} />
        </aside>
      )}
      <div className="acal-main">
        {cal.loading ? (
          <div className="acal-loading" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        ) : cal.view === 'month' ? (
          <MonthGrid cal={cal} actions={actions} />
        ) : (
          <TimeGrid cal={cal} actions={actions} covers={covers} money={money} />
        )}
      </div>
    </div>
  );
}

/** How the time shown is going: bookings, hours booked, how full. */
function Insight({ cal }: { cal: CalendarState }) {
  const real = cal.all.filter((a) => HOLDS_A_PLACE.includes(a.status));
  const byDay = new Map<string, number>();
  for (const a of real) byDay.set(ymdOf(new Date(a.startTime)), (byDay.get(ymdOf(new Date(a.startTime))) ?? 0) + 1);
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const what = cal.view === 'day' ? t`This day` : cal.view === 'week' ? t`This week` : t`This month`;
  return (
    <section className="acal-insight">
      <p className="acal-side-label">{what}</p>
      <div className="acal-ring" style={{ '--share': cal.full.share } as CSSProperties}>
        <strong>{Math.round(cal.full.share * 100)}%</strong>
        <span><Trans>booked</Trans></span>
      </div>
      <dl>
        <div>
          <dt><Trans>Bookings</Trans></dt>
          <dd>{real.length}</dd>
        </div>
        <div>
          <dt><Trans>Hours booked</Trans></dt>
          <dd>{cal.full.bookedHours.toFixed(cal.full.bookedHours < 10 ? 1 : 0)}</dd>
        </div>
        <div>
          <dt><Trans>Open hours</Trans></dt>
          <dd>{Math.round(cal.full.openHours)}</dd>
        </div>
        {busiest && cal.view !== 'day' && (
          <div>
            <dt><Trans>Busiest</Trans></dt>
            <dd>{dateOf(busiest[0]).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric' })}</dd>
          </div>
        )}
      </dl>
      <p className="acal-insight-note"><Trans>Booked time against open time, counting each place a branch has.</Trans></p>
    </section>
  );
}

/** A month to pick a day from, each day dotted by how busy it is. */
function MiniMonth({ cal, onPick }: { cal: CalendarState; onPick: (day: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(cal.anchor.getFullYear(), cal.anchor.getMonth(), 1));
  useEffect(() => setMonth(new Date(cal.anchor.getFullYear(), cal.anchor.getMonth(), 1)), [cal.anchor.getFullYear(), cal.anchor.getMonth()]);
  const start = monthGridStart(month);
  const data = useQuery({
    queryKey: ['appointments', 'calendar', start.toISOString(), addDays(start, 42).toISOString(), cal.branch],
    queryFn: () => bookingsBetween(start, addDays(start, 42), cal.branch || undefined),
    staleTime: 60_000,
  });
  const count = new Map<string, number>();
  for (const a of data.data ?? []) {
    if (a.status === 'CANCELLED') continue;
    const k = ymdOf(new Date(a.startTime));
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const most = Math.max(1, ...count.values());
  const inRange = (d: Date) =>
    cal.view === 'day' ? sameDay(d, cal.anchor) : cal.view === 'week' ? d >= cal.range.from && d < cal.range.to : false;

  return (
    <div className="acal-mini">
      <header>
        <strong>{month.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })}</strong>
        <span>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t`Previous month`}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t`Next month`}>
            <Icon name="chevronRight" size={15} />
          </button>
        </span>
      </header>
      <div className="acal-mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <em key={i}>{d}</em>
        ))}
        {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => {
          const n = count.get(ymdOf(d)) ?? 0;
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={[
                d.getMonth() !== month.getMonth() && 'is-other',
                sameDay(d, cal.now) && 'is-today',
                inRange(d) && 'is-in',
                sameDay(d, cal.anchor) && 'is-anchor',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPick(d)}
              title={n ? t`${n} booking${n === 1 ? '' : 's'}` : undefined}
            >
              {d.getDate()}
              {n > 0 && <i style={{ opacity: 0.35 + (0.65 * n) / most }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day and week: the time grid

function TimeGrid({
  cal,
  actions,
  covers,
  money,
}: {
  cal: CalendarState;
  actions: Actions;
  covers: Map<string, string | null>;
  money: Money;
}) {
  const { columns, now } = cal;
  const hourH = cal.view === 'day' ? (cal.narrow ? 76 : 84) : 64;
  const ppm = hourH / 60;

  // From the earliest opening or booking to the latest, on whole hours.
  let first = Infinity;
  let last = -Infinity;
  for (const col of columns) {
    for (const i of col.plan.open) {
      first = Math.min(first, i.start);
      last = Math.max(last, i.end);
    }
    for (const a of col.visible) {
      const s = spanOf(a, col.day);
      if (s) {
        first = Math.min(first, s.start);
        last = Math.max(last, s.end);
      }
    }
  }
  if (!Number.isFinite(first)) {
    first = 8 * 60;
    last = 18 * 60;
  }
  const startH = Math.max(0, Math.floor(first / 60));
  const endH = Math.min(24, Math.max(startH + 6, Math.ceil(last / 60)));
  const top = (m: number) => (m - startH * 60) * ppm;
  const height = (endH - startH) * hourH;

  const [fan, setFan] = useState<{ cluster: Cluster; column: Column; rect: DOMRect; pinned: boolean } | null>(null);
  const timers = useRef<{ open?: number; close?: number }>({});
  const clear = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };
  const openFan = (cluster: Cluster, column: Column, el: HTMLElement, pinned: boolean, delay = 0) => {
    clear();
    timers.current.open = window.setTimeout(() => setFan({ cluster, column, rect: el.getBoundingClientRect(), pinned }), delay);
  };
  const closeFan = (delay = 160) => {
    clear();
    timers.current.close = window.setTimeout(() => setFan(null), delay);
  };
  useEffect(() => () => clear(), []);
  // A moved page closes it: the pile it fanned from is no longer there.
  useEffect(() => {
    if (!fan) return;
    const away = () => setFan(null);
    window.addEventListener('scroll', away, { passive: true });
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('scroll', away);
      window.removeEventListener('resize', away);
    };
  }, [fan]);

  const nowMin = minuteOfDay(now);
  const nowVisible = columns.some((c) => c.isToday) && nowMin >= startH * 60 && nowMin <= endH * 60;
  const empty = columns.every((c) => c.visible.length === 0);

  return (
    <div
      className={`acal-grid is-${cal.view}`}
      style={{ '--cols': columns.length, '--hour-h': `${hourH}px`, '--gutter': `${cal.narrow ? 46 : GUTTER}px` } as CSSProperties}
    >
      <div className="acal-gutter" style={{ height }}>
        {Array.from({ length: endH - startH }, (_, i) => (
          <span key={i} style={{ top: i * hourH }}>
            {hhmm((startH + i) * 60)}
          </span>
        ))}
        {nowVisible && (
          <b className="acal-gutter-now" style={{ top: top(nowMin) }}>
            {clock(now)}
          </b>
        )}
      </div>
      <div className="acal-cols" style={{ height }}>
        {columns.map((col) => (
          <ColumnView
            key={col.key}
            col={col}
            startH={startH}
            endH={endH}
            top={top}
            ppm={ppm}
            cal={cal}
            covers={covers}
            nowMin={nowMin}
            fanKey={fan && fan.column.key === col.key ? fan.cluster.start : null}
            onOpen={actions.open}
            onPile={openFan}
            onLeave={() => !fan?.pinned && closeFan()}
          />
        ))}
        {nowVisible && <i className="acal-now-faint" style={{ top: top(nowMin) }} />}
        {empty && (
          <p className="acal-empty">
            <Icon name="calendar" size={18} />
            {cal.all.length ? t`No bookings with the statuses shown — turn more on above.` : t`No bookings in this time yet.`}
          </p>
        )}
      </div>

      {fan && (
        <Fan
          fan={fan}
          cal={cal}
          covers={covers}
          money={money}
          actions={actions}
          onEnter={clear}
          onLeave={() => !fan.pinned && closeFan()}
          onClose={() => setFan(null)}
        />
      )}
    </div>
  );
}

function ColumnView({
  col,
  startH,
  endH,
  top,
  ppm,
  cal,
  covers,
  nowMin,
  fanKey,
  onOpen,
  onPile,
  onLeave,
}: {
  col: Column;
  startH: number;
  endH: number;
  top: (m: number) => number;
  ppm: number;
  cal: CalendarState;
  covers: Map<string, string | null>;
  nowMin: number;
  fanKey: number | null;
  onOpen: (a: Appointment) => void;
  onPile: (cluster: Cluster, column: Column, el: HTMLElement, pinned: boolean, delay?: number) => void;
  onLeave: () => void;
}) {
  const dayStart = startH * 60;
  const dayEnd = endH * 60;
  // Closed time: before opening, between openings, after closing.
  const closed: Interval[] = [];
  let cursor = dayStart;
  for (const i of [...col.plan.open].sort((a, b) => a.start - b.start)) {
    if (i.start > cursor) closed.push({ start: cursor, end: Math.min(i.start, dayEnd) });
    cursor = Math.max(cursor, i.end);
  }
  if (cursor < dayEnd) closed.push({ start: cursor, end: dayEnd });
  const past = startOfDay(col.day) < startOfDay(cal.now);
  const pastTo = past ? dayEnd : col.isToday ? Math.min(dayEnd, nowMin) : dayStart;

  return (
    <div className={`acal-col${col.isToday ? ' is-today' : ''}${col.plan.closed ? ' is-closed' : ''}`}>
      {pastTo > dayStart && <i className="acal-past" style={{ top: 0, height: top(pastTo) }} />}
      {closed.map((i) => (
        <span key={`c${i.start}`} className="acal-closed" style={{ top: top(i.start), height: (i.end - i.start) * ppm }}>
          {col.plan.closed && i.start === dayStart && <em>{col.plan.closed}</em>}
        </span>
      ))}
      {col.plan.breaks.map((b) => (
        <span key={`b${b.start}`} className="acal-break" style={{ top: top(b.start), height: (b.end - b.start) * ppm }} title={t`Break ${hhmm(b.start)}–${hhmm(b.end)}${b.reason ? ` · ${b.reason}` : ''}`}>
          <em><Trans>Break</Trans>{b.reason ? ` · ${b.reason}` : ''}
          </em>
        </span>
      ))}
      {col.free.map((f) => {
        const h = (f.end - f.start) * ppm;
        return (
          <span
            key={`f${f.start}`}
            className="acal-free"
            style={{ top: top(f.start) + 2, height: h - 4 }}
            title={t`Free ${hhmm(f.start)}–${hhmm(f.end)} — customers can book this time`}
          >
            {h >= 30 && (
              <em>
                <Icon name="plus" size={11} stroke={2.6} /><Trans>Free · {span(f.end - f.start)}</Trans>
              </em>
            )}
          </span>
        );
      })}

      {clusters(col.visible, col.day).map((cluster) => {
        const y = top(cluster.start);
        const h = Math.max(24, (cluster.end - cluster.start) * ppm - 3);
        if (cluster.items.length === 1) {
          return (
            <EventBlock
              key={cluster.items[0].id}
              a={cluster.items[0]}
              style={{ top: y + 1, height: h }}
              tall={h}
              cal={cal}
              cover={covers.get(cluster.items[0].service.id) ?? null}
              showBranch={!col.location && cal.scope.length > 1}
              onOpen={onOpen}
            />
          );
        }
        const capacity = col.location?.capacity ?? null;
        const taken = col.used ? peak(col.used, cluster.start, cluster.end) : null;
        return (
          <Pile
            key={`p${cluster.start}`}
            cluster={cluster}
            style={{ top: y + 1, height: h }}
            tall={h}
            open={fanKey === cluster.start}
            rich={cal.view === 'day'}
            capacity={capacity}
            taken={taken}
            search={cal.search}
            onHover={(el) => onPile(cluster, col, el, false, 90)}
            onClick={(el) => onPile(cluster, col, el, true)}
            onLeave={onLeave}
          />
        );
      })}

      {col.isToday && nowMin >= dayStart && nowMin <= dayEnd && (
        <i className="acal-now" style={{ top: top(nowMin) }} />
      )}
    </div>
  );
}

function tone(a: Appointment, now: Date) {
  if (a.status === 'BOOKED' && new Date(a.startTime) < now) return 'late';
  return STATUS[a.status].cls;
}

function EventBlock({
  a,
  style,
  tall,
  cal,
  cover,
  showBranch,
  onOpen,
}: {
  a: Appointment;
  style: CSSProperties;
  tall: number;
  cal: CalendarState;
  cover: string | null;
  showBranch: boolean;
  onOpen: (a: Appointment) => void;
}) {
  const hit = matches(a, cal.search);
  const start = new Date(a.startTime);
  const end = new Date(a.endTime);
  const size = tall < 34 ? 'xs' : tall < 58 ? 's' : 'm';
  return (
    <button
      type="button"
      className={`acal-ev st-${tone(a, cal.now)} size-${size}${cal.search ? (hit ? ' is-hit' : ' is-dim') : ''}`}
      style={style}
      onClick={() => onOpen(a)}
      title={`${clock(start)}–${clock(end)} · ${a.service.name}${a.quantity > 1 ? ` ×${a.quantity}` : ''} · ${a.customer.email} · ${STATUS[a.status].label}`}
    >
      {size === 'm' && cal.view === 'day' && <Thumb cover={cover} size={38} />}
      <span className="acal-ev-text">
        <span className="acal-ev-time">
          <span>
            {clock(start)}
            {size !== 'xs' && <span className="acal-end">–{clock(end)}</span>}
          </span>
          {tone(a, cal.now) === 'late' && cal.view === 'day' && <b className="acal-ev-late"><Trans>Late</Trans></b>}
        </span>
        <strong>
          {a.service.name}
          {a.quantity > 1 && <em> ×{a.quantity}</em>}
        </strong>
        {size === 'm' && <span className="acal-ev-who">{a.customer.email}</span>}
        {size === 'm' && showBranch && <span className="acal-ev-who">{a.location.name}</span>}
      </span>
    </button>
  );
}

/** Bookings that overlap, as a pile of cards; it fans open on hover (§229). */
function Pile({
  cluster,
  style,
  tall,
  open,
  rich,
  capacity,
  taken,
  search,
  onHover,
  onClick,
  onLeave,
}: {
  cluster: Cluster;
  style: CSSProperties;
  tall: number;
  open: boolean;
  /** Room to list what is in the pile (a day's wide column). */
  rich: boolean;
  capacity: number | null;
  taken: number | null;
  search: string;
  onHover: (el: HTMLElement) => void;
  onClick: (el: HTMLElement) => void;
  onLeave: () => void;
}) {
  const n = cluster.items.length;
  const hits = search ? cluster.items.filter((a) => matches(a, search)).length : 0;
  const names = [...new Set(cluster.items.map((a) => a.service.name))];
  return (
    <button
      type="button"
      className={`acal-pile${open ? ' is-open' : ''}${tall < 46 ? ' is-short' : ''}${search ? (hits ? ' is-hit' : ' is-dim') : ''}`}
      style={{ ...style, '--layers': Math.min(n, 3) - 1 } as CSSProperties}
      onPointerEnter={(event) => event.pointerType === 'mouse' && onHover(event.currentTarget)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && onLeave()}
      onClick={(event) => onClick(event.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t`${n} bookings between ${hhmm(cluster.start)} and ${hhmm(cluster.end)}. Open them.`}
    >
      <span className="acal-pile-paper" aria-hidden="true" />
      <span className="acal-pile-paper p2" aria-hidden="true" />
      <span className="acal-pile-card">
        <span className="acal-pile-top">
          <b>{n}</b>
          <span>
            {hhmm(cluster.start)}
            <span className="acal-end">–{hhmm(cluster.end)}</span>
          </span>
        </span>
        {tall >= 46 && !(rich && tall >= 90) && (
          <strong>
            {names.slice(0, 2).join(', ')}
            {names.length > 2 ? ` +${names.length - 2}` : ''}
          </strong>
        )}
        {rich && tall >= 90 && (
          <span className="acal-pile-list">
            {cluster.items.map((a) => (
              <span key={a.id} className={`st-${STATUS[a.status].cls}`}>
                <i />
                <b>{clock(a.startTime)}</b> {a.service.name}
                {a.quantity > 1 ? ` ×${a.quantity}` : ''}
              </span>
            ))}
          </span>
        )}
        {tall >= 64 && (
          <span className="acal-pile-dots">
            {cluster.items.slice(0, 8).map((a) => (
              <i key={a.id} className={`st-${STATUS[a.status].cls}`} />
            ))}
            {capacity !== null && taken !== null && (
              <small className={taken >= capacity ? 'is-full' : ''}>
                {taken >= capacity ? (
                  t`Full`
                ) : (
                  <>
                    {capacity - taken}
                    <Trans><span className="acal-end"> of {capacity}</span> free</Trans>
                  </>
                )}
              </small>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

/** The pile, fanned out: every booking in it, readable, each opening its details. */
function Fan({
  fan,
  cal,
  covers,
  money,
  actions,
  onEnter,
  onLeave,
  onClose,
}: {
  fan: { cluster: Cluster; column: Column; rect: DOMRect; pinned: boolean };
  cal: CalendarState;
  covers: Map<string, string | null>;
  money: Money;
  actions: Actions;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const sheet = useMediaQuery('(max-width: 640px), (hover: none)');
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const { cluster, column, rect } = fan;
  const width = 340;

  useLayoutEffect(() => {
    if (sheet) return;
    const h = panel.current?.offsetHeight ?? 300;
    const right = rect.right + 10;
    const left = right + width < window.innerWidth - 12 ? right : Math.max(12, rect.left - width - 10);
    const top = Math.max(84, Math.min(rect.top - 8, window.innerHeight - h - 12));
    setPlace({ left, top });
  }, [rect, sheet]);

  useEffect(() => {
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const taken = column.used ? peak(column.used, cluster.start, cluster.end) : null;
  const capacity = column.location?.capacity ?? null;
  const items = [...cluster.items].sort((x, y) => x.startTime.localeCompare(y.startTime));
  const body: ReactNode = (
    <>
      <header className="acal-fan-head">
        <div>
          <strong>
            <Trans>{items.length} bookings · {hhmm(cluster.start)}–{hhmm(cluster.end)}</Trans>
          </strong>
          <span>
            {column.day.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' })}
            {column.location ? ` · ${column.location.name}` : ''}
          </span>
        </div>
        {capacity !== null && taken !== null && (
          <span className={`acal-fan-places${taken >= capacity ? ' is-full' : ''}`}>
            <Trans>
              <b>
              {Math.min(taken, capacity)}/{capacity}
              </b>places
            </Trans>
          </span>
        )}
        <button type="button" className="acal-fan-close" onClick={onClose} aria-label={t`Close`}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <ul className="acal-fan-list">
        {items.map((a, i) => {
          const pay = payment(a, money);
          const stand = standing(a, cal.now);
          const t = tone(a, cal.now);
          const fromX = place ? rect.left - place.left + 6 * i : 0;
          const fromY = place ? rect.top - (place.top + 64 + i * 112) + 6 * i : 0;
          return (
            <li
              key={a.id}
              className={`acal-card st-${t}${cal.search && !matches(a, cal.search) ? ' is-dim' : ''}`}
              style={{ '--i': i, '--fx': `${fromX}px`, '--fy': `${fromY}px` } as CSSProperties}
            >
              <button type="button" className="acal-card-main" onClick={() => (onClose(), actions.open(a))}>
                <span className="acal-card-row">
                  <span className="acal-card-time">
                    {clock(a.startTime)}–{clock(a.endTime)}
                  </span>
                  <span className={`pill ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                </span>
                <span className="acal-card-what">
                  <Thumb cover={covers.get(a.service.id) ?? null} size={36} />
                  <span>
                    <strong>
                      {a.service.name}
                      {a.quantity > 1 && <em> ×{a.quantity}</em>}
                    </strong>
                    <small>
                      <Trans>{a.customer.email} · No. {reservationNo(a.id)}</Trans>
                    </small>
                  </span>
                </span>
                <span className="acal-card-row is-foot">
                  <span className={`acal-card-when tone-${stand.tone}`}>{stand.text}</span>
                  <span className="acal-card-pay">
                    {pay.amount}
                    {pay.unit && <small> {pay.unit}</small>}
                  </span>
                </span>
              </button>
              {a.status === 'BOOKED' && sameDay(new Date(a.startTime), cal.now) && (
                <button type="button" className="primary acal-card-act" onClick={() => (onClose(), actions.checkIn(a))}>
                  <Icon name="ticket" size={14} />{' '}
                  <Trans>Check in</Trans>
                </button>
              )}
              {a.status === 'IN_PROGRESS' && (
                <button type="button" className="dark acal-card-act" onClick={() => (onClose(), actions.complete(a))}>
                  <Icon name="check" size={14} stroke={2.4} />{' '}
                  <Trans>Mark done</Trans>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );

  if (sheet) {
    return (
      <Portal>
        <div className="acal-fan-backdrop" onPointerDown={onClose} />
        <div className="acal-fan is-sheet" role="dialog" aria-label={t`Bookings at this time`}>
          {body}
        </div>
      </Portal>
    );
  }
  return (
    <Portal>
      <div
        ref={panel}
        className={`acal-fan${place ? ' is-placed' : ''}`}
        role="dialog"
        aria-label={t`Bookings at this time`}
        style={{ width, left: place?.left ?? -9999, top: place?.top ?? 0 }}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {body}
      </div>
    </Portal>
  );
}

// ---------------------------------------------------------------------------
// Month

function MonthGrid({ cal, actions }: { cal: CalendarState; actions: Actions }) {
  const byDay = new Map<string, Appointment[]>();
  for (const a of cal.all) {
    if (!cal.shown.includes(a.status)) continue;
    const k = ymdOf(new Date(a.startTime));
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  for (const list of byDay.values()) list.sort((x, y) => x.startTime.localeCompare(y.startTime));
  const room = cal.narrow ? 0 : 3;
  return (
    <div className="acal-month">
      {[1, 2, 3, 4, 5, 6, 0].map((day) => dayName(day, 'short')).map((d) => (
        <em key={d} className="acal-month-wd">
          {cal.narrow ? d[0] : d}
        </em>
      ))}
      {cal.range.days.map((day) => {
        const list = byDay.get(ymdOf(day)) ?? [];
        const plans = cal.scope.map((l) => cal.plan(l, day));
        const closed = plans.length > 0 && plans.every((p) => p.closed);
        return (
          <div
            key={day.toISOString()}
            className={[
              'acal-month-day',
              day.getMonth() !== cal.anchor.getMonth() && 'is-other',
              sameDay(day, cal.now) && 'is-today',
              closed && 'is-closed',
              startOfDay(day) < startOfDay(cal.now) && 'is-past',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button type="button" className="acal-month-open" onClick={() => (cal.setAnchor(day), cal.setView('day'))} aria-label={t`Open ${day.toDateString()}`}>
              <span className="acal-month-num">{day.getDate()}</span>
              {list.length > 0 && <b className="acal-month-count">{list.length}</b>}
            </button>
            {room > 0 &&
              list.slice(0, room).map((a) => (
                <button key={a.id} type="button" className={`acal-month-ev st-${tone(a, cal.now)}`} onClick={() => actions.open(a)} title={`${a.service.name} · ${a.customer.email}`}>
                  <i />
                  <span>{clock(a.startTime)}</span> {a.service.name}
                </button>
              ))}
            {room > 0 && list.length > room && (
              <button type="button" className="acal-month-more" onClick={() => (cal.setAnchor(day), cal.setView('day'))}>
                +{list.length - room}
                  <Trans>more</Trans>
                </button>
            )}
            {room === 0 && list.length > 0 && (
              <span className="acal-month-dots">
                {list.slice(0, 4).map((a) => (
                  <i key={a.id} className={`st-${STATUS[a.status].cls}`} />
                ))}
              </span>
            )}
            {closed && room > 0 && list.length === 0 && <span className="acal-month-closed"><Trans>Closed</Trans></span>}
          </div>
        );
      })}
    </div>
  );
}


