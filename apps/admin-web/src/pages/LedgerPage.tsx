import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  executeAdjustment,
  getReconciliation,
  heldTotals,
  listAdjustments,
  listLedgerEntries,
  type AdminLedgerEntry,
  type BillingAdjustment,
  type LedgerEntryType,
  type NotComparableReason,
} from '../api/admin';
import { ADJUSTMENT_LABEL, ENTRY_LABEL, ENTRY_MEANING } from '../lib/ledgerWords';
import { ago, clock, shortDay } from '../lib/time';
import { alertDialog, promptDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ShopMark } from '../ui/ShopMark';
import './ledger.css';
import { EmptyState } from '../ui/EmptyState';

type Tab = 'adjustments' | 'ledger';
type State = 'outstanding' | 'executed' | 'all';
type Period = 'any' | 'today' | '7d' | '30d';

const PAGE = 40;

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const WALLET_LABEL = {
  COLLECTION: 'Deposits land here',
  DISBURSEMENT: 'Payouts go out from here',
} as const;

/** Why our figure and the operator's cannot honestly be subtracted (§87), said plainly. */
const NOT_COMPARABLE: Record<NotComparableReason & string, string> = {
  SANDBOX: 'Sandbox: the operator reports a made-up balance no transfer moves.',
  DIFFERENT_CURRENCY: 'The operator reports a different currency from the one we hold.',
  BALANCE_UNAVAILABLE: 'The operator did not report the wallet that holds deposits.',
  NOTHING_HELD: 'Our ledger holds nothing, so there is nothing to compare.',
};

const stamp = (iso: string) => `${shortDay(iso)}, ${clock(iso)}`;

const periodFrom = (p: Period) => {
  if (p === 'any') return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === '7d') d.setDate(d.getDate() - 6);
  if (p === '30d') d.setDate(d.getDate() - 29);
  return d.toISOString();
};

/**
 * Money (§251, §84–§87): what the platform holds, whether the operator
 * agrees, the adjustments waiting to be executed, and every ledger entry.
 *
 * The words are the domain's (§85): entry types keep their names, and what a
 * name cannot say — who gained or lost — is the legend beside them (§86).
 * Read-only except for one button: executing an adjustment, which APPENDS
 * entries; nothing here edits history, because the database will not (§34.2).
 */
export function LedgerPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'ledger' ? 'ledger' : 'adjustments';
  const outstanding = useQuery({
    queryKey: ['adjustments', 'count'],
    queryFn: () => listAdjustments({ state: 'outstanding', limit: 1 }),
    select: (page) => page.outstanding,
  });
  const entries = useQuery({
    queryKey: ['ledger', 'count'],
    queryFn: () => listLedgerEntries({ limit: 1 }),
    select: (page) => page.total,
  });

  return (
    <section className="lg">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Money</h1>
            <p className="muted">What the platform is holding, whether the operator agrees, and the corrections that change it.</p>
          </div>
        </header>

        <Reconciliation />

        {/* The title and the operator's figures scroll away; the choice stays. */}
        <div className="lg-tabs pin-from pin-phone" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'adjustments'}
          className={tab === 'adjustments' ? 'is-on' : ''}
          onClick={() => setParams({}, { replace: true })}
        >
          <Icon name="sliders" size={16} />
          Adjustments
          {outstanding.data !== undefined && (
            <span className={outstanding.data > 0 ? 'is-hot' : ''}>{outstanding.data > 0 ? `${outstanding.data} to execute` : 'none waiting'}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ledger'}
          className={tab === 'ledger' ? 'is-on' : ''}
          onClick={() => setParams({ tab: 'ledger' }, { replace: true })}
        >
          <Icon name="list" size={16} />
          Ledger
          {entries.data !== undefined && <span>{entries.data.toLocaleString()} entries</span>}
        </button>
        </div>
      </div>

      {tab === 'adjustments' ? <Adjustments /> : <Ledger />}
    </section>
  );
}

