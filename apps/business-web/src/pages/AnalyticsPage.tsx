import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAnalytics, getProfile, listLocations, type Analytics } from '../api/business';
import { useMoney } from '../money';
import { bookingsBetween, REAL_STATUSES } from '../lib/bookings';
import { addDays, sameDay, shortDay, startOfDay } from '../lib/time';
import { Icon, type IconName } from '../ui/Icon';
import { Stars } from '../ui/Stars';
import './analytics.css';
import { useAccess } from '../access';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dayName } from '../i18n/format';

/** Day names in the app's language (§308), Sunday first. */
const DAYS = () => [0, 1, 2, 3, 4, 5, 6].map((day) => dayName(day));

const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;

/** Last N days, as the ISO strings the endpoint takes. */
const since = (days: number, endDaysAgo = 0) => ({
  from: new Date(Date.now() - (days + endDaysAgo) * 86_400_000).toISOString(),
  to: new Date(Date.now() - endDaysAgo * 86_400_000).toISOString(),
});

const PERIODS = [
  {
    days: 7,
    get label() { return t`7 days`; },
  },
  {
    days: 30,
    get label() { return t`30 days`; },
  },
  {
    days: 90,
    get label() { return t`90 days`; },
  },
];

/**
 * How the business is doing (§96, §201).
 *
 * Every figure here is the server's, including the currency — the endpoint used
 * to report a hardcoded 'USD' while the amounts were RWF (§67.4, fixed in §96),
 * which is exactly the mistake a screen dividing by 100 would make. The chart
 * of bookings by day is counted from the server's list of bookings.
 *
 * Partial totals say so. `complete: false` means some appointments could not be
 * accounted for, and a number that quietly omits rows is the one a business
 * acts on and then stops trusting.
 */
