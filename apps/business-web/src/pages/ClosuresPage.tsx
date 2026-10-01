import { useState, type FormEvent } from 'react';
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
  type ScheduleException,
  type TimeBlock,
} from '../api/business';

const today = () => new Date().toISOString().slice(0, 10);

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const isPast = (ymd: string) => ymd < today();

/**
 * Days that do not follow the usual week.
 *
 * Two mechanisms, deliberately kept apart on the page because they answer
 * different questions. A **closure** replaces a whole day — shut for a public
 * holiday, or open at different hours. A **break** removes a slice from an
 * otherwise normal day — lunch, a meeting, a delivery.
 *
 * Both already feed availability; this screen is the only part that was
 * missing, so a business could not close for a holiday without a developer.
 */
export function ClosuresPage() {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [selected, setSelected] = useState<string | null>(null);

  const branches = locations.data ?? [];
  const locationId = selected ?? branches[0]?.id ?? null;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Closures &amp; breaks</h1>
          <p className="muted">
            Days that do not follow your usual week. Customers cannot book the times
            you take out here.
          </p>
        </div>
        {branches.length > 1 && (
          <label className="inline small">
            Branch
            <select
              value={locationId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                  {!branch.isActive && ' (closed)'}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {locations.isLoading && <p className="muted">Loading…</p>}
      {branches.length === 0 && !locations.isLoading && (
        <p className="muted empty">Add a branch first, under Branches &amp; hours.</p>
      )}

      {locationId && (
        <>
          <Closures locationId={locationId} />
          <Breaks locationId={locationId} />
        </>
      )}
    </section>
  );
}

function Closures({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [open, setOpen] = useState('10:00');
  const [close, setClose] = useState('14:00');
  const [reason, setReason] = useState('');

  const key = ['exceptions', locationId];
  const exceptions = useQuery({ queryKey: key, queryFn: () => listExceptions(locationId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      createException(locationId, {
        date,
        ...(mode === 'closed'
          ? { isClosed: true }
          : { customOpenTime: open, customCloseTime: close }),
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

  const rows = exceptions.data ?? [];

  return (
    <div className="panel">
      <h2>Whole days</h2>
      <p className="muted small">
        Shut for a public holiday, or open at different hours just for one day. This
        replaces your usual hours for that date.
      </p>

      <form className="stack" onSubmit={submit}>
        <div className="two-up">
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            What happens
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as 'closed' | 'hours')}
            >
              <option value="closed">Closed all day</option>
              <option value="hours">Open, but different hours</option>
            </select>
          </label>
        </div>

        {/* The server refuses a day that is both closed and has custom hours,
            and refuses one that is neither. The radio above makes it one or
            the other, so neither refusal can be reached from here. */}
        {mode === 'hours' && (
          <div className="two-up">
            <label>
              Opens
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
            </label>
            <label>
              Closes
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)} />
            </label>
          </div>
        )}

        <label>
          Why <span className="muted small">(optional — customers do not see this)</span>
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

        <div className="row-end">
          <button type="submit" className="primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add this day'}
          </button>
        </div>
      </form>

      {rows.length > 0 && (
        <ul className="people">
          {rows.map((row) => (
            <ExceptionRow
              key={row.id}
              row={row}
              onDelete={() => drop.mutate(row.id)}
              busy={drop.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ExceptionRow({
  row,
  onDelete,
  busy,
}: {
  row: ScheduleException;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <li className={isPast(row.date) ? 'muted' : undefined}>
      <div>
        <strong>{niceDate(row.date)}</strong>
        <div className="small">
          {row.isClosed
            ? 'Closed all day'
            : `Open ${row.customOpenTime} to ${row.customCloseTime}`}
          {row.reason && ` · ${row.reason}`}
          {isPast(row.date) && ' · past'}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={onDelete}>
        Remove
      </button>
    </li>
  );
}

function Breaks({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today());
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [reason, setReason] = useState('');

  const key = ['time-blocks', locationId];
  const blocks = useQuery({ queryKey: key, queryFn: () => listTimeBlocks(locationId) });
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

  const rows = blocks.data ?? [];

  return (
    <div className="panel">
      <h2>Part of a day</h2>
      <p className="muted small">
        A lunch break, a meeting, a delivery. The rest of that day stays bookable.
      </p>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <div className="three-up">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            From
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Until
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label>
          Why <span className="muted small">(optional)</span>
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

        <div className="row-end">
          <button type="submit" className="primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add this break'}
          </button>
        </div>
      </form>

      {rows.length > 0 && (
        <ul className="people">
          {rows.map((row: TimeBlock) => (
            <li key={row.id} className={isPast(row.date) ? 'muted' : undefined}>
              <div>
                <strong>{niceDate(row.date)}</strong>
                <div className="small">
                  {row.startTime} to {row.endTime}
                  {row.reason && ` · ${row.reason}`}
                  {isPast(row.date) && ' · past'}
                </div>
              </div>
              <button
                type="button"
                disabled={drop.isPending}
                onClick={() => drop.mutate(row.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