/** Our figure beside the operator's (§87), and whether they can be compared at all. */
function Reconciliation() {
  const money = useMoney();
  const held = useQuery({ queryKey: ['held'], queryFn: heldTotals });
  // Separate: the operator is a network call away and sometimes slow or
  // refusing, and our own figure must not wait for theirs.
  const check = useQuery({ queryKey: ['reconciliation'], queryFn: getReconciliation, retry: false });

  const ours = held.data?.bySettlementCurrency ?? [];
  const verdict = check.data
    ? check.data.comparable
      ? check.data.difference === 0
        ? { tone: 'ok', icon: 'checkCircle' as const, title: 'They agree', text: 'Our ledger and the operator hold the same.' }
        : {
            tone: 'warn',
            icon: 'alert' as const,
            title: `Off by ${money.signed(check.data.difference ?? 0)}`,
            text: 'Money landed or left without a ledger entry, or the other way round. Look into it before the next payout run.',
          }
      : {
          tone: 'muted',
          icon: 'info' as const,
          title: 'Not comparable now',
          text: check.data.notComparableReason ? NOT_COMPARABLE[check.data.notComparableReason] : check.data.note,
        }
    : check.isError
      ? { tone: 'muted', icon: 'info' as const, title: 'The operator could not be reached', text: 'There is nothing to compare against — compare it by hand.' }
      : { tone: 'muted', icon: 'refresh' as const, title: 'Asking the operator…', text: 'Our own figure does not wait for theirs.' };

  return (
    <div className="lg-recon">
      <div className="lg-ours">
        <span className="lg-k">Our ledger says</span>
        {ours.length > 0 ? (
          ours.map((row) => (
            <strong key={row.settlementCurrency} className="lg-big">
              {money.format(row.amountMinor, row.settlementCurrency)}
            </strong>
          ))
        ) : (
          <strong className="lg-big">{held.data ? 'Nothing held' : '…'}</strong>
        )}
        <span className="lg-sub">
          {held.data
            ? `${held.data.totalEntries.toLocaleString()} entries not yet paid out, as of ${clock(held.data.asOf)}`
            : 'Adding up what has not been paid out…'}
        </span>
        {held.data && held.data.entriesWithoutSettlement > 0 && (
          <span className="lg-warn">
            <Icon name="alert" size={14} /> {held.data.entriesWithoutSettlement} entries carry no settlement amount and are missing from this figure
          </span>
        )}
      </div>

      <div className="lg-theirs">
        {(check.data?.wallets ?? [{ wallet: 'COLLECTION' as const }, { wallet: 'DISBURSEMENT' as const }]).map((w) => (
          <div key={w.wallet} className="lg-wallet">
            <span className="lg-k">MTN · {WALLET_LABEL[w.wallet]}</span>
            {'status' in w && w.status === 'OK' ? (
              <strong>
                {w.currency} {Number(w.reportedAmount).toLocaleString()}
              </strong>
            ) : 'status' in w ? (
              <strong className="is-none" title={w.reason}>
                No answer
              </strong>
            ) : (
              <strong className="is-none">…</strong>
            )}
          </div>
        ))}
        {check.data?.isSandbox && <span className="lg-sandbox">Sandbox</span>}
      </div>

      <div className={`lg-verdict tone-${verdict.tone}`}>
        <Icon name={verdict.icon} size={20} />
        <strong>{verdict.title}</strong>
        <span>{verdict.text}</span>
        <button type="button" className="lg-again" onClick={() => void check.refetch()} disabled={check.isFetching}>
          <Icon name="refresh" size={14} className={check.isFetching ? 'lg-spin' : undefined} /> {check.isFetching ? 'Asking…' : 'Ask again'}
        </button>
      </div>
    </div>
  );
}

