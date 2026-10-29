import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStatisticsLeftOut,
  markTestCustomer,
  markTestShop,
  type StatisticsBucket,
  type StatisticsMoneyCheck,
  type StatisticsMonths,
  type StatisticsPeriod,
  type StatisticsSlice,
  type StatisticsSummary,
  type StatisticsTopShop,
  type StatisticsTotals,
} from '../../api/admin';
import { useMoney } from '../../money';
import { Icon, type IconName } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { Panel } from '../../ui/Panel';
import { ShopMark } from '../../ui/ShopMark';
import { Stars } from '../../ui/Stars';
import { categoryLook } from '../../ui/CategoryMark';
import { MEANING, markedWords as by, type MeaningKey } from '../../lib/statsWords';
import { Bars, Heat, Hint, Ranked, Ring, Spark, Split, busiest, type Part } from './charts';
import { download, statisticsCsv } from './csv';
import {
  PERIODS,
  change,
  dayWords,
  monthWords,
  share,
  useCountUp,
  useScopeChoices,
  useStatistics,
  useStatsView,
  type StatsView,
} from './state';
import './statistics.css';

/** Money as the page says it: in full, or shortened for a card ("RWF 18.6M"). */
function useFigures() {
  const money = useMoney();
  const major = (minor: number) => minor / 10 ** money.exponent;
  const compactNumber = (n: number) =>
    Math.abs(n) >= 100_000 ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString();
  return {
    money,
    full: (minor: number | null | undefined) => money.format(minor),
    short: (minor: number | null | undefined) => (minor === null || minor === undefined ? '—' : `${money.code} ${compactNumber(major(minor))}`.trim()),
    /** A grid figure: no money word, shortened. */
    axis: (minor: number) => compactNumber(Math.round(major(minor))),
    count: (n: number) => n.toLocaleString(),
    compactCount: compactNumber,
  };
}
type Figures = ReturnType<typeof useFigures>;

/**
 * The console's statistics (§316): the whole platform added up — every shop
 * and every customer — over any stretch of time, for pitching and for seeing
 * how the business is doing.
 *
 * Every number comes from the server's counts (`/admin/statistics/*`), each
 * with an ⓘ saying exactly what it counts (`lib/statsWords.ts`). Test
 * accounts are left out unless asked for; the money check says when the
 * bookings and the money book disagree.
 */
