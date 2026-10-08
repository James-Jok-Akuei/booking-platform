import { useMemo, useState, type FormEvent } from 'react';
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
import { Icon } from '../ui/Icon';
import './closures.css';

/** A local calendar day as YYYY-MM-DD — the seller's today, not UTC's. */
const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymdOf(new Date());

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const isPast = (ymd: string) => ymd < today();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Days that do not follow the usual week (§102, §195).
 *
 * Two mechanisms, deliberately kept apart on the page because they answer
 * different questions. A **closure** replaces a whole day — shut for a public
 * holiday, or open at different hours. A **break** removes a slice from an
 * otherwise normal day — lunch, a meeting, a delivery.
 *
 * A month calendar shows both, with the days the branch is normally shut
 * hatched; picking a day on it fills in the date in both forms.
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
            Days that do not follow your usual week. Customers cannot book the times you take out here.
          </p>
        </div>
      </header>

      {branches.length > 1 && (
        <div className="cl-branches" role="tablist" aria-label="Branch">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === locationId}
              className={`cl-branch${b.id === locationId ? ' is-active' : ''}`}
              onClick={() => setSelected(b.id)}
            >
              <Icon name="pin" size={16} />
              {b.name}
              {!b.isActive && <em>closed</em>}
            </button>
          ))}
        </div>
      )}

      {locations.isLoading && <div className="skeleton cl-skeleton" />}
      {branches.length === 0 && !locations.isLoading && (
        <div className="cl-empty">
          <Icon name="pin" size={26} />
          <p>Add a branch first, under Branches &amp; hours.</p>
        </div>
      )}

      {locationId && branch && (
        <div className="cl-layout">
          <MonthCalendar
            branch={branch}
            closures={exceptions.data ?? []}
            breaks={blocks.data ?? []}
            selected={date}
            onSelect={setDate}
          />
          <div className="cl-forms">
            <Closures
              key={`c-${locationId}`}
              locationId={locationId}
              rows={exceptions.data ?? []}
              date={date}
              onDate={setDate}
            />
            <Breaks
              key={`b-${locationId}`}
              locationId={locationId}
              rows={blocks.data ?? []}
              date={date}
              onDate={setDate}
            />
          </div>
        </div>
      )}
    </section>
  );
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
    const d = new Date(`${selected}T12:00:00`);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

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
  // A day with no saved hours is shut too (§12.4).
  for (let d = 0; d < 7; d++) if (!branch.hours.some((h) => h.dayOfWeek === d)) weeklyOff.add(d);

  const now = today();
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const upcoming = closures.filter((c) => !isPast(c.date.slice(0, 10))).length + breaks.filter((b) => !isPast(b.date.slice(0, 10))).length;

  return (
    <article className="cal">
      <header className="cal-head">
        <div>
          <h2>{label}</h2>
          <p>{upcoming === 0 ? 'Nothing taken out yet' : `${upcoming} coming up at ${branch.name}`}</p>
        </div>
        <div className="cal-nav">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
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
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
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
            <button key={ymd} type="button" className={cls} onClick={() => onSelect(ymd)} title={title} aria-pressed={ymd === selected}>
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
    </article>
  );
}

