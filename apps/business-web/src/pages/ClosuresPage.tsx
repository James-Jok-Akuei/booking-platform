import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  createException,
  createTimeBlock,
  deleteException,
  deleteTimeBlock,
  listExceptions,
  listLocations,
  listTimeBlocks,
  type Location,
  type ScheduleException,
  type TimeBlock,
} from '../api/business';
import { BranchPills } from '../ui/BranchPills';
import { Icon } from '../ui/Icon';
import './closures.css';

/** A local calendar day as YYYY-MM-DD — the seller's today, not UTC's. */
const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymdOf(new Date());
const dayOf = (ymd: string) => new Date(`${ymd}T12:00:00`);

const niceDate = (ymd: string) =>
  dayOf(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const isPast = (ymd: string) => ymd < today();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * Days that do not follow the usual week (§102, §195, §207).
 *
 * Two mechanisms on the server, deliberately: a **closure** replaces a whole
 * day — shut for a public holiday, or open at different hours — and a
 * **break** removes a slice from an otherwise normal day.
 *
 * On the page they are one planner (§207): the month on the left is where a
 * day is picked, and the panel beside it is that day — what it usually is,
 * what has been changed on it, and the two ways to change it. Everything
 * coming up is listed underneath, each a link back to its day.
 */
export function ClosuresPage() {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState(today());

  const branches = locations.data ?? [];
  const locationId = selected ?? branches[0]?.id ?? null;
  const branch = branches.find((b) => b.id === locationId) ?? null;

  const exceptions = useQuery({
    queryKey: ['exceptions', locationId],
    queryFn: () => listExceptions(locationId!),
    enabled: Boolean(locationId),
  });
  const blocks = useQuery({
    queryKey: ['time-blocks', locationId],
    queryFn: () => listTimeBlocks(locationId!),
    enabled: Boolean(locationId),
  });

  return (
    <section className="cl">
      <header className="page-head">
        <div>
          <h1>Closures &amp; breaks</h1>
          <p className="muted">
            Days that do not follow your usual week. Pick a day, then close it, change its hours or take a
            break out of it — customers cannot book the times you take out.
          </p>
        </div>
      </header>

      <BranchPills branches={branches} value={locationId} onChange={setSelected} />

      {locations.isLoading && <div className="skeleton cl-skeleton" />}
      {branches.length === 0 && !locations.isLoading && (
        <div className="cl-empty">
          <Icon name="pin" size={26} />
          <p>Add a branch first, under Branches &amp; hours.</p>
        </div>
      )}

      {locationId && branch && (
        <>
          <article className="cl-plan">
            <MonthCalendar
              branch={branch}
              closures={exceptions.data ?? []}
              breaks={blocks.data ?? []}
              selected={date}
              onSelect={setDate}
            />
            <DayPanel
              key={locationId}
              branch={branch}
              date={date}
              closures={exceptions.data ?? []}
              breaks={blocks.data ?? []}
            />
          </article>
          <ComingUp
            branch={branch}
            closures={exceptions.data ?? []}
            breaks={blocks.data ?? []}
            selected={date}
            onPick={setDate}
          />
        </>
      )}
    </section>
  );
}

/** What a branch usually does on a weekday, from its weekly hours (§12.4). */
function usualDay(branch: Location, ymd: string) {
  const weekday = dayOf(ymd).getDay();
  const hours = branch.hours.find((h) => h.dayOfWeek === weekday);
  // A day with no saved hours is shut too.
  if (!hours || hours.isClosed) return { open: false as const, weekday };
  return { open: true as const, weekday, from: hours.openTime, to: hours.closeTime };
}

/** Removing a closure or a break — from the day panel or the list below. */
function useRemove(locationId: string) {
  const queryClient = useQueryClient();
  const closure = useMutation({
    mutationFn: (id: string) => deleteException(locationId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exceptions', locationId] }),
  });
  const pause = useMutation({
    mutationFn: (id: string) => deleteTimeBlock(locationId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['time-blocks', locationId] }),
  });
  return { closure, pause, busy: closure.isPending || pause.isPending };
}

function MonthCalendar({
  branch,
  closures,
  breaks,
  selected,
  onSelect,
}: {
  branch: Location;
  closures: ScheduleException[];
  breaks: TimeBlock[];
  selected: string;
  onSelect: (ymd: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = dayOf(selected);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // A day picked somewhere else (the list below) brings its month into view.
  useEffect(() => {
    const d = dayOf(selected);
    setMonth((m) =>
      m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth() ? m : new Date(d.getFullYear(), d.getMonth(), 1),
    );
  }, [selected]);

  const cells = useMemo(() => {
    // Monday first: how far the 1st is from the Monday before it.
    const lead = (month.getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  const byDate = useMemo(() => new Map(closures.map((c) => [c.date.slice(0, 10), c])), [closures]);
  const breaksOn = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of breaks) map.set(b.date.slice(0, 10), (map.get(b.date.slice(0, 10)) ?? 0) + 1);
    return map;
  }, [breaks]);
  const weeklyOff = new Set(branch.hours.filter((h) => h.isClosed).map((h) => h.dayOfWeek));
  for (let d = 0; d < 7; d++) if (!branch.hours.some((h) => h.dayOfWeek === d)) weeklyOff.add(d);

  const now = today();
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div className="cal">
      <p className="cl-step">
        <b>1</b> Pick a day
      </p>
      <header className="cal-head">
        <h2>{label}</h2>
        <div className="cal-nav">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button
            type="button"
            className="cal-today"
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              onSelect(today());
            }}
          >
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={() => step(1)}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </header>

      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="cal-wd">
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const ymd = ymdOf(d);
          const closure = byDate.get(ymd);
          const breakCount = breaksOn.get(ymd) ?? 0;
          const cls = [
            'cal-day',
            d.getMonth() !== month.getMonth() && 'is-other',
            ymd < now && 'is-past',
            ymd === now && 'is-today',
            ymd === selected && 'is-selected',
            weeklyOff.has(d.getDay()) && !closure && 'is-weekly-off',
            closure?.isClosed && 'is-closed',
            closure && !closure.isClosed && 'is-special',
          ]
            .filter(Boolean)
            .join(' ');
          const title = closure
            ? closure.isClosed
              ? `Closed all day${closure.reason ? ` — ${closure.reason}` : ''}`
              : `Open ${closure.customOpenTime} to ${closure.customCloseTime}${closure.reason ? ` — ${closure.reason}` : ''}`
            : weeklyOff.has(d.getDay())
              ? 'Usually closed'
              : undefined;
          return (
            <button
              key={ymd}
              type="button"
              className={cls}
              onClick={() => onSelect(ymd)}
              title={title}
              aria-pressed={ymd === selected}
            >
              <span>{d.getDate()}</span>
              {breakCount > 0 && (
                <i className="cal-breaks" aria-label={`${breakCount} break${breakCount === 1 ? '' : 's'}`}>
                  {Array.from({ length: Math.min(breakCount, 3) }, (_, i) => (
                    <b key={i} />
                  ))}
                </i>
              )}
            </button>
          );
        })}
      </div>

      <footer className="cal-legend">
        <span>
          <i className="lg-closed" /> Closed all day
        </span>
        <span>
          <i className="lg-special" /> Different hours
        </span>
        <span>
          <i className="lg-break" /> Break
        </span>
        <span>
          <i className="lg-off" /> Usually closed
        </span>
      </footer>
    </div>
  );
}

