import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getExchangeRate,
  getOverview,
  getReconciliation,
  heldTotals,
  type AdminOverview,
  type OverviewDay,
  type OverviewPeriod,
  type Reconciliation,
} from '../api/admin';
import { useMoney } from '../money';
import { clock, useNow } from '../lib/time';
import { Icon, type IconName } from '../ui/Icon';
import { RwandaFlag } from '../ui/RwandaFlag';
import './overview.css';

const greeting = (now: Date) => {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** "under an hour", "5 hours", "3 days" — how long the oldest item has waited. */
const waited = (iso: string | null, now: Date) => {
  if (!iso) return null;
  const hours = (now.getTime() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

/** Older than this, a waiting item is said in amber: someone is waiting on the platform. */
const LATE_HOURS = 48;

/**
 * The console's home page (§243) — what an administrator opens first: what is
 * waiting for them and since when, how the platform did this week against
 * last, and whether the money adds up. Everything comes from the server's
 * counts (`GET /admin/overview`), refreshed every minute and after any action.
 */
export function OverviewPage() {
  const now = useNow(60_000);
  const money = useMoney();
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: getOverview, refetchInterval: 60_000 });
  const data = overview.data;

  const queues = data ? queueCards(data, money.format) : null;
  const total = queues ? queues.reduce((sum, q) => sum + q.count, 0) : 0;
  const oldest = queues
    ?.filter((q) => q.count > 0 && q.oldestAt)
    .sort((a, b) => a.oldestAt!.localeCompare(b.oldestAt!))[0];

  return (
    <section className="ao">
      <div className="page-top">
        <header className="ao-head">
          <div>
            {/* The date and time live in the top bar on a wide screen (§235); a phone has them here. */}
            <p className="ao-eyebrow">
              <span className="ao-country">
                <RwandaFlag width={20} />
                Rwanda
              </span>
              <Icon name={now.getHours() < 17 ? 'sun' : 'moon'} size={16} />
              {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="ao-clock">{clock(now)}</span>
            </p>
            <h1>
              {greeting(now)}
              <span>.</span>
            </h1>
            <p className="ao-sentence">
              {!data
                ? 'Counting what is waiting…'
                : total === 0
                  ? 'Nothing is waiting for you — every queue is clear.'
                  : `${total} ${total === 1 ? 'thing is' : 'things are'} waiting for you${
                      oldest ? `; the longest, ${oldest.short}, for ${waited(oldest.oldestAt, now)}.` : '.'
                    }`}
            </p>
          </div>
          <div className="ao-head-actions">
            <Link to="/users" className="btn-quiet">
              <Icon name="users" size={18} />
              <span className="ao-long">Invite an administrator</span>
              <span className="ao-short">Invite an admin</span>
            </Link>
            <Link to="/payouts" className="btn-dark">
              <Icon name="send" size={18} />
              Run payouts
            </Link>
          </div>
        </header>
      </div>

      <h2 className="ao-section">What needs you</h2>
      <div className="ao-queues">
        {queues
          ? queues.map((q) => <QueueCard key={q.to} queue={q} now={now} />)
          : [0, 1, 2, 3].map((i) => <div key={i} className="ao-queue skeleton" />)}
      </div>

      <div className="ao-cols">
        <div className="ao-main">
          <h2 className="ao-section">The last seven days</h2>
          <div className="ao-stats">
            <Stat
              icon="calendarCheck"
              label="Bookings paid"
              value={data ? String(data.thisWeek.bookings) : null}
              now={data?.thisWeek.bookings}
              before={data?.lastWeek.bookings}
              accent
            />
            <Stat
              icon="banknote"
              label="Deposits taken"
              value={data ? money.format(data.thisWeek.depositsMinor, data.currency) : null}
              now={data?.thisWeek.depositsMinor}
              before={data?.lastWeek.depositsMinor}
            />
            <Stat
              icon="coins"
              label="Fees kept"
              hint="The platform's share, less any handed back"
              value={data ? money.format(data.thisWeek.feesMinor, data.currency) : null}
              now={data?.thisWeek.feesMinor}
              before={data?.lastWeek.feesMinor}
            />
            <Stat
              icon="sparkles"
              label="Joined"
              value={data ? `${data.thisWeek.newBusinesses + data.thisWeek.newCustomers}` : null}
              sub={
                data
                  ? `${data.thisWeek.newBusinesses} ${data.thisWeek.newBusinesses === 1 ? 'shop' : 'shops'} · ${
                      data.thisWeek.newCustomers
                    } ${data.thisWeek.newCustomers === 1 ? 'customer' : 'customers'}`
                  : undefined
              }
              now={data ? data.thisWeek.newBusinesses + data.thisWeek.newCustomers : undefined}
              before={data ? data.lastWeek.newBusinesses + data.lastWeek.newCustomers : undefined}
            />
          </div>

          <article className="ao-card">
            <header className="ao-card-head">
              <div>
                <h2>Bookings, day by day</h2>
                <p>Paid bookings over the last two weeks, on the day the deposit came in</p>
              </div>
            </header>
            <Chart days={data?.days ?? null} week={data?.thisWeek ?? null} before={data?.lastWeek ?? null} format={(m) => money.format(m, data?.currency)} />
          </article>
        </div>

        <aside className="ao-side">
          <MoneyCard currency={data?.currency ?? null} format={money.format} payouts={data?.waiting.payouts ?? null} />
          <article className="ao-card ao-size">
            <header className="ao-card-head">
              <div>
                <h2>On the platform</h2>
                <p>What customers can find right now</p>
              </div>
            </header>
            <dl className="ao-size-list">
              <div>
                <dt>
                  <Icon name="store" size={17} /> Live shops
                </dt>
                <dd>{data ? data.totals.liveBusinesses : '–'}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="pin" size={17} /> Open branches
                </dt>
                <dd>{data ? data.totals.liveBranches : '–'}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="users" size={17} /> Customers
                </dt>
                <dd>{data ? data.totals.customers : '–'}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// What needs you

type Queue = {
  to: string;
  icon: IconName;
  count: number;
  oldestAt: string | null;
  label: string;
  /** How the queue is named in the page's sentence: "a shop's application". */
  short: string;
  why: string;
  extra?: string;
};

function queueCards(data: AdminOverview, format: (minor: number, code?: string | null) => string): Queue[] {
  const { businesses, destinations, payouts, tickets } = data.waiting;
  return [
    {
      to: '/businesses',
      icon: 'store',
      count: businesses.count,
      oldestAt: businesses.oldestAt,
      label: businesses.count === 1 ? 'shop to approve' : 'shops to approve',
      short: 'a shop’s application',
      why: 'Customers cannot find them until you decide.',
    },
    {
      to: '/payout-destinations',
      icon: 'wallet',
      count: destinations.count,
      oldestAt: destinations.oldestAt,
      label: destinations.count === 1 ? 'payout number to check' : 'payout numbers to check',
      short: 'a payout number',
      why: 'A shop is not paid until its number is checked.',
    },
    {
      to: '/payouts',
      icon: 'send',
      count: payouts.count,
      oldestAt: payouts.oldestAt,
      label: payouts.count === 1 ? 'payout to send' : 'payouts to send',
      short: 'a payout',
      why: 'Money owed to shops, ready to go.',
      extra: payouts.amounts.length ? payouts.amounts.map((a) => format(a.amountMinor, a.currency)).join(' + ') : undefined,
    },
    {
      to: '/tickets',
      icon: 'help',
      count: tickets.count,
      oldestAt: tickets.oldestAt,
      label: tickets.count === 1 ? 'new support ticket' : 'new support tickets',
      short: 'a support ticket',
      why: 'Customers and shops asking for help.',
      extra: tickets.unassigned > 0 ? `${tickets.unassigned} not taken by anyone` : undefined,
    },
  ];
}

function QueueCard({ queue, now }: { queue: Queue; now: Date }) {
  const clear = queue.count === 0;
  const age = waited(queue.oldestAt, now);
  const late = queue.oldestAt ? now.getTime() - new Date(queue.oldestAt).getTime() > LATE_HOURS * 3_600_000 : false;
  return (
    <Link to={queue.to} className={`ao-queue${clear ? ' is-clear' : ''}${late ? ' is-late' : ''}`}>
      <span className="ao-queue-top">
        <span className="ao-queue-icon">
          <Icon name={clear ? 'checkCircle' : queue.icon} size={20} />
        </span>
        <Icon name="arrowUpRight" size={18} className="ao-queue-go" />
      </span>
      <strong className="ao-queue-n">{queue.count}</strong>
      <span className="ao-queue-label">{queue.label}</span>
      {queue.extra && !clear && <span className="ao-queue-extra">{queue.extra}</span>}
      <span className="ao-queue-foot">
        {clear ? (
          <>All clear</>
        ) : (
          <>
            <Icon name="clock" size={14} />
            <span className="ao-long">Oldest waiting {age}</span>
            <span className="ao-short">Waiting {age}</span>
          </>
        )}
      </span>
      <span className="ao-queue-why">{queue.why}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// The last seven days

/** This week against last: "+40%", "−12%", "New" when last week had none. */
function Trend({ now, before }: { now?: number; before?: number }) {
  if (now === undefined || before === undefined) return null;
  if (before === 0 && now === 0) return null;
  if (before === 0) return <span className="ao-trend is-up">New</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="ao-trend">Same as last week</span>;
  return (
    <span className={`ao-trend ${change > 0 ? 'is-up' : 'is-down'}`} title="Against the seven days before">
      <Icon name={change > 0 ? 'trendUp' : 'trendDown'} size={13} stroke={2.2} />
      {change > 0 ? '+' : '−'}
      {Math.abs(change)}%
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  hint,
  now,
  before,
  accent = false,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  sub?: string;
  hint?: string;
  now?: number;
  before?: number;
  accent?: boolean;
}) {
  return (
    <div className={`ao-stat${accent ? ' is-accent' : ''}`} title={hint}>
      <Icon name={icon} size={110} stroke={1.2} className="ao-stat-bg" />
      <span className="ao-stat-top">
        <span className="ao-stat-icon">
          <Icon name={icon} size={19} />
        </span>
        <Trend now={now} before={before} />
      </span>
      <span className="ao-stat-label">{label}</span>
      <strong className="ao-stat-value">{value ?? <span className="skeleton ao-stat-skel" />}</strong>
      <span className="ao-stat-sub">{sub ?? 'Against the week before'}</span>
    </div>
  );
}

function Chart({
  days,
  week,
  before,
  format,
}: {
  days: OverviewDay[] | null;
  week: OverviewPeriod | null;
  before: OverviewPeriod | null;
  format: (minor: number) => string;
}) {
  const max = Math.max(4, ...(days ?? []).map((d) => d.bookings));
  const top = Math.ceil(max / 2) * 2;
  const last = (days?.length ?? 0) - 1;
  const dayOf = (ymd: string) => new Date(`${ymd}T12:00:00`);
  return (
    <div className="chart">
      <div className="chart-figures">
        <div>
          <strong>{week ? week.bookings : '–'}</strong>
          <span>in the last seven days</span>
        </div>
        <div>
          <strong>{before ? before.bookings : '–'}</strong>
          <span>the seven before</span>
        </div>
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {[top, top / 2, 0].map((v) => (
            <span key={v}>
              <em>{v}</em>
            </span>
          ))}
        </div>
        <div className="chart-bars">
          {(days ?? Array.from({ length: 14 }, () => null)).map((d, i) => (
            <div key={d?.day ?? i} className={`bar-col${i === last ? ' is-today' : ''}${i < 7 ? ' is-before' : ''}`}>
              <div className="bar-track">
                <div
                  className="bar"
                  style={{ height: `${!d ? 0 : Math.max(d.bookings ? 6 : 0, (d.bookings / top) * 100)}%`, animationDelay: `${i * 22}ms` }}
                >
                  {d && (
                    <span className="bar-tip">
                      {d.bookings} {d.bookings === 1 ? 'booking' : 'bookings'} · {format(d.depositsMinor)}
                      <em>{dayOf(d.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</em>
                    </span>
                  )}
                </div>
              </div>
              <span className="bar-label">
                {d ? (i === last ? 'Today' : i % 2 === 1 ? dayOf(d.day).getDate() : '') : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money

const REASON: Record<NonNullable<Reconciliation['notComparableReason']>, string> = {
  SANDBOX: 'The MTN sandbox has no real wallet to compare with.',
  DIFFERENT_CURRENCY: 'The wallet is in another currency, so the two cannot be set side by side.',
  BALANCE_UNAVAILABLE: 'The operator did not report a balance just now.',
  NOTHING_HELD: 'Nothing is held, so there is nothing to compare.',
};

/**
 * Whether the money adds up (§87): what the ledger says is held for shops,
 * what is about to be sent, the wallet against the ledger, and whether the
 * exchange rate needs updating.
 */
function MoneyCard({
  currency,
  format,
  payouts,
}: {
  currency: string | null;
  format: (minor: number | null | undefined, code?: string | null) => string;
  payouts: AdminOverview['waiting']['payouts'] | null;
}) {
  const held = useQuery({ queryKey: ['held'], queryFn: heldTotals });
  const rate = useQuery({ queryKey: ['exchange-rate'], queryFn: getExchangeRate });
  // Asks the operator, so it is slower; the rest of the page does not wait for it.
  const recon = useQuery({ queryKey: ['reconciliation'], queryFn: getReconciliation, staleTime: 5 * 60_000 });

  const heldLine = held.data?.bySettlementCurrency.map((h) => format(h.amountMinor, h.settlementCurrency)).join(' + ');
  const entries = held.data?.totalEntries ?? 0;

  let wallet: { tone: 'ok' | 'warn' | 'danger' | 'muted'; text: string } | null = null;
  if (recon.data) {
    const r = recon.data;
    if (r.comparable && r.difference === 0) wallet = { tone: 'ok', text: 'The wallet matches the ledger.' };
    else if (r.comparable && r.difference !== null)
      wallet = { tone: 'danger', text: `The wallet and the ledger differ by ${format(Math.abs(r.difference), currency)}.` };
    else wallet = { tone: 'muted', text: r.notComparableReason ? REASON[r.notComparableReason] : 'Not comparable just now.' };
  } else if (recon.isError) wallet = { tone: 'warn', text: 'The wallet could not be asked just now.' };

  const r = rate.data;
  const rateLine = !r
    ? null
    : !r.conversionInUse
      ? { tone: 'ok' as const, text: `Not needed — the platform takes and pays in ${r.internalCurrency}.` }
      : r.stale
        ? { tone: 'warn' as const, text: `Out of date — last set ${r.ageInHours ?? '?'} hours ago.` }
        : { tone: 'ok' as const, text: `Set ${r.ageInHours ?? 0} hours ago.` };

  return (
    <article className="ao-card ao-money">
      <header className="ao-card-head">
        <div>
          <h2>Money</h2>
          <p>Does it add up?</p>
        </div>
        <Link to="/ledger" className="ao-link">
          Open <Icon name="arrowRight" size={15} stroke={2.2} />
        </Link>
      </header>
      <div className="ao-held">
        <span>Held for shops, not yet paid out</span>
        <strong>{held.data ? heldLine || format(0, currency) : <span className="skeleton ao-stat-skel" />}</strong>
        <em>{held.data ? `${entries} ${entries === 1 ? 'entry' : 'entries'}` : ' '}</em>
      </div>
      <ul className="ao-checks">
        <li>
          <span className={`ao-dot tone-${payouts && payouts.count > 0 ? 'warn' : 'ok'}`} />
          <span>
            <strong>Payouts to send</strong>
            {payouts
              ? payouts.count > 0
                ? `${payouts.count} ready — ${payouts.amounts.map((a) => format(a.amountMinor, a.currency)).join(' + ')}`
                : 'None waiting.'
              : '…'}
          </span>
        </li>
        <li>
          <span className={`ao-dot tone-${wallet?.tone ?? 'muted'}`} />
          <span>
            <strong>Wallet check</strong>
            {wallet?.text ?? 'Asking the operator…'}
          </span>
        </li>
        <li>
          <span className={`ao-dot tone-${rateLine?.tone ?? 'muted'}`} />
          <span>
            <strong>Exchange rate</strong>
            {rateLine?.text ?? '…'}
          </span>
        </li>
      </ul>
    </article>
  );
}
