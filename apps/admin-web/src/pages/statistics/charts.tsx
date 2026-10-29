import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { Portal } from '../../ui/Portal';
import { MEANING, type MeaningKey } from '../../lib/statsWords';
import type { StatisticsBucket } from '../../api/admin';
import { asDay, monthWords } from './state';

/**
 * The statistics page's drawings (§316) — drawn here rather than by a chart
 * library, in the console's own look: the Overview's bars (§243), the
 * business app's ring (§201).
 */

// ---------------------------------------------------------------------------
// What a number counts

/** The ⓘ beside a number: what it counts, on hover, focus or a tap. */
export function Hint({ k, children }: { k: MeaningKey; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  // How the last press came: a mouse already opened it by hovering, so its
  // click keeps it open; a finger has no hover, so a tap opens and closes it.
  const pointer = useRef('mouse');
  const id = useId();
  // Where it floats: on the page itself, so no card's edge cuts it off, under
  // the ⓘ and kept inside the screen with a gutter either side.
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !box.current) return setAt(null);
    const place = () => {
      const r = box.current!.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 32);
      const left = Math.min(Math.max(16, r.left + r.width / 2 - width / 2), window.innerWidth - 16 - width);
      setAt({ top: r.bottom + 6, left, width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <span
      className={`st-hint${open ? ' is-open' : ''}`}
      ref={box}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      <button
        type="button"
        aria-label="What this counts"
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={() => setOpen((was) => (pointer.current === 'mouse' ? true : !was))}
        // Opened by the keyboard's focus only; a tap's focus would close what the tap opens.
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {children ?? <Icon name="info" size={14} stroke={2} />}
      </button>
      {open && at && (
        <Portal>
          <span className="st-hint-pop" role="tooltip" id={id} style={{ top: at.top, left: at.left, width: at.width }}>
            {MEANING[k]}
          </span>
        </Portal>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bars over time

/** How a bar's stretch is said: a day, a week's first and last days, a month. */
export function bucketWords(bar: Pick<StatisticsBucket, 'start' | 'end'>, bucket: 'day' | 'week' | 'month') {
  if (bucket === 'day') return asDay(bar.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (bucket === 'month') return monthWords(bar.start.slice(0, 7), true);
  const a = asDay(bar.start);
  const b = asDay(bar.end);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString(undefined, { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })}–${b.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
}

/** A round top for the grid: 1, 2, 5 or 10 times a power of ten, at least the largest bar. */
const niceTop = (max: number) => {
  if (max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max) ?? 10;
  return step * power;
};

export function Bars({
  bars,
  value,
  bucket,
  format,
  axis,
  label,
}: {
  bars: StatisticsBucket[] | null;
  value: (bar: StatisticsBucket) => number;
  bucket: 'day' | 'week' | 'month';
  format: (n: number) => string;
  /** The grid's figures, shorter than a tooltip's. */
  axis: (n: number) => string;
  label: string;
}) {
  const values = (bars ?? []).map(value);
  const top = niceTop(Math.max(0, ...values));
  const dense = (bars?.length ?? 0) > 40;
  const peak = values.length ? values.indexOf(Math.max(...values)) : -1;
  const last = (bars?.length ?? 0) - 1;
  // Labels under a few bars only, evenly, always the first and the last.
  const every = Math.max(1, Math.ceil((bars?.length ?? 1) / 7));
  return (
    <div className="st-plot" role="img" aria-label={label}>
      <div className="st-grid" aria-hidden="true">
        {[top, top / 2, 0].map((v) => (
          <span key={v}>
            <em>{axis(v)}</em>
          </span>
        ))}
      </div>
      <div className={`st-bars${dense ? ' is-dense' : ''}`}>
        {(bars ?? Array.from({ length: 14 }, () => null)).map((bar, i) => {
          const v = bar ? value(bar) : 0;
          return (
            <div key={bar?.start ?? i} className={`st-col${i === peak && v > 0 ? ' is-peak' : ''}${i === last ? ' is-last' : ''}`}>
              <div className="st-track">
                <div
                  className={`st-bar${v === 0 ? ' is-zero' : ''}`}
                  style={{ height: `${!bar ? 0 : v === 0 ? 0 : Math.max(4, (v / top) * 100)}%`, animationDelay: `${Math.min(i, 60) * 14}ms` }}
                />
                {bar && (
                  <span className="st-tip">
                    {format(v)}
                    <em>{bucketWords(bar, bucket)}</em>
                  </span>
                )}
              </div>
              <span className="st-x">{bar && (i % every === 0 || i === last) && !(i !== last && last - i < every) ? xLabel(bar, bucket) : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const xLabel = (bar: StatisticsBucket, bucket: 'day' | 'week' | 'month') =>
  asDay(bar.start).toLocaleDateString(undefined, bucket === 'month' ? { month: 'short' } : { day: 'numeric', month: 'short' });

/** A stat card's little bars: the shape of the stretch, no figures. */
export function Spark({ values, tone = 'light' }: { values: number[]; tone?: 'light' | 'dark' }) {
  const max = Math.max(1, ...values);
  const shown = values.length > 60 ? fold(values, 60) : values;
  return (
    <span className={`st-spark tone-${tone}`} aria-hidden="true">
      {shown.map((v, i) => (
        <i key={i} style={{ height: `${v ? Math.max(8, (v / max) * 100) : 4}%`, animationDelay: `${i * 10}ms` }} className={v ? '' : 'is-zero'} />
      ))}
    </span>
  );
}

/** Many values added into fewer, for a spark that has room for only so many. */
const fold = (values: number[], into: number) => {
  const size = Math.ceil(values.length / into);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
};

// ---------------------------------------------------------------------------
// Parts of a whole

export type Part = { key: string; label: string; value: number; color: string };

/** A ring of parts, with what sits in its middle. */
export function Ring({ parts, middle, under, size = 168 }: { parts: Part[]; middle: string; under: string; size?: number }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="st-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--sunken-2)" strokeWidth="15" />
        {total > 0 &&
          parts.map((p) => {
            if (!p.value) return null;
            const len = (p.value / total) * c;
            // A hair of a gap between parts, so two of a colour never merge.
            const arc = (
              <circle
                key={p.key}
                className="st-ring-arc"
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="15"
                strokeLinecap="butt"
                strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += len;
            return arc;
          })}
      </svg>
      <div className="st-ring-mid">
        <strong>{middle}</strong>
        <span>{under}</span>
      </div>
    </div>
  );
}

/** One long bar cut into its parts, for "how far ahead" and "first time or back". */
export function Split({ parts }: { parts: Part[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div className="st-split" aria-hidden="true">
      {total === 0 ? (
        <i style={{ flex: 1, background: 'var(--sunken-2)' }} />
      ) : (
        parts.map((p) => (p.value ? <i key={p.key} style={{ flex: p.value, background: p.color }} /> : null))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// When visits happen

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => asDay(`2026-10-${String(18 + d).padStart(2, '0')}`).toLocaleDateString(undefined, { weekday: 'short' }));

/** Weekday by hour, each cell as deep as its share of the busiest. */
export function Heat({ cells }: { cells: Array<{ weekday: number; hour: number; count: number }> }) {
  const busy = cells.filter((c) => c.count > 0);
  // The working day, widened to take in any hour that had a visit.
  const low = Math.min(7, ...busy.map((c) => c.hour));
  const high = Math.max(21, ...busy.map((c) => c.hour));
  const hours = Array.from({ length: high - low + 1 }, (_, i) => low + i);
  const max = Math.max(1, ...busy.map((c) => c.count));
  const at = (weekday: number, hour: number) => cells.find((c) => c.weekday === weekday && c.hour === hour)?.count ?? 0;
  const top = [...busy].sort((a, b) => b.count - a.count)[0];
  return (
    <div className="st-heat-wrap">
      <div className="st-heat" style={{ gridTemplateColumns: `38px repeat(${hours.length}, minmax(18px, 1fr))` }}>
        <span />
        {hours.map((h) => (
          <span key={h} className="st-heat-h">
            {h % 3 === 0 ? `${String(h).padStart(2, '0')}` : ''}
          </span>
        ))}
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <Row key={d} day={WEEKDAYS[d - 1]}>
            {hours.map((h) => {
              const n = at(d, h);
              return (
                <span
                  key={h}
                  className={`st-cell${n ? '' : ' is-empty'}${top && top.weekday === d && top.hour === h ? ' is-top' : ''}`}
                  style={n ? { ['--a' as string]: String(0.18 + 0.82 * (n / max)) } : undefined}
                  title={`${WEEKDAYS[d - 1]} ${String(h).padStart(2, '0')}:00 · ${n} ${n === 1 ? 'visit' : 'visits'}`}
                />
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ day, children }: { day: string; children: ReactNode }) {
  return (
    <>
      <span className="st-heat-d">{day}</span>
      {children}
    </>
  );
}

/** The busiest weekday and hour, said. */
export function busiest(cells: Array<{ weekday: number; hour: number; count: number }>) {
  const top = [...cells].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count === 0) return null;
  const day = asDay(`2026-10-${String(18 + top.weekday).padStart(2, '0')}`).toLocaleDateString(undefined, { weekday: 'long' });
  return `${day}s around ${String(top.hour).padStart(2, '0')}:00`;
}

// ---------------------------------------------------------------------------
// Ranked rows

/** Rows with a bar each, longest first, as long as their share of the first. */
export function Ranked({
  rows,
  empty,
}: {
  rows: Array<{ key: string; label: ReactNode; value: number; shown: string; sub?: string; color?: string; mark?: ReactNode }>;
  empty: string;
}) {
  if (rows.length === 0) return <p className="st-none">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="st-ranked">
      {rows.map((r, i) => (
        <li key={r.key} style={{ animationDelay: `${i * 40}ms` }}>
          {r.mark}
          <span className="st-ranked-body">
            <span className="st-ranked-top">
              <strong>{r.label}</strong>
              <b>{r.shown}</b>
            </span>
            <span className="st-ranked-track">
              <i style={{ width: `${r.value ? Math.max(3, (r.value / max) * 100) : 0}%`, ...(r.color ? { background: r.color } : {}) }} />
            </span>
            {r.sub && <em>{r.sub}</em>}
          </span>
        </li>
      ))}
    </ol>
  );
}