/**
 * The day picked on the calendar: what it usually is, what has been changed on
 * it, and the two ways to change it — both acting on this day, so neither form
 * asks for a date of its own.
 */
function DayPanel({
  branch,
  date,
  closures,
  breaks,
}: {
  branch: Location;
  date: string;
  closures: ScheduleException[];
  breaks: TimeBlock[];
}) {
  const queryClient = useQueryClient();
  const locationId = branch.id;
  const remove = useRemove(locationId);
  const [tab, setTab] = useState<'whole' | 'part'>('whole');
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [open, setOpen] = useState('10:00');
  const [close, setClose] = useState('14:00');
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [why, setWhy] = useState('');

  const closure = closures.find((c) => c.date.slice(0, 10) === date) ?? null;
  const dayBreaks = breaks
    .filter((b) => b.date.slice(0, 10) === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const usual = usualDay(branch, date);
  const past = isPast(date);
  const d = dayOf(date);

  const addClosure = useMutation({
    mutationFn: () =>
      createException(locationId, {
        date,
        ...(mode === 'closed' ? { isClosed: true } : { customOpenTime: open, customCloseTime: close }),
        ...(why.trim() ? { reason: why.trim() } : {}),
      }),
    onSuccess: () => {
      setWhy('');
      queryClient.invalidateQueries({ queryKey: ['exceptions', locationId] });
    },
  });
  const addBreak = useMutation({
    mutationFn: () =>
      createTimeBlock(locationId, {
        date,
        startTime: start,
        endTime: end,
        ...(why.trim() ? { reason: why.trim() } : {}),
      }),
    onSuccess: () => {
      setWhy('');
      queryClient.invalidateQueries({ queryKey: ['time-blocks', locationId] });
    },
  });
  const saving = tab === 'whole' ? addClosure : addBreak;

  // A new day clears the last day's message, and on a narrow screen — where
  // this panel is under the calendar — brings it into view.
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(date);
  useEffect(() => {
    if (shown.current === date) return;
    shown.current = date;
    addClosure.reset();
    addBreak.reset();
    const box = root.current?.getBoundingClientRect();
    if (box && box.top > window.innerHeight * 0.7) root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saving.mutate();
  };

  return (
    <div className="cl-day" ref={root}>
      <p className="cl-step">
        <b>2</b> Change that day
        <span className="cl-step-hint">
          <Icon name="arrowRight" size={13} className="cl-hint-side" />
          <Icon name="chevronUp" size={13} className="cl-hint-up" />
          The day you picked
        </span>
      </p>

      <header className="cl-day-head" key={date}>
        <span className={`cl-day-tile${past ? ' is-past' : ''}`}>
          <em>{d.toLocaleDateString(undefined, { weekday: 'short' })}</em>
          <strong>{d.getDate()}</strong>
          <em>{d.toLocaleDateString(undefined, { month: 'short' })}</em>
        </span>
        <div>
          <h2>{d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          <p>
            {usual.open ? (
              <>
                <Icon name="clock" size={13} /> Usually open {usual.from} – {usual.to}
              </>
            ) : (
              <>
                <Icon name="moon" size={13} /> Usually closed on {DAY_NAMES[usual.weekday]}
              </>
            )}
          </p>
        </div>
      </header>

      <ul className="cl-on" aria-label="Changed on this day">
        {closure && (
          <li className={closure.isClosed ? 'tone-red' : 'tone-amber'}>
            <Icon name={closure.isClosed ? 'calendarX' : 'clock'} size={15} />
            <span>
              <strong>
                {closure.isClosed
                  ? 'Closed all day'
                  : `Open ${closure.customOpenTime} – ${closure.customCloseTime} instead`}
              </strong>
              {closure.reason && <em>{closure.reason}</em>}
            </span>
            <button
              type="button"
              className="cl-remove"
              disabled={remove.busy}
              onClick={() => remove.closure.mutate(closure.id)}
            >
              Remove
            </button>
          </li>
        )}
        {dayBreaks.map((b) => (
          <li key={b.id} className="tone-blue">
            <Icon name="timer" size={15} />
            <span>
              <strong>
                Break {b.startTime} – {b.endTime}
              </strong>
              {b.reason && <em>{b.reason}</em>}
            </span>
            <button type="button" className="cl-remove" disabled={remove.busy} onClick={() => remove.pause.mutate(b.id)}>
              Remove
            </button>
          </li>
        ))}
        {!closure && dayBreaks.length === 0 && (
          <li className="is-none">
            <Icon name={usual.open ? 'checkCircle' : 'info'} size={15} />
            <span>
              <strong>{usual.open ? 'Nothing changed' : 'Nothing changed — and usually shut'}</strong>
              <em>
                {usual.open
                  ? 'Customers can book this day as usual.'
                  : 'Customers cannot book it. “Open, but different hours” opens it just this once.'}
              </em>
            </span>
          </li>
        )}
      </ul>

      {past ? (
        <p className="cl-past-note">
          <Icon name="info" size={15} /> This day has passed. Pick today or a day ahead to change it.
        </p>
      ) : (
        <form className="cl-form" onSubmit={submit}>
          <div className="cl-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'whole'}
              className={tab === 'whole' ? 'is-on' : ''}
              onClick={() => setTab('whole')}
            >
              <Icon name="calendarX" size={16} />
              <span>
                <strong>The whole day</strong>
                <em>Close it, or change its hours</em>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'part'}
              className={tab === 'part' ? 'is-on' : ''}
              onClick={() => setTab('part')}
            >
              <Icon name="timer" size={16} />
              <span>
                <strong>Part of the day</strong>
                <em>Lunch, a meeting, a delivery</em>
              </span>
            </button>
          </div>

          {tab === 'whole' ? (
            <>
              {/* The server refuses a day that is both closed and has custom
                  hours, and one that is neither. Choosing one of two makes it
                  one or the other, so neither refusal can be reached. */}
              <div className="cl-choice" role="radiogroup" aria-label="What happens">
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'closed'}
                  className={mode === 'closed' ? 'is-on' : ''}
                  onClick={() => setMode('closed')}
                >
                  Closed all day
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'hours'}
                  className={mode === 'hours' ? 'is-on' : ''}
                  onClick={() => setMode('hours')}
                >
                  Open, but different hours
                </button>
              </div>
              {mode === 'hours' && (
                <div className="cl-row">
                  <label className="cl-field">
                    <span>Opens</span>
                    <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
                  </label>
                  <label className="cl-field">
                    <span>Closes</span>
                    <input type="time" value={close} onChange={(e) => setClose(e.target.value)} />
                  </label>
                </div>
              )}
            </>
          ) : (
            <div className="cl-row">
              <label className="cl-field">
                <span>From</span>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="cl-field">
                <span>Until</span>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
          )}

          <label className="cl-field">
            <span>
              Why <em>optional — customers do not see this</em>
            </span>
            <input
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              maxLength={200}
              placeholder={tab === 'whole' ? 'Public holiday' : 'Lunch'}
            />
          </label>

          {saving.error && (
            <p className="error small" role="alert">
              {saving.error instanceof ApiError ? saving.error.message : 'That did not save.'}
            </p>
          )}

          <div className="cl-submit">
            <span>
              {tab === 'whole' && closure
                ? 'This replaces what is set for this day now.'
                : tab === 'whole'
                  ? mode === 'closed'
                    ? `No bookings on ${niceDate(date)}.`
                    : `${niceDate(date)} · open ${open} to ${close}`
                  : `${niceDate(date)} · ${start} to ${end} taken out`}
            </span>
            <button type="submit" className="primary" disabled={saving.isPending}>
              {saving.isPending
                ? 'Saving…'
                : tab === 'part'
                  ? 'Add this break'
                  : closure
                    ? 'Change this day'
                    : mode === 'closed'
                      ? 'Close this day'
                      : 'Set these hours'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

type Entry = {
  id: string;
  kind: 'closure' | 'break';
  date: string;
  tone: 'red' | 'amber' | 'blue';
  title: string;
  reason: string | null;
};

/** Everything taken out at this branch, coming up first; each opens its day. */
function ComingUp({
  branch,
  closures,
  breaks,
  selected,
  onPick,
}: {
  branch: Location;
  closures: ScheduleException[];
  breaks: TimeBlock[];
  selected: string;
  onPick: (ymd: string) => void;
}) {
  const remove = useRemove(branch.id);
  const [showPast, setShowPast] = useState(false);

  const rows: Entry[] = [
    ...closures.map((c) => ({
      id: c.id,
      kind: 'closure' as const,
      date: c.date.slice(0, 10),
      tone: c.isClosed ? ('red' as const) : ('amber' as const),
      title: c.isClosed ? 'Closed all day' : `Open ${c.customOpenTime} – ${c.customCloseTime}`,
      reason: c.reason,
    })),
    ...breaks.map((b) => ({
      id: b.id,
      kind: 'break' as const,
      date: b.date.slice(0, 10),
      tone: 'blue' as const,
      title: `Break ${b.startTime} – ${b.endTime}`,
      reason: b.reason,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const coming = rows.filter((r) => !isPast(r.date));
  const past = rows.filter((r) => isPast(r.date)).reverse();

  const item = (row: Entry, old: boolean) => {
    const d = dayOf(row.date);
    return (
      <li
        key={row.id}
        className={`cl-entry tone-${row.tone}${old ? ' is-past' : ''}${row.date === selected ? ' is-picked' : ''}`}
      >
        <button type="button" className="cl-entry-open" onClick={() => onPick(row.date)} title="Open this day above">
          <span className="cl-date">
            <strong>{d.getDate()}</strong>
            <span>{d.toLocaleDateString(undefined, { month: 'short' })}</span>
          </span>
          <span className="cl-entry-text">
            <strong>{row.title}</strong>
            <span>
              {niceDate(row.date)}
              {row.reason && ` · ${row.reason}`}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="cl-remove"
          disabled={remove.busy}
          onClick={() => (row.kind === 'closure' ? remove.closure : remove.pause).mutate(row.id)}
        >
          Remove
        </button>
      </li>
    );
  };

  return (
    <article className="cl-list">
      <header>
        <div>
          <h2>Coming up at {branch.name}</h2>
          <p>
            {coming.length === 0
              ? 'Nothing taken out yet — every day follows your usual hours.'
              : `${coming.length} ${coming.length === 1 ? 'change' : 'changes'}. Click one to open its day above.`}
          </p>
        </div>
      </header>
      {coming.length > 0 && <ul>{coming.map((r) => item(r, false))}</ul>}
      {past.length > 0 && (
        <>
          <button type="button" className="cl-past-toggle" onClick={() => setShowPast((v) => !v)}>
            <Icon name={showPast ? 'chevronUp' : 'chevronDown'} size={16} />
            {showPast ? 'Hide past' : `Past (${past.length})`}
          </button>
          {showPast && <ul>{past.map((r) => item(r, true))}</ul>}
        </>
      )}
    </article>
  );
}