export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [locationId, setLocationId] = useState('');
  const money = useMoney();
  const { allBranches } = useAccess();

  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const businessId = profile.data?.id;
  const branch = locationId ? { locationId } : {};

  const stats = useQuery({
    queryKey: ['analytics', businessId, days, locationId],
    queryFn: () => getAnalytics(businessId!, { ...since(days), ...branch }),
    enabled: Boolean(businessId),
  });
  // The same length of time just before, for "up 20% on the period before".
  const before = useQuery({
    queryKey: ['analytics', businessId, days, locationId, 'before'],
    queryFn: () => getAnalytics(businessId!, { ...since(days, days), ...branch }),
    enabled: Boolean(businessId),
  });
  const bookings = useQuery({
    queryKey: ['appointments', 'analytics-chart', days],
    queryFn: () => bookingsBetween(addDays(startOfDay(), -(days - 1)), addDays(startOfDay(), 1)),
  });

  const data = stats.data;
  const prev = before.data;

  const series = useMemo(() => {
    const today = startOfDay();
    const rows = (bookings.data ?? []).filter(
      (a) => REAL_STATUSES.includes(a.status) && (!locationId || a.location.id === locationId),
    );
    return Array.from({ length: days }, (_, i) => {
      const day = addDays(today, i - (days - 1));
      return { day, count: rows.filter((a) => sameDay(new Date(a.startTime), day)).length };
    });
  }, [bookings.data, days, locationId]);

  const branches = locations.data ?? [];

  return (
    <section className="an">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>How it is going</Trans></h1>
            <p className="muted"><Trans>Your bookings, your money and your ratings.</Trans></p>
          </div>
          <div className="an-period" role="tablist" aria-label={t`Period`}>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                role="tab"
                aria-selected={days === p.days}
                className={days === p.days ? 'is-on' : ''}
                onClick={() => setDays(p.days)}
              ><Trans>Last {p.label}</Trans>
              </button>
            ))}
          </div>
        </header>

        {branches.length > 1 && (
          <div className="bpills" role="tablist" aria-label={t`Branch`}>
            <button
              type="button"
              role="tab"
              aria-selected={locationId === ''}
              className={`bpill${locationId === '' ? ' is-active' : ''}`}
              onClick={() => setLocationId('')}
            >
              {/* A manager of some branches sees theirs, together (§277). */}
              <Icon name="layers" size={16} /> {allBranches ? t`All branches` : t`All your branches`}
            </button>
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={locationId === b.id}
                className={`bpill${locationId === b.id ? ' is-active' : ''}`}
                onClick={() => setLocationId(b.id)}
              >
                <Icon name="pin" size={16} /> {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {stats.isLoading && <div className="skeleton an-skeleton" />}

      {data && (
        <>
          <div className="an-top">
            <BookingsCard data={data} prev={prev} series={series} loading={bookings.isLoading} days={days} />
            <OutcomeCard data={data} />
          </div>

          <MoneyPanel data={data} format={money.format} />

          <div className="an-row">
            <Tile
              icon="star"
              tone="gold"
              label={t`Rating`}
              value={data.reviews.averageRating === null ? '—' : data.reviews.averageRating.toFixed(1)}
              hint={t`from ${data.reviews.count} reviews`}
              extra={data.reviews.averageRating !== null ? <Stars value={data.reviews.averageRating} size={15} /> : null}
            />
            <Tile
              icon="calendar"
              tone="blue"
              label={t`Busiest day`}
              value={data.busiest.dayOfWeek ? DAYS()[data.busiest.dayOfWeek.day] : '—'}
              hint={data.busiest.dayOfWeek ? t`${data.busiest.dayOfWeek.appointments} bookings` : undefined}
            />
            <Tile
              icon="clock"
              tone="coral"
              label={t`Busiest hour`}
              value={data.busiest.hour ? hourLabel(data.busiest.hour.hour) : '—'}
              hint={
                data.busiest.hour
                  ? t`${data.busiest.hour.appointments} bookings · ${data.busiest.timeZone}`
                  : undefined
              }
            />
          </div>
        </>
      )}
    </section>
  );
}

function BookingsCard({
  data,
  prev,
  series,
  loading,
  days,
}: {
  data: Analytics;
  prev: Analytics | undefined;
  series: Array<{ day: Date; count: number }>;
  loading: boolean;
  days: number;
}) {
  const total = data.appointments.total;
  const before = prev?.appointments.total;
  const change = before ? Math.round(((total - before) / before) * 100) : null;
  const max = Math.max(1, ...series.map((s) => s.count));
  const peak = series.reduce((best, s) => (s.count > best.count ? s : best), series[0] ?? { day: new Date(), count: 0 });
  const today = new Date();

  return (
    <article className="an-card an-bookings">
      <header>
        <span className="an-label">
          <Icon name="calendarCheck" size={16} />{' '}
          <Trans>Bookings</Trans>
        </span>
        {change !== null && (
          <span className={`an-trend ${change >= 0 ? 'is-up' : 'is-down'}`}>
            <Icon name={change >= 0 ? 'trendUp' : 'trendDown'} size={13} stroke={2.2} />
            {change >= 0 ? '+' : ''}
            <Trans>{change}% on the {days} days before</Trans>
          </span>
        )}
      </header>
      <strong className="an-big">{total}</strong>
      <p className="an-caption"><Trans>Bars: customers each day, not counting cancelled or unpaid bookings.</Trans></p>
      <div className="an-chart">
        {loading ? (
          <div className="skeleton an-chart-skel" />
        ) : (
          <div className={`an-bars${series.length > 40 ? ' is-dense' : ''}`} aria-label={t`Customers by day`}>
            {series.map((s, i) => (
              <span
                key={i}
                className={`an-bar${sameDay(s.day, today) ? ' is-today' : ''}${s.count === 0 ? ' is-zero' : ''}`}
                title={`${shortDay(s.day)} · ${s.count}`}
              >
                <i style={{ height: `${s.count ? Math.max(6, (s.count / max) * 100) : 0}%`, animationDelay: `${Math.min(i, 60) * 12}ms` }} />
              </span>
            ))}
          </div>
        )}
      </div>
      <footer className="an-chart-foot">
        <span>{series[0] ? shortDay(series[0].day) : ''}</span>
        {peak && peak.count > 0 && (
          <span className="an-peak"><Trans>Busiest: {shortDay(peak.day)} · {peak.count}</Trans>
          </span>
        )}
        <span><Trans>Today</Trans></span>
      </footer>
    </article>
  );
}

function OutcomeCard({ data }: { data: Analytics }) {
  const by = data.appointments.byStatus as Record<string, number | undefined>;
  const parts = [
    { key: 'done', label: t`Turned up`, value: by.COMPLETED ?? 0, rate: data.appointments.completionRate, color: '#0e9f54' },
    { key: 'noshow', label: t`Did not turn up`, value: by.NO_SHOW ?? 0, rate: data.appointments.noShowRate, color: '#c27803' },
    { key: 'cancelled', label: t`Cancelled`, value: by.CANCELLED ?? 0, rate: data.appointments.cancellationRate, color: '#d92d20' },
  ];
  const other = Math.max(0, data.appointments.total - parts.reduce((s, p) => s + p.value, 0));
  const total = Math.max(1, data.appointments.total);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = [...parts.map((p) => ({ v: p.value, color: p.color })), { v: other, color: '#e0dcd4' }].map((p) => {
    const len = (p.v / total) * c;
    const arc = { len, offset, color: p.color };
    offset += len;
    return arc;
  });

  return (
    <article className="an-card an-outcome">
      <span className="an-label">
        <Icon name="checkCircle" size={16} />{' '}
        <Trans>How bookings ended</Trans>
      </span>
      <div className="an-donut">
        <svg viewBox="0 0 140 140" width="150" height="150">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1eee8" strokeWidth="16" />
          {arcs.map((a, i) =>
            a.len > 0 ? (
              <circle
                key={i}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth="16"
                strokeDasharray={`${a.len} ${c - a.len}`}
                strokeDashoffset={-a.offset}
                transform="rotate(-90 70 70)"
              />
            ) : null,
          )}
        </svg>
        <div className="an-donut-mid">
          <strong>{data.appointments.completionRate === null ? '—' : `${Math.round(data.appointments.completionRate)}%`}</strong>
          <span><Trans>turned up</Trans></span>
        </div>
      </div>
      <ul className="an-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            {/* A rate is null when there is nothing to divide by. */}
            <strong>{p.rate === null ? '—' : `${p.rate}%`}</strong>
            <em>{p.value}</em>
          </li>
        ))}
        {other > 0 && (
          <li>
            <i style={{ background: '#e0dcd4' }} />
            <span><Trans>Still to come or unpaid</Trans></span>
            <strong />
            <em>{other}</em>
          </li>
        )}
      </ul>
    </article>
  );
}