function Adjustments() {
  const money = useMoney();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>('outstanding');

  const list = useQuery({
    queryKey: ['adjustments', state],
    queryFn: () => listAdjustments({ ...(state === 'all' ? {} : { state }), limit: 200 }),
    placeholderData: (previous) => previous,
  });
  const all = useQuery({ queryKey: ['adjustments', 'all-count'], queryFn: () => listAdjustments({ limit: 1 }), select: (p) => p });

  const execute = useMutation({
    mutationFn: (input: { id: string; ref?: string }) => executeAdjustment(input.id, input.ref),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      void queryClient.invalidateQueries({ queryKey: ['held'] });
    },
  });

  const run = async (row: BillingAdjustment) => {
    const amount = `${money.code} ${row.amount}`;
    const ref = await promptDialog({
      title: `Execute this ${ADJUSTMENT_LABEL[row.type].toLowerCase()}?`,
      body: (
        <p>
          <strong>{amount}</strong> {row.type === 'FEE_REFUND' ? 'to' : 'from'} <strong>{row.businessProfile.name ?? 'the business'}</strong>. This writes a
          ledger entry and changes what the business is owed. It cannot be undone — a mistake is corrected by recording another adjustment, not by
          reversing this one.
        </p>
      ),
      label: 'The provider’s reference (optional)',
      placeholder: 'Leave blank if it nets against a future payout',
      note: 'Only if this was settled by its own transfer.',
      minLength: 0,
      tone: 'warn',
      icon: 'banknote',
      confirmLabel: 'Execute',
      cancelLabel: 'Not now',
    });
    if (ref === null) return;
    const trimmed = ref.trim();
    if (trimmed !== '' && trimmed.length < 3) {
      await alertDialog({ title: 'That reference is too short', body: <p>A reference needs at least three characters — or leave it blank.</p>, tone: 'info' });
      return;
    }
    execute.mutate({ id: row.id, ref: trimmed === '' ? undefined : trimmed });
  };

  const rows = list.data?.adjustments ?? [];
  const outstanding = list.data?.outstanding ?? 0;
  const total = all.data?.total;

  return (
    <div className="lg-card">
      <div className="lg-card-top">
        <div className="lg-seg" role="tablist" aria-label="Show">
          {(
            [
              ['outstanding', 'Still to execute', outstanding],
              ['executed', 'Executed', total !== undefined ? total - outstanding : undefined],
              ['all', 'All', total],
            ] as Array<[State, string, number | undefined]>
          ).map(([value, label, count]) => (
            <button key={value} type="button" role="tab" aria-selected={state === value} className={state === value ? 'is-on' : ''} onClick={() => setState(value)}>
              {label}
              {count !== undefined && <span className={value === 'outstanding' && count > 0 ? 'is-hot' : ''}>{count}</span>}
            </button>
          ))}
        </div>
        <p className="lg-hint">
          An adjustment is a decision recorded when a ticket is resolved. Executing it is what moves the money.
        </p>
      </div>

      {execute.error && (
        <p className="error lg-error" role="alert">
          <Icon name="alert" size={15} />
          {execute.error instanceof ApiError ? execute.error.message : 'That did not work.'}
        </p>
      )}

      {list.isLoading && <div className="skeleton lg-skel" />}
      {list.data && rows.length === 0 && (
        <EmptyState
          size="card"
          className="is-list"
          art={state === 'outstanding' ? 'clear' : 'paper'}
          title={state === 'outstanding' ? 'Nothing waiting to be executed' : 'No adjustments recorded'}
          text="Adjustments are recorded when a support ticket is resolved with money owed one way or the other."
        />
      )}

      <ul className="lg-adjs">
        {rows.map((row) => {
          const credit = row.type === 'FEE_REFUND';
          return (
            <li key={row.id} className={row.settledAt ? 'is-done' : 'is-waiting'}>
              <div className="lg-adj-who">
                <ShopMark name={row.businessProfile.name} logoUrl={row.businessProfile.logoUrl} size={40} />
                <span>
                  <strong>{row.businessProfile.name ?? 'Unnamed business'}</strong>
                  <em>{ADJUSTMENT_LABEL[row.type]}</em>
                </span>
              </div>
              <div className="lg-adj-why">
                <p>“{row.reason}”</p>
                <span>
                  Recorded {ago(row.createdAt)} by {row.createdBy.email}
                  {row.ticket && (
                    <>
                      {' '}
                      · on <Link to={`/tickets?ref=${row.ticket.reference}`}>{row.ticket.reference}</Link>
                    </>
                  )}
                </span>
              </div>
              <div className="lg-adj-amount">
                {/* `amount` is a decimal string in MAJOR units, unlike every
                    other figure here: printed as given, with the code. */}
                <strong className={credit ? 'is-pos' : 'is-neg'}>
                  {credit ? '+' : '−'}
                  {money.code} {row.amount}
                </strong>
                <span>{credit ? 'to the business' : 'from the business'}</span>
              </div>
              <div className="lg-adj-state">
                {row.settledAt ? (
                  <>
                    <span className="pill resolved">Executed</span>
                    <span>
                      {stamp(row.settledAt)} · {row.settlementRef ? row.settlementRef : 'netted against a payout'}
                    </span>
                  </>
                ) : (
                  <button type="button" className="primary" disabled={execute.isPending} onClick={() => void run(row)}>
                    <Icon name="banknote" size={16} /> Execute
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Ledger() {
  const money = useMoney();
  const [type, setType] = useState<LedgerEntryType | null>(null);
  const [period, setPeriod] = useState<Period>('any');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const from = useMemo(() => periodFrom(period), [period]);
  const list = useInfiniteQuery({
    queryKey: ['ledger', type, period, q],
    queryFn: ({ pageParam }) =>
      listLedgerEntries({ ...(type ? { type } : {}), ...(from ? { from } : {}), ...(q ? { q } : {}), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.entries.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.entries) ?? [], [list.data]);
  const first = list.data?.pages[0];

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [list]);

  return (
    <>
      <div className="lg-card">
        <div className="lg-card-top">
          <div className="lg-filters">
            <label className="lg-search">
              <Icon name="search" size={17} />
              <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="A business’s name" aria-label="Business" />
              {typed && (
                <button type="button" onClick={() => setTyped('')} aria-label="Clear">
                  <Icon name="close" size={13} stroke={2.2} />
                </button>
              )}
            </label>
            <div className="lg-seg" role="tablist" aria-label="When">
              {PERIODS.map((p) => (
                <button key={p.value} type="button" role="tab" aria-selected={period === p.value} className={period === p.value ? 'is-on' : ''} onClick={() => setPeriod(p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="lg-types" role="group" aria-label="Kind of entry">
            <button type="button" className={type === null ? 'is-on' : ''} aria-pressed={type === null} onClick={() => setType(null)}>
              Every kind
            </button>
            {(Object.keys(ENTRY_LABEL) as LedgerEntryType[]).map((key) => (
              <button
                key={key}
                type="button"
                className={type === key ? 'is-on' : ''}
                aria-pressed={type === key}
                onClick={() => setType(type === key ? null : key)}
                title={ENTRY_MEANING[key]}
              >
                {ENTRY_LABEL[key]}
              </button>
            ))}
          </div>
          {first && (
            <div className="lg-inview">
              <span>
                <strong>{first.total.toLocaleString()}</strong> {first.total === 1 ? 'entry' : 'entries'}
              </span>
              {first.totalsBySettlementCurrency.map((t) => (
                <span key={t.settlementCurrency ?? 'none'} className={t.amountMinor < 0 ? 'is-neg' : 'is-pos'}>
                  {money.signed(t.amountMinor, t.settlementCurrency)} in view
                </span>
              ))}
              <em>From the business’s side: positive is owed to them, negative is owed back.</em>
            </div>
          )}
          <div className="lg-cols" aria-hidden="true">
            <span>When</span>
            <span>Business</span>
            <span>What happened</span>
            <span className="num">Amount</span>
            <span>Payable</span>
          </div>
        </div>

        {list.isLoading && <div className="skeleton lg-skel" />}
        {list.data && rows.length === 0 && (
          <EmptyState
            size="card"
            className="is-list"
            art={q ? 'search' : 'bank'}
            title="No entries here"
            text={`Nothing of that kind${q ? ` for “${q}”` : ''}${period !== 'any' ? ' in that time' : ''}.`}
          />
        )}

        <ul className={`lg-rows${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
          {rows.map((e) => (
            <Line key={e.id} e={e} format={money.format} signed={money.signed} />
          ))}
        </ul>
        <div ref={end} />
        {rows.length > 0 && first && (
          <footer className="lg-foot">
            <span>
              Showing <strong>{rows.length.toLocaleString()}</strong> of <strong>{first.total.toLocaleString()}</strong>
            </span>
            {list.hasNextPage && (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            )}
          </footer>
        )}
      </div>

      <div className="lg-legend">
        <h2>What these lines mean</h2>
        <p>
          Every amount is written from the <strong>business’s</strong> point of view: positive is owed to them, negative is owed back.
        </p>
        <dl>
          {(Object.keys(ENTRY_LABEL) as LedgerEntryType[]).map((key) => (
            <div key={key}>
              <dt>{ENTRY_LABEL[key]}</dt>
              <dd>{ENTRY_MEANING[key]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

function Line({
  e,
  format,
  signed,
}: {
  e: AdminLedgerEntry;
  format: (minor: number | null | undefined, code?: string | null) => string;
  signed: (minor: number, code?: string | null) => string;
}) {
  const amount = e.settlementAmountMinor ?? e.amountMinor;
  const now = Date.now();
  const payable = e.payoutId
    ? { cls: 'is-paid', text: 'paid out' }
    : e.availableAt === null
      ? // §34.3: null means the booking has not resolved or the hold has not
        // ended. Not "pending" — nothing waits on a process; it is not payable.
        { cls: 'is-held', text: 'held' }
      : new Date(e.availableAt).getTime() > now
        ? { cls: 'is-held', text: `held until ${shortDay(e.availableAt)}` }
        : { cls: 'is-ok', text: 'available' };
  return (
    <li className="lg-line">
      <span className="lg-when">
        <b>{shortDay(e.createdAt)}</b>
        <em>{clock(e.createdAt)}</em>
      </span>
      <span className="lg-shop">
        <ShopMark name={e.businessProfile.name} logoUrl={e.businessProfile.logoUrl} size={30} />
        <b>{e.businessProfile.name ?? 'Unnamed business'}</b>
      </span>
      <span className="lg-what" title={ENTRY_MEANING[e.type]}>
        <b>{ENTRY_LABEL[e.type]}</b>
        {e.appointment ? (
          <Link to={`/appointments?open=${e.appointment.id}`}>
            {e.appointment.service.name} · {shortDay(e.appointment.startTime)}
          </Link>
        ) : e.billingAdjustmentId ? (
          <em>from an adjustment</em>
        ) : null}
      </span>
      <span className={`lg-amount ${amount < 0 ? 'is-neg' : 'is-pos'}`}>
        <b>{signed(amount, e.settlementCurrency ?? e.currency)}</b>
        {e.settlementAmountMinor !== null && e.settlementCurrency !== e.currency && <em>reporting {format(e.amountMinor, e.currency)}</em>}
      </span>
      <span className={`lg-payable ${payable.cls}`}>{payable.text}</span>
    </li>
  );
}