export function StatisticsPage() {
  const view = useStatsView();
  const { summary, period, months } = useStatistics(view);
  const fig = useFigures();
  const choices = useScopeChoices();
  const [leftOut, setLeftOut] = useState(false);

  const s = summary.data;
  const p = period.data;
  const mo = months.data;
  const error = summary.error ?? period.error ?? months.error;
  const scopeWords = useScopeWords(view, choices);

  const onDownload = () => {
    if (!s || !p || !mo) return;
    download(
      `statistics-${p.from}-to-${p.to}.csv`,
      statisticsCsv({ summary: s, period: p, months: mo, exponent: fig.money.exponent, scopeWords: `${periodWords(view, p)} · ${scopeWords}` }),
    );
  };

  const pitchQuery = new URLSearchParams(
    Object.entries({ country: view.scope.country, category: view.scope.category, district: view.scope.district }).filter(
      (entry): entry is [string, string] => !!entry[1],
    ),
  ).toString();

  return (
    <section className="st">
      <div className="page-top">
        <header className="st-head">
          <div>
            <p className="st-eyebrow">
              <Icon name="chart" size={15} />
              Statistics
              {s && <span>Counted {new Date(s.asOf).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
            <h1>
              The numbers<span>.</span>
            </h1>
            <p className="st-sentence">
              {!s
                ? 'Counting every booking on the platform…'
                : s.bookings === 0
                  ? 'No bookings yet — every number here fills in from the first one.'
                  : `Since ${dayWords(s.since!, true)}: ${fig.count(s.bookings)} ${s.bookings === 1 ? 'booking' : 'bookings'} worth ${fig.full(
                      s.bookingValueMinor,
                    )}, and ${fig.full(s.madeMinor)} made by the platform.`}
            </p>
          </div>
          <div className="st-head-actions">
            <Link to={`/statistics/pitch${pitchQuery ? `?${pitchQuery}` : ''}`} className="st-btn is-quiet">
              <Icon name="sparkles" size={17} />
              Pitch sheet
            </Link>
            <button type="button" className="st-btn is-dark" disabled={!s || !p || !mo} onClick={onDownload}>
              <Icon name="download" size={17} />
              Download
            </button>
          </div>
        </header>
        <Filters view={view} choices={choices} summary={s} onLeftOut={() => setLeftOut(true)} />
      </div>

      {error && (
        <p className="notice st-notice" role="alert">
          <Icon name="alert" size={16} />
          The numbers could not be counted just now. {error instanceof Error ? error.message : ''}
        </p>
      )}

      <MoneyCheckWarning checks={[s?.check, p?.check]} fig={fig} />

      <Hero s={s} fig={fig} />

      <div className="st-section-row">
        <h2 className="st-section">{p ? periodWords(view, p) : 'This stretch'}</h2>
        {p?.compared && <span className="st-section-note">Each figure against the {p.days} days before</span>}
      </div>
      <Kpis p={p} fig={fig} />
      <TrendCard p={p} fig={fig} />

      <div className="st-cols">
        <OutcomesCard p={p} />
        <MoneyCard p={p} fig={fig} />
      </div>
      <div className="st-cols is-wide-first">
        <WhenCard p={p} />
        <AheadCard p={p} />
      </div>

      <h2 className="st-section">Customers and shops</h2>
      <div className="st-cols">
        <CustomersCard p={p} s={s} />
        <ShopsCard p={p} />
      </div>
      <TopShopsCard p={p} fig={fig} />
      <div className="st-cols">
        <SliceCard
          title="By category"
          hint="byCategory"
          rows={p?.shops.byCategory ?? null}
          fig={fig}
          color={(row) => categoryLook(choices.categories.find((c) => c.id === row.id)?.icon).ink}
        />
        <SliceCard title="By district" hint="byDistrict" rows={p?.shops.byDistrict ?? null} fig={fig} />
      </div>

      <h2 className="st-section">What people want</h2>
      <div className="st-cols is-wide-first">
        <SearchesCard p={p} />
        <ServicesCard p={p} />
      </div>

      <h2 className="st-section">Month by month</h2>
      <MonthsCard mo={mo} fig={fig} />
      <CohortsCard mo={mo} />

      {leftOut && <LeftOutPanel onClose={() => setLeftOut(false)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The stretch and the part of the platform

/** "The 30 days to 29 Oct", "Since 4 Oct 2026", "1 Oct – 15 Oct 2026". */
function periodWords(view: StatsView, p: StatisticsPeriod) {
  if (view.period === 'all') return `Since ${dayWords(p.from, true)}`;
  if (view.period === 'custom') return p.from === p.to ? dayWords(p.from, true) : `${dayWords(p.from)} – ${dayWords(p.to, true)}`;
  return `The ${PERIODS.find((x) => x.key === view.period)?.label.toLowerCase()} to ${dayWords(p.to)}`;
}

function useScopeWords(view: StatsView, choices: ReturnType<typeof useScopeChoices>) {
  const parts: string[] = [];
  const country = view.countries.find((c) => c.code === view.scope.country);
  const category = choices.categories.find((c) => c.id === view.scope.category);
  const district = choices.provinces.flatMap((p) => p.districts).find((d) => d.id === view.scope.district);
  parts.push(country ? country.name : 'Every country');
  if (category) parts.push(category.name);
  if (district) parts.push(district.name);
  parts.push(view.scope.includeTest ? 'test accounts counted' : 'test accounts left out');
  return parts.join(' · ');
}

function Filters({
  view,
  choices,
  summary,
  onLeftOut,
}: {
  view: StatsView;
  choices: ReturnType<typeof useScopeChoices>;
  summary: StatisticsSummary | undefined;
  onLeftOut: () => void;
}) {
  const provinces = choices.provinces.filter((p) => !view.scope.country || p.countryCode === view.scope.country);
  const left = summary?.leftOut;
  return (
    <div className="st-filters pin-from">
      <div className="st-periods pin-phone" role="tablist" aria-label="Which stretch of time">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={view.period === p.key}
            className={view.period === p.key ? 'is-on' : ''}
            onClick={() => view.set({ period: p.key === '30d' ? null : p.key })}
          >
            {p.key === 'custom' && <Icon name="calendar" size={14} />}
            {p.label}
          </button>
        ))}
      </div>
      {view.period === 'custom' && (
        <div className="st-dates">
          <label>
            <span>From</span>
            <input type="date" value={view.customFrom} max={view.today} onChange={(e) => e.target.value && view.set({ from: e.target.value })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={view.customTo} max={view.today} onChange={(e) => e.target.value && view.set({ to: e.target.value })} />
          </label>
        </div>
      )}
      <div className="st-narrow">
        {view.countries.length > 1 && (
          <Select
            value={view.scope.country ?? ''}
            onChange={(code) => view.set({ country: code || null, district: null })}
            icon="globe"
            label="Country"
            options={[{ value: '', label: 'Every country' }, ...view.countries.map((c) => ({ value: c.code, label: c.name }))]}
          />
        )}
        <Select
          value={view.scope.category ?? ''}
          onChange={(id) => view.set({ category: id || null })}
          icon="layers"
          label="Category"
          searchable
          options={[
            { value: '', label: 'Every category' },
            ...[...choices.categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          value={view.scope.district ?? ''}
          onChange={(id) => view.set({ district: id || null })}
          icon="pin"
          label="Area"
          searchable
          options={[
            { value: '', label: 'Every area' },
            ...provinces.flatMap((p) => p.districts.map((d) => ({ value: d.id, label: d.name, group: p.name }))),
          ]}
        />
        <div className="st-test">
          <Switch checked={!!view.scope.includeTest} onChange={(on) => view.set({ test: on ? '1' : null })} label="Count test accounts too" />
          <span>
            <strong>Test accounts</strong>
            <button type="button" onClick={onLeftOut}>
              {left ? `${left.shops} ${left.shops === 1 ? 'shop' : 'shops'}, ${left.customers} ${left.customers === 1 ? 'customer' : 'customers'}` : '…'}
              {view.scope.includeTest ? ' counted' : ' left out'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Whether the money adds up

function MoneyCheckWarning({ checks, fig }: { checks: Array<StatisticsMoneyCheck | undefined>; fig: Figures }) {
  const bad = checks.find((c) => c && !c.ok);
  if (!bad) return null;
  return (
    <div className="st-warn" role="alert">
      <Icon name="alert" size={20} />
      <span>
        <strong>The bookings and the money book disagree, so some numbers here may be off.</strong>
        Deposits on the bookings: {fig.full(bad.bookingDepositsMinor)}; in the money book: {fig.full(bad.ledgerDepositsMinor)}. Fees on the bookings:{' '}
        {fig.full(bad.bookingFeesMinor)}; in the money book: {fig.full(bad.ledgerFeesMinor)}.
        {bad.missingEntries > 0 && ` ${bad.missingEntries} paid ${bad.missingEntries === 1 ? 'booking has' : 'bookings have'} no deposit entry at all.`}
        <Link to="/ledger">Open the money book</Link>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All time

function Hero({ s, fig }: { s: StatisticsSummary | undefined; fig: Figures }) {
  const made = useCountUp(s?.madeMinor);
  return (
    <article className="st-hero">
      <div className="st-hero-glow" aria-hidden="true" />
      <div className="st-hero-main">
        <span className="st-chip">All time</span>
        <span className="st-hero-label">
          <Icon name="coins" size={18} />
          Made by the platform
          <Hint k="made" />
        </span>
        <strong className="st-hero-value">{s && made !== null ? fig.full(made) : <span className="skeleton st-skel-big" />}</strong>
        <span className="st-hero-sub">
          {s ? (s.since ? `Platform fees kept since ${dayWords(s.since, true)}, every fee handed back already taken off.` : 'Nothing yet — from the first booking.') : ' '}
        </span>
        {s && (
          <span className={`st-hero-check${s.check.ok ? '' : ' is-bad'}`}>
            <Icon name={s.check.ok ? 'checkCircle' : 'alert'} size={15} />
            {s.check.ok ? `Matches the money book, ${fig.count(s.check.bookings)} bookings checked` : 'Does not match the money book'}
            <Hint k="check" />
          </span>
        )}
      </div>
      <dl className="st-hero-grid">
        <HeroFigure icon="calendarCheck" label="Bookings" hint="bookings" value={s ? fig.count(s.bookings) : null} />
        <HeroFigure icon="banknote" label="Booking value" hint="bookingValue" value={s ? fig.short(s.bookingValueMinor) : null} title={s ? fig.full(s.bookingValueMinor) : undefined} />
        <HeroFigure
          icon="users"
          label="Customers who booked"
          hint="customersWhoBooked"
          value={s ? fig.count(s.customersWhoBooked) : null}
          sub={s ? `${share(s.cameBack, s.customersWhoBooked)} booked again` : undefined}
        />
        <HeroFigure icon="store" label="Live shops" hint="liveShops" value={s ? fig.count(s.liveShops) : null} sub={s ? `${s.areas} ${s.areas === 1 ? 'area' : 'areas'} · ${s.openBranches} branches` : undefined} />
        <HeroFigure
          icon="star"
          label="Rating"
          hint="rating"
          value={s ? (s.rating.average === null ? '—' : s.rating.average.toFixed(1)) : null}
          sub={s ? `${s.rating.count} ${s.rating.count === 1 ? 'review' : 'reviews'}` : undefined}
        />
        <HeroFigure icon="user" label="Customers" hint="customers" value={s ? fig.count(s.customers) : null} sub="accounts open" />
      </dl>
    </article>
  );
}

function HeroFigure({ icon, label, hint, value, sub, title }: { icon: IconName; label: string; hint: MeaningKey; value: string | null; sub?: string; title?: string }) {
  return (
    <div className="st-hero-fig" title={title}>
      <dt>
        <Icon name={icon} size={15} />
        {label}
        <Hint k={hint} />
      </dt>
      <dd>{value ?? <span className="skeleton st-skel" />}</dd>
      {sub && <em>{sub}</em>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The stretch's figures

type Metric = {
  key: string;
  label: string;
  icon: IconName;
  hint: MeaningKey;
  total: (t: StatisticsTotals) => number | null;
  bar: (b: StatisticsBucket) => number;
  money: boolean;
};

const METRICS: Metric[] = [
  { key: 'bookings', label: 'Bookings', icon: 'calendarCheck', hint: 'bookings', total: (t) => t.bookings, bar: (b) => b.bookings, money: false },
  { key: 'value', label: 'Booking value', icon: 'banknote', hint: 'bookingValue', total: (t) => t.bookingValueMinor, bar: (b) => b.bookingValueMinor, money: true },
  { key: 'fees', label: 'Platform fees kept', icon: 'coins', hint: 'feesKept', total: (t) => t.feesKeptMinor, bar: (b) => b.feesKeptMinor, money: true },
  { key: 'deposits', label: 'Deposits', icon: 'wallet', hint: 'deposits', total: (t) => t.depositsMinor, bar: (b) => b.depositsMinor, money: true },
  { key: 'customers', label: 'New customers', icon: 'user', hint: 'newCustomers', total: (t) => t.newCustomers, bar: (b) => b.newCustomers, money: false },
  { key: 'shops', label: 'Shops went live', icon: 'store', hint: 'shopsWentLive', total: (t) => t.shopsWentLive, bar: (b) => b.shopsWentLive, money: false },
];

function Kpis({ p, fig }: { p: StatisticsPeriod | undefined; fig: Figures }) {
  return (
    <div className="st-kpis">
      {METRICS.map((m, i) => (
        <Kpi key={m.key} metric={m} p={p} fig={fig} accent={i === 0} index={i} />
      ))}
    </div>
  );
}

function Kpi({ metric, p, fig, accent, index }: { metric: Metric; p: StatisticsPeriod | undefined; fig: Figures; accent: boolean; index: number }) {
  const total = p ? metric.total(p.totals) : null;
  const before = p?.previous ? metric.total(p.previous) : null;
  const shown = useCountUp(total);
  const trend = p?.compared ? change(total, before) : null;
  const say = (n: number | null) => (n === null ? '—' : metric.money ? fig.short(n) : fig.count(n));
  return (
    <div className={`st-kpi${accent ? ' is-accent' : ''}`} style={{ animationDelay: `${index * 50}ms` }} title={metric.money && total !== null ? fig.full(total) : undefined}>
      <span className="st-kpi-top">
        <span className="st-kpi-icon">
          <Icon name={metric.icon} size={18} />
        </span>
        {trend && <span className={`st-trend is-${trend.tone}`}>{trend.tone !== 'flat' && <Icon name={trend.tone === 'up' ? 'trendUp' : 'trendDown'} size={12} stroke={2.4} />}{trend.words}</span>}
      </span>
      <span className="st-kpi-label">
        {metric.label}
        <Hint k={metric.hint} />
      </span>
      <strong className="st-kpi-value">{p ? say(shown) : <span className="skeleton st-skel" />}</strong>
      <span className="st-kpi-sub">{p?.compared ? `${say(before)} the ${p.days} days before` : p ? 'Since the beginning' : ' '}</span>
      {p && <Spark values={p.series.map(metric.bar)} tone={accent ? 'dark' : 'light'} />}
    </div>
  );
}

function TrendCard({ p, fig }: { p: StatisticsPeriod | undefined; fig: Figures }) {
  const [key, setKey] = useState(METRICS[0].key);
  const metric = METRICS.find((m) => m.key === key)!;
  const by = p?.bucket ?? 'day';
  const total = p ? metric.total(p.totals) : null;
  return (
    <article className="st-card st-trend-card">
      <header className="st-card-head">
        <div>
          <h3>{by === 'day' ? 'Day by day' : by === 'week' ? 'Week by week' : 'Month by month'}</h3>
          <p>
            {total === null ? ' ' : metric.money ? fig.full(total) : `${fig.count(total)} ${metric.label.toLowerCase()}`}
            {p?.previous && total !== null && (
              <span className="st-muted">
                {' '}
                · {metric.money ? fig.full(metric.total(p.previous)) : fig.count(metric.total(p.previous) ?? 0)} the {p.days} days before
              </span>
            )}
          </p>
        </div>
        <div className="st-tabs" role="tablist" aria-label="What the bars show">
          {METRICS.map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={m.key === key} className={m.key === key ? 'is-on' : ''} onClick={() => setKey(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </header>
      <Bars
        bars={p?.series ?? null}
        value={metric.bar}
        bucket={by}
        format={(n) => (metric.money ? fig.full(n) : `${fig.count(n)} ${metric.label.toLowerCase()}`)}
        axis={(n) => (metric.money ? fig.axis(n) : fig.compactCount(n))}
        label={`${metric.label}, ${by === 'day' ? 'day by day' : by === 'week' ? 'week by week' : 'month by month'}`}
      />
    </article>
  );
}

function Card({ title, hint, sub, children, className = '', aside }: { title: string; hint?: MeaningKey; sub?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <article className={`st-card ${className}`}>
      <header className="st-card-head">
        <div>
          <h3>
            {title}
            {hint && <Hint k={hint} />}
          </h3>
          {sub && <p>{sub}</p>}
        </div>
        {aside}
      </header>
      {children}
    </article>
  );
}

const Loading = () => <div className="skeleton st-skel-card" />;

function OutcomesCard({ p }: { p: StatisticsPeriod | undefined }) {
  if (!p)
    return (
      <Card title="How bookings ended" hint="outcomes">
        <Loading />
      </Card>
    );
  const o = p.bookings.outcomes;
  const parts: Part[] = [
    { key: 'done', label: 'Done', value: o.done, color: 'var(--ok)' },
    { key: 'upcoming', label: 'Still to come', value: o.upcoming, color: 'var(--ask)' },
    { key: 'missed', label: 'Did not turn up', value: o.missed, color: 'var(--warn)' },
    { key: 'customer', label: 'Cancelled by the customer', value: o.cancelledByCustomer, color: 'var(--accent)' },
    { key: 'shop', label: 'Cancelled by the shop', value: o.cancelledByShop, color: 'var(--danger)' },
    { key: 'other', label: 'Cancelled another way', value: o.cancelledOther, color: 'var(--faint)' },
  ];
  const total = parts.reduce((sum, x) => sum + x.value, 0);
  const due = o.done + o.missed;
  return (
    <Card title="How bookings ended" hint="outcomes" sub={`${total} ${total === 1 ? 'booking' : 'bookings'} paid for in this time`}>
      <div className="st-outcomes">
        <Ring parts={parts} middle={due ? share(o.done, due) : '—'} under="turned up" />
        <ul className="st-legend">
          {parts
            .filter((x) => x.value > 0 || ['done', 'missed', 'customer', 'shop'].includes(x.key))
            .map((x) => (
              <li key={x.key}>
                <i style={{ background: x.color }} />
                <span>{x.label}</span>
                <strong>{x.value}</strong>
                <em>{share(x.value, total)}</em>
              </li>
            ))}
        </ul>
      </div>
    </Card>
  );
}

function MoneyCard({ p, fig }: { p: StatisticsPeriod | undefined; fig: Figures }) {
  if (!p)
    return (
      <Card title="Money that moved">
        <Loading />
      </Card>
    );
  const t = p.totals;
  const b = p.bookings;
  const rows: Array<{ icon: IconName; label: string; hint: MeaningKey; value: string; sub: string; tone?: string }> = [
    { icon: 'wallet', label: 'Deposits taken', hint: 'deposits', value: fig.full(t.depositsMinor), sub: `${t.bookings} ${t.bookings === 1 ? 'booking' : 'bookings'}` },
    { icon: 'coins', label: 'Platform fees kept', hint: 'feesKept', value: fig.full(t.feesKeptMinor), sub: share(t.feesKeptMinor, t.depositsMinor) + ' of deposits', tone: 'accent' },
    { icon: 'send', label: 'Paid out to shops', hint: 'payouts', value: fig.full(b.payoutsMinor), sub: `${b.payouts} ${b.payouts === 1 ? 'payout' : 'payouts'}` },
    { icon: 'refresh', label: 'Refunded to customers', hint: 'refunds', value: fig.full(b.refundsMinor), sub: `${b.refunds} ${b.refunds === 1 ? 'refund' : 'refunds'}` },
    { icon: 'tag', label: 'Average booking', hint: 'averageBooking', value: fig.full(t.averageBookingMinor), sub: 'full price' },
    { icon: 'percent', label: 'Average deposit', hint: 'averageDeposit', value: fig.full(t.averageDepositMinor), sub: 'paid through the app' },
  ];
  return (
    <Card
      title="Money that moved"
      sub={`${fig.full(t.bookingValueMinor)} booked — ${fig.full(t.doneValueMinor)} of it already done`}
      aside={
        <Link to="/ledger" className="st-link">
          Money book <Icon name="arrowRight" size={14} stroke={2.2} />
        </Link>
      }
    >
      <ul className="st-money">
        {rows.map((r) => (
          <li key={r.label} className={r.tone ? `is-${r.tone}` : ''}>
            <span className="st-money-icon">
              <Icon name={r.icon} size={16} />
            </span>
            <span className="st-money-label">
              {r.label}
              <Hint k={r.hint} />
              <em>{r.sub}</em>
            </span>
            <strong>{r.value}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WhenCard({ p }: { p: StatisticsPeriod | undefined }) {
  const said = p ? busiest(p.bookings.heat) : null;
  return (
    <Card title="When visits happen" hint="heat" sub={p ? (said ? `Busiest: ${said}` : 'No visits booked in this time') : ' '}>
      {p ? (
        <>
          <Heat cells={p.bookings.heat} />
          <div className="st-heat-key" aria-hidden="true">
            <span>Fewer</span>
            <i />
            <span>More</span>
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Card>
  );
}

function AheadCard({ p }: { p: StatisticsPeriod | undefined }) {
  if (!p)
    return (
      <Card title="How far ahead">
        <Loading />
      </Card>
    );
  const l = p.bookings.leadTime;
  const parts: Part[] = [
    { key: 'same', label: 'The same day', value: l.sameDay, color: 'var(--accent)' },
    { key: 'next', label: 'The day before', value: l.nextDay, color: '#ff9f7a' },
    { key: 'week', label: '2 to 7 days ahead', value: l.withinWeek, color: 'var(--night-3)' },
    { key: 'later', label: 'More than a week', value: l.later, color: 'var(--faint)' },
  ];
  const total = parts.reduce((sum, x) => sum + x.value, 0);
  const { started, startedPaid } = p.bookings;
  return (
    <div className="st-stack">
      <Card title="How far ahead people book" hint="leadTime">
        <Split parts={parts} />
        <ul className="st-legend is-compact">
          {parts.map((x) => (
            <li key={x.key}>
              <i style={{ background: x.color }} />
              <span>{x.label}</span>
              <strong>{share(x.value, total)}</strong>
              <em>{x.value}</em>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Started, then paid" hint="started">
        <div className="st-funnel">
          <div>
            <span>Started a booking</span>
            <i style={{ width: '100%' }} />
            <strong>{started}</strong>
          </div>
          <div className="is-paid">
            <span>Paid the deposit</span>
            <i style={{ width: started ? `${Math.max(2, (startedPaid / started) * 100)}%` : '0%' }} />
            <strong>{startedPaid}</strong>
          </div>
        </div>
        <p className="st-caption">
          {started ? `${share(startedPaid, started)} paid. The rest stopped at the payment step.` : 'Nobody started a booking in this time.'}
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// People

function Figure({ label, hint, value, sub }: { label: string; hint: MeaningKey; value: string; sub?: string }) {
  return (
    <div className="st-fig">
      <span>
        {label}
        <Hint k={hint} />
      </span>
      <strong>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

const LANGUAGE: Record<string, string> = { en: 'English', rw: 'Kinyarwanda', fr: 'French' };

function CustomersCard({ p, s }: { p: StatisticsPeriod | undefined; s: StatisticsSummary | undefined }) {
  if (!p)
    return (
      <Card title="Customers">
        <Loading />
      </Card>
    );
  const t = p.totals;
  const c = p.customers;
  const languages = s?.languages ?? [];
  const speakers = languages.reduce((sum, l) => sum + l.count, 0);
  return (
    <Card title="Customers" sub="Who signed up, who booked, who came back">
      <div className="st-figs">
        <Figure label="Signed up" hint="newCustomers" value={String(t.newCustomers)} sub={t.newCustomers ? `${share(c.joinedAndBooked, t.newCustomers)} have booked since` : undefined} />
        <Figure label="Booked" hint="customersBooked" value={String(t.customersBooked)} sub={c.bookingsPerCustomer === null ? undefined : `${c.bookingsPerCustomer} bookings each`} />
        <Figure label="Followed a shop" hint="follows" value={String(c.follows)} />
        <Figure
          label="Reviews written"
          hint="reviews"
          value={String(p.wants.reviews.count)}
          sub={p.wants.reviews.average === null ? undefined : `${p.wants.reviews.average.toFixed(1)} stars on average`}
        />
      </div>
      <div className="st-sub-block">
        <span className="st-sub-title">
          First booking, or back again
          <Hint k="firstTime" />
        </span>
        <Split
          parts={[
            { key: 'new', label: 'First booking', value: c.firstTime, color: 'var(--accent)' },
            { key: 'back', label: 'Came back', value: c.returning, color: 'var(--night)' },
          ]}
        />
        <div className="st-split-key">
          <span>
            <i style={{ background: 'var(--accent)' }} /> {c.firstTime} first booking
          </span>
          <span>
            <i style={{ background: 'var(--night)' }} /> {c.returning} came back
          </span>
        </div>
      </div>
      {speakers > 0 && (
        <div className="st-sub-block">
          <span className="st-sub-title">The language they use (all customers)</span>
          <div className="st-langs">
            {languages.map((l) => (
              <span key={l.key} className="st-lang">
                <b style={{ width: `${(l.count / speakers) * 100}%` }} />
                <span>{LANGUAGE[l.key] ?? l.key}</span>
                <strong>{share(l.count, speakers)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ShopsCard({ p }: { p: StatisticsPeriod | undefined }) {
  if (!p)
    return (
      <Card title="Shops">
        <Loading />
      </Card>
    );
  const sh = p.shops;
  return (
    <Card title="Shops" sub="Who joined, who went live, who is trading">
      <div className="st-figs">
        <Figure label="Signed up" hint="applied" value={String(sh.joined)} sub={`${sh.applied} sent for review`} />
        <Figure label="Went live" hint="shopsWentLive" value={String(p.totals.shopsWentLive)} sub={sh.medianDaysToLive === null ? undefined : `${daysWords(sh.medianDaysToLive)} from signing up`} />
        <Figure label="Had bookings" hint="withBookings" value={String(sh.withBookings)} sub={`${share(sh.withBookings, sh.liveNow)} of live shops`} />
        <Figure label="Live today" hint="liveShops" value={String(sh.liveNow)} sub={[sh.pausedNow && `${sh.pausedNow} paused`, sh.suspendedNow && `${sh.suspendedNow} suspended`].filter(Boolean).join(' · ') || undefined} />
      </div>
    </Card>
  );
}

const daysWords = (days: number) => (days < 1 ? 'under a day' : `${days % 1 === 0 ? days : days.toFixed(1)} ${days === 1 ? 'day' : 'days'}`);

function TopShopsCard({ p, fig }: { p: StatisticsPeriod | undefined; fig: Figures }) {
  const [by, setBy] = useState<'bookings' | 'value'>('bookings');
  const rows: StatisticsTopShop[] = p ? (by === 'bookings' ? p.shops.topByBookings : p.shops.topByValue) : [];
  return (
    <Card
      title="Top shops"
      hint="topShops"
      sub="For our team only — the pitch sheet never names a shop"
      className="st-top"
      aside={
        <div className="st-tabs" role="tablist" aria-label="Ranked by">
          <button type="button" role="tab" aria-selected={by === 'bookings'} className={by === 'bookings' ? 'is-on' : ''} onClick={() => setBy('bookings')}>
            Most bookings
          </button>
          <button type="button" role="tab" aria-selected={by === 'value'} className={by === 'value' ? 'is-on' : ''} onClick={() => setBy('value')}>
            Most value
          </button>
        </div>
      }
    >
      {!p ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="st-none">No shop had a booking in this time.</p>
      ) : (
        <ol className="st-shops">
          {rows.map((r, i) => (
            <li key={r.id} style={{ animationDelay: `${i * 35}ms` }}>
              <span className={`st-rank${i < 3 ? ` is-${i + 1}` : ''}`}>{i + 1}</span>
              <Link to={`/businesses?status=ALL&open=${r.id}`} className="st-shop">
                <ShopMark name={r.name} logoUrl={null} size={38} />
                <span>
                  <strong>{r.name ?? 'No name yet'}</strong>
                  <em>{r.category ?? 'No category'}</em>
                </span>
              </Link>
              <span className="st-shop-n">
                <strong>{r.bookings}</strong>
                <em>{r.bookings === 1 ? 'booking' : 'bookings'}</em>
              </span>
              <span className="st-shop-v">
                <strong>{fig.short(r.bookingValueMinor)}</strong>
                <em>value</em>
              </span>
              <span className="st-shop-r">{r.rating === null ? <em>No reviews</em> : <Stars value={r.rating} size={13} />}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function SliceCard({
  title,
  hint,
  rows,
  fig,
  color,
}: {
  title: string;
  hint: MeaningKey;
  rows: StatisticsSlice[] | null;
  fig: Figures;
  color?: (row: StatisticsSlice) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = rows ? (all ? rows : rows.slice(0, 7)) : null;
  return (
    <Card title={title} hint={hint}>
      {!shown ? (
        <Loading />
      ) : (
        <>
          <Ranked
            empty="Nothing to show in this time."
            rows={shown.map((r) => ({
              key: r.id ?? 'none',
              label: r.name,
              value: r.bookings,
              shown: `${r.bookings} · ${fig.short(r.bookingValueMinor)}`,
              sub: `${r.liveShops} live ${r.liveShops === 1 ? 'shop' : 'shops'}`,
              color: color?.(r),
              mark: color ? <span className="st-dot" style={{ background: color(r) }} /> : undefined,
            }))}
          />
          {rows && rows.length > 7 && (
            <button type="button" className="st-more" onClick={() => setAll((was) => !was)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// What people want

function SearchesCard({ p }: { p: StatisticsPeriod | undefined }) {
  if (!p)
    return (
      <Card title="What they searched for" hint="searches">
        <Loading />
      </Card>
    );
  const se = p.wants.searches;
  return (
    <Card
      title="What they searched for"
      hint="searches"
      sub={se.total ? `${se.total} searches · ${share(se.empty, se.total)} found nothing` : 'No searches in this time'}
    >
      <div className="st-searches">
        <div>
          <span className="st-sub-title">Most searched</span>
          <Terms terms={se.top} empty="No searches yet." />
        </div>
        <div className="is-empty-side">
          <span className="st-sub-title">
            <Icon name="bulb" size={14} />
            Found nothing — shops to sign up next
          </span>
          <Terms terms={se.emptyTop} empty="Every search found something." />
        </div>
      </div>
    </Card>
  );
}

function Terms({ terms, empty }: { terms: Array<{ term: string; count: number }>; empty: string }) {
  if (terms.length === 0) return <p className="st-none">{empty}</p>;
  const max = Math.max(1, ...terms.map((t) => t.count));
  return (
    <ul className="st-terms">
      {terms.map((t) => (
        <li key={t.term}>
          <b style={{ width: `${(t.count / max) * 100}%` }} />
          <span>“{t.term}”</span>
          <strong>{t.count}</strong>
        </li>
      ))}
    </ul>
  );
}

function ServicesCard({ p }: { p: StatisticsPeriod | undefined }) {
  return (
    <Card title="Most booked services" hint="services">
      {!p ? (
        <Loading />
      ) : (
        <Ranked
          empty="Nothing booked in this time."
          rows={p.wants.topServices.map((sv) => ({
            key: sv.name,
            label: sv.name,
            value: sv.bookings,
            shown: String(sv.bookings),
            sub: `at ${sv.shops} ${sv.shops === 1 ? 'shop' : 'shops'}`,
          }))}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Month by month

function MonthsCard({ mo, fig }: { mo: StatisticsMonths | undefined; fig: Figures }) {
  const rows = useMemo(() => (mo ? [...mo.months].reverse() : []), [mo]);
  const max = Math.max(1, ...rows.map((r) => r.bookings));
  return (
    <Card title="Each month" hint="months" sub="Newest first, each against the month before">
      {!mo ? (
        <Loading />
      ) : (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Bookings</th>
                <th>Booking value</th>
                <th>Fees kept</th>
                <th>New customers</th>
                <th>Customers who booked</th>
                <th>Shops went live</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const before = rows[i + 1];
                const trend = before ? change(r.bookings, before.bookings) : null;
                return (
                  <tr key={r.month}>
                    <th scope="row">{monthWords(r.month)}</th>
                    <td>
                      <span className="st-cell-bar">
                        <b style={{ width: `${(r.bookings / max) * 100}%` }} />
                        <strong>{r.bookings}</strong>
                        {trend && trend.tone !== 'flat' && <em className={`is-${trend.tone}`}>{trend.words}</em>}
                      </span>
                    </td>
                    <td>{fig.full(r.bookingValueMinor)}</td>
                    <td className="is-accent">{fig.full(r.feesKeptMinor)}</td>
                    <td>{r.newCustomers}</td>
                    <td>{r.activeCustomers}</td>
                    <td>{r.shopsWentLive}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CohortsCard({ mo }: { mo: StatisticsMonths | undefined }) {
  const cohorts = mo?.cohorts.filter((c) => c.customers > 0) ?? [];
  const width = Math.max(0, ...cohorts.map((c) => c.back.length));
  return (
    <Card title="Customers coming back" hint="cohorts" sub="Of the customers whose first booking was in a month, how many booked again later">
      {!mo ? (
        <Loading />
      ) : cohorts.length === 0 ? (
        <p className="st-none">This fills in from the first booking.</p>
      ) : (
        <>
          <div className="st-table-wrap">
            <table className="st-cohorts">
              <thead>
                <tr>
                  <th>First booking in</th>
                  <th>Customers</th>
                  {Array.from({ length: width }, (_, i) => (
                    <th key={i}>{i === 0 ? '1 month later' : `${i + 1} months`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.month}>
                    <th scope="row">{monthWords(c.month)}</th>
                    <td className="st-cohort-n">{c.customers}</td>
                    {Array.from({ length: width }, (_, i) => {
                      const n = c.back[i];
                      if (n === undefined) return <td key={i} className="is-future" />;
                      const pct = c.customers ? n / c.customers : 0;
                      return (
                        <td key={i} style={{ ['--a' as string]: String(0.08 + 0.92 * pct) }} className="st-cohort-cell" title={`${n} of ${c.customers}`}>
                          {Math.round(pct * 100)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {width === 0 && <p className="st-caption">The months after fill in as they come: this is the platform’s first month.</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Test accounts

function LeftOutPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['statistics', 'left-out'], queryFn: getStatisticsLeftOut });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['statistics'] });
  const unmarkShop = useMutation({ mutationFn: (id: string) => markTestShop(id, false), onSuccess: refresh });
  const unmarkCustomer = useMutation({ mutationFn: (id: string) => markTestCustomer(id, false), onSuccess: refresh });
  return (
    <Panel eyebrow="Statistics" title="Test accounts" onClose={onClose} width={620}>
      <p className="st-panel-intro">{MEANING.leftOut} Mark a shop on its own panel under Businesses, and a customer on theirs under Users.</p>
      {list.isLoading && <Loading />}
      {list.data && (
        <>
          <h4 className="st-panel-h">
            <Icon name="store" size={15} /> Shops · {list.data.shops.length}
          </h4>
          {list.data.shops.length === 0 ? (
            <p className="st-none">No test shops.</p>
          ) : (
            <ul className="st-left">
              {list.data.shops.map((b) => (
                <li key={b.id}>
                  <ShopMark name={b.name} logoUrl={null} size={34} />
                  <span>
                    <Link to={`/businesses?status=ALL&open=${b.id}`} onClick={onClose}>
                      {b.name ?? 'No name yet'}
                    </Link>
                    <em>{by(b.markedBy, b.markedAt)}</em>
                  </span>
                  <button type="button" disabled={unmarkShop.isPending} onClick={() => unmarkShop.mutate(b.id)}>
                    Count it again
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4 className="st-panel-h">
            <Icon name="users" size={15} /> Customers · {list.data.customers.length}
          </h4>
          {list.data.customers.length === 0 ? (
            <p className="st-none">No test customers.</p>
          ) : (
            <ul className="st-left">
              {list.data.customers.map((u) => (
                <li key={u.id}>
                  <span className="st-left-avatar">
                    <Icon name="user" size={16} />
                  </span>
                  <span>
                    <strong>{u.displayName ?? u.email}</strong>
                    <em>
                      {u.displayName ? `${u.email} · ` : ''}
                      {by(u.markedBy, u.markedAt)}
                    </em>
                  </span>
                  <button type="button" disabled={unmarkCustomer.isPending} onClick={() => unmarkCustomer.mutate(u.id)}>
                    Count them again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