function Closures({
  locationId,
  rows,
  date,
  onDate,
}: {
  locationId: string;
  rows: ScheduleException[];
  date: string;
  onDate: (ymd: string) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [open, setOpen] = useState('10:00');
  const [close, setClose] = useState('14:00');
  const [reason, setReason] = useState('');

  const key = ['exceptions', locationId];
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      createException(locationId, {
        date,
        ...(mode === 'closed' ? { isClosed: true } : { customOpenTime: open, customCloseTime: close }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      setReason('');
      refresh();
    },
  });

  const drop = useMutation({
    mutationFn: (id: string) => deleteException(locationId, id),
    onSuccess: refresh,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <article className="cl-card">
      <header className="cl-card-head">
        <span className="cl-card-icon is-red">
          <Icon name="calendarX" size={20} />
        </span>
        <div>
          <h2>Whole days</h2>
          <p>
            Shut for a public holiday, or open at different hours just for one day. This replaces your
            usual hours for that date.
          </p>
        </div>
      </header>

      <form className="cl-form" onSubmit={submit}>
        <div className="cl-row">
          <label className="cl-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => onDate(event.target.value)} />
          </label>
          {/* The server refuses a day that is both closed and has custom hours,
              and refuses one that is neither. Choosing one of two makes it one
              or the other, so neither refusal can be reached from here. */}
          <div className="cl-field">
            <span>What happens</span>
            <div className="cl-choice" role="radiogroup">
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
          </div>
        </div>

        {mode === 'hours' && (
          <div className="cl-row cl-times">
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

        <label className="cl-field">
          <span>
            Why <em>optional — customers do not see this</em>
          </span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="Public holiday"
          />
        </label>

        {add.error && (
          <p className="error small" role="alert">
            {add.error instanceof ApiError ? add.error.message : 'That did not save.'}
          </p>
        )}

        <div className="cl-submit">
          <span>{niceDate(date)}</span>
          <button type="submit" className="primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add this day'}
          </button>
        </div>
      </form>

      <EntryList
        rows={rows.map((row) => ({
          id: row.id,
          date: row.date.slice(0, 10),
          tone: row.isClosed ? 'red' : 'amber',
          title: row.isClosed ? 'Closed all day' : `Open ${row.customOpenTime} to ${row.customCloseTime}`,
          reason: row.reason,
        }))}
        busy={drop.isPending}
        onRemove={(id) => drop.mutate(id)}
        onPick={onDate}
      />
    </article>
  );
}

function Breaks({
  locationId,
  rows,
  date,
  onDate,
}: {
  locationId: string;
  rows: TimeBlock[];
  date: string;
  onDate: (ymd: string) => void;
}) {
  const queryClient = useQueryClient();
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [reason, setReason] = useState('');

  const key = ['time-blocks', locationId];
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      createTimeBlock(locationId, {
        date,
        startTime: start,
        endTime: end,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      setReason('');
      refresh();
    },
  });

  const drop = useMutation({
    mutationFn: (id: string) => deleteTimeBlock(locationId, id),
    onSuccess: refresh,
  });

  return (
    <article className="cl-card">
      <header className="cl-card-head">
        <span className="cl-card-icon is-blue">
          <Icon name="timer" size={20} />
        </span>
        <div>
          <h2>Part of a day</h2>
          <p>A lunch break, a meeting, a delivery. The rest of that day stays bookable.</p>
        </div>
      </header>

      <form
        className="cl-form"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <div className="cl-row cl-three">
          <label className="cl-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => onDate(e.target.value)} />
          </label>
          <label className="cl-field">
            <span>From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="cl-field">
            <span>Until</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label className="cl-field">
          <span>
            Why <em>optional</em>
          </span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="Lunch"
          />
        </label>

        {add.error && (
          <p className="error small" role="alert">
            {add.error instanceof ApiError ? add.error.message : 'That did not save.'}
          </p>
        )}

        <div className="cl-submit">
          <span>
            {niceDate(date)} · {start} to {end}
          </span>
          <button type="submit" className="primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add this break'}
          </button>
        </div>
      </form>

      <EntryList
        rows={rows.map((row) => ({
          id: row.id,
          date: row.date.slice(0, 10),
          tone: 'blue',
          title: `${row.startTime} to ${row.endTime}`,
          reason: row.reason,
        }))}
        busy={drop.isPending}
        onRemove={(id) => drop.mutate(id)}
        onPick={onDate}
      />
    </article>
  );
}

/** What is already taken out: coming up first, past ones folded away. */
function EntryList({
  rows,
  busy,
  onRemove,
  onPick,
}: {
  rows: Array<{ id: string; date: string; tone: 'red' | 'amber' | 'blue'; title: string; reason: string | null }>;
  busy: boolean;
  onRemove: (id: string) => void;
  onPick: (ymd: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const coming = sorted.filter((r) => !isPast(r.date));
  const past = sorted.filter((r) => isPast(r.date)).reverse();
  if (rows.length === 0) return null;

  const item = (row: (typeof rows)[number], old: boolean) => {
    const d = new Date(`${row.date}T12:00:00`);
    return (
      <li key={row.id} className={`cl-entry tone-${row.tone}${old ? ' is-past' : ''}`}>
        <button type="button" className="cl-date" onClick={() => onPick(row.date)} title="Show on the calendar">
          <strong>{d.getDate()}</strong>
          <span>{d.toLocaleDateString(undefined, { month: 'short' })}</span>
        </button>
        <div className="cl-entry-text">
          <strong>{row.title}</strong>
          <span>
            {niceDate(row.date)}
            {row.reason && ` · ${row.reason}`}
            {old && ' · past'}
          </span>
        </div>
        <button type="button" className="cl-remove" disabled={busy} onClick={() => onRemove(row.id)}>
          Remove
        </button>
      </li>
    );
  };

  return (
    <div className="cl-entries">
      {coming.length > 0 ? (
        <ul>{coming.map((r) => item(r, false))}</ul>
      ) : (
        <p className="cl-none">Nothing coming up.</p>
      )}
      {past.length > 0 && (
        <>
          <button type="button" className="cl-past-toggle" onClick={() => setShowPast((v) => !v)}>
            <Icon name={showPast ? 'chevronUp' : 'chevronDown'} size={16} />
            {showPast ? 'Hide past' : `Past (${past.length})`}
          </button>
          {showPast && <ul>{past.map((r) => item(r, true))}</ul>}
        </>
      )}
    </div>
  );
}