function MoneyPanel({
  data,
  format,
}: {
  data: Analytics;
  format: (minor: number | null | undefined, code?: string | null) => string;
}) {
  const m = data.money;
  const deposits = m.collectedThroughPlatform.depositsMinor;
  const share = m.collectedThroughPlatform.businessShareOfDepositsMinor;
  const sharePct = deposits ? Math.round((share / deposits) * 100) : 0;

  return (
    <article className="an-card an-money">
      <header>
        <h2><Trans>Money</Trans></h2>
        <p><Trans>Deposits taken through the app, and what customers pay you directly.</Trans></p>
      </header>
      <div className="an-money-grid">
        <div className="an-money-main">
          <span><Trans>Deposits taken</Trans></span>
          <strong>{format(deposits, m.currency)}</strong>
          <em><Trans>across {m.collectedThroughPlatform.appointmentCount} bookings</Trans></em>
          <div className="an-split" aria-label={t`${sharePct}% yours, ${100 - sharePct}% platform fees`}>
            <i style={{ width: `${sharePct}%` }} />
          </div>
          <div className="an-split-legend">
            <span>
              <Trans><b className="is-you" />Your share {format(share, m.currency)}</Trans>
            </span>
            <span>
              <Trans><b className="is-fee" />Platform fees {format(m.platformFeesPaidMinor, m.currency)}</Trans>
            </span>
          </div>
        </div>
        <div className="an-money-side">
          <Icon name="banknote" size={22} />
          <span><Trans>Owed by customers</Trans></span>
          <strong>{format(m.balanceOwedToBusiness.amountMinor, m.currency)}</strong>
          <em><Trans>paid to you directly, not through us</Trans></em>
        </div>
      </div>
      {/* Surfaced, not hidden: a partial total that does not announce itself
          is the number a business acts on and then stops trusting. */}
      {!m.collectedThroughPlatform.complete && <p className="notice small">{m.collectedThroughPlatform.note}</p>}
      {!m.balanceOwedToBusiness.complete && <p className="notice small">{m.balanceOwedToBusiness.note}</p>}
    </article>
  );
}

function Tile({
  icon,
  tone,
  label,
  value,
  hint,
  extra,
}: {
  icon: IconName;
  tone: 'gold' | 'blue' | 'coral';
  label: string;
  value: string;
  hint?: string;
  extra?: React.ReactNode;
}) {
  return (
    <article className={`an-tile tone-${tone}`}>
      <span className="an-tile-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="an-tile-label">{label}</span>
      <strong>{value}</strong>
      {extra}
      {hint && <span className="an-tile-hint">{hint}</span>}
    </article>
  );
}
