import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, download } from '../api/client';
import { useMoney } from '../money';
import {
  exportRunUrl,
  getOverview,
  heldTotals,
  listPayouts,
  markPayoutFailed,
  markPayoutPaid,
  runPayouts,
  sendPayout,
  type Payout,
  type PayoutStatus,
  type RunSummary,
} from '../api/admin';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark } from '../ui/NetworkMark';
import { ShopMark } from '../ui/ShopMark';
import './payouts.css';

type Tab = PayoutStatus | 'ALL';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'PENDING', label: 'To send' },
  { value: 'PROCESSING', label: 'With the operator' },
  { value: 'PAID', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ALL', label: 'All' },
];

const STATUS: Record<PayoutStatus, { label: string; cls: string }> = {
  PENDING: { label: 'To send', cls: 'pending' },
  PROCESSING: { label: 'With the operator', cls: 'processing' },
  PAID: { label: 'Sent', cls: 'paid' },
  FAILED: { label: 'Failed', cls: 'failed' },
};

const PAGE = 25;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const spaced = (msisdn: string) => {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.startsWith('250') && digits.length === 12) return `+250 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  return msisdn;
};

/**
 * Payouts, as a wallet (§246, §35, §36, §64).
 *
 * What the platform is holding for shops, what is ready to go, and each
 * payout as a card: who, to which number, how much, and the one thing to do
 * next. Sending hands one payout to the operator (§64.4) — one at a time, on
 * purpose; "Sent by hand" records a transfer made outside the platform, with
 * its reference, which is the only thing that proves the money left. Running
 * payouts works out what each shop is owed and says, by name, whom it had to
 * hold back and why — so nobody stops being paid without anyone noticing
 * (§48.3).
 */
export function PayoutsPage() {
  const { format: money } = useMoney();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'PENDING';
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const queryClient = useQueryClient();

  const held = useQuery({ queryKey: ['held'], queryFn: heldTotals });
  // What is ready to send, already added up by the server (§243).
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: getOverview });

  const list = useInfiniteQuery({
    queryKey: ['payouts', tab],
    queryFn: ({ pageParam }) => listPayouts({ ...(tab === 'ALL' ? {} : { status: tab }), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.payouts.length < last.total ? last.offset + PAGE : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.payouts) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const counts = useQuery({
    queryKey: ['payouts', 'counts'],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          TABS.map(async (t) => [t.value, (await listPayouts({ ...(t.value === 'ALL' ? {} : { status: t.value }), limit: 1 })).total] as const),
        ),
      ) as Record<Tab, number>,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payouts'] });
    void queryClient.invalidateQueries({ queryKey: ['held'] });
  };

  const run = useMutation({
    mutationFn: runPayouts,
    onSuccess: (summary) => {
      setLastRun(summary);
      refresh();
    },
  });

  // The result is PROCESSING, never PAID: whether the money arrived is decided
  // by the status poll a minute later (§64.3).
  const send = useMutation({ mutationFn: sendPayout, onSuccess: refresh });

  const mark = useMutation({
    mutationFn: (input: { id: string; action: 'paid' | 'failed'; text: string }) =>
      input.action === 'paid' ? markPayoutPaid(input.id, input.text) : markPayoutFailed(input.id, input.text),
    onSuccess: refresh,
  });

  const askRun = async () => {
    const sure = await confirmDialog({
      title: 'Run payouts?',
      body: (
        <>
          <p>
            This works out what each shop is owed — money whose hold has passed — and makes one payout per shop, ready to
            send. <strong>No money moves yet</strong>: each payout is sent on its own afterwards.
          </p>
          <p>Shops that cannot be paid (suspended, or with no checked payout number) are held back and listed by name.</p>
        </>
      ),
      tone: 'info',
      icon: 'send',
      confirmLabel: 'Run payouts',
      cancelLabel: 'Not now',
    });
    if (sure) run.mutate();
  };

  const askSend = async (p: Payout) => {
    const sure = await confirmDialog({
      title: `Send ${money(p.settlementAmountMinor, p.settlementCurrency)}?`,
      body: (
        <p>
          To <strong>{p.businessName ?? 'this business'}</strong> at <strong>{spaced(p.destinationMsisdn ?? '')}</strong>.
          This moves real money through the operator and cannot be undone.
        </p>
      ),
      tone: 'warn',
      icon: 'send',
      confirmLabel: 'Send the money',
      cancelLabel: 'Not now',
    });
    if (sure) send.mutate(p.id);
  };

  const askPaid = async (p: Payout) => {
    const reference = await promptDialog({
      title: 'Mark this payout as sent by hand?',
      body: (
        <p>
          <strong>{money(p.settlementAmountMinor, p.settlementCurrency)}</strong> to{' '}
          <strong>{p.businessName ?? 'this business'}</strong>. Without the provider’s reference this payout cannot be
          matched against a statement — and the statement is the only proof the money left.
        </p>
      ),
      label: 'The provider’s transfer reference',
      placeholder: 'For example: 4823019937',
      minLength: 3,
      minMessage: 'A reference of at least 3 characters.',
      tone: 'ok',
      icon: 'checkCircle',
      confirmLabel: 'Mark as sent',
      cancelLabel: 'Not yet',
    });
    if (reference !== null) mark.mutate({ id: p.id, action: 'paid', text: reference.trim() });
  };

  const askFailed = async (p: Payout) => {
    const reason = await promptDialog({
      title: 'Mark this payout as failed?',
      body: <p>Its money goes back to the pool, so the next run picks it up again.</p>,
      label: 'Why did it fail?',
      placeholder: 'For example: the number is not registered for MoMo.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'danger',
      icon: 'xCircle',
      confirmLabel: 'Mark as failed',
      cancelLabel: 'Not now',
    });
    if (reason !== null) mark.mutate({ id: p.id, action: 'failed', text: reason.trim() });
  };

  const heldLine = held.data?.bySettlementCurrency.map((h) => money(h.amountMinor, h.settlementCurrency)).join(' + ');
  const ready = overview.data?.waiting.payouts;
  const error = run.error ?? send.error ?? mark.error ?? list.error;

  return (
    <section className="po">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Payouts</h1>
            <p className="muted">Money owed to shops, and sending it.</p>
          </div>
          <button type="button" className="po-run" disabled={run.isPending} onClick={() => void askRun()}>
            <Icon name="refresh" size={18} />
            {run.isPending ? 'Working it out…' : 'Run payouts'}
          </button>
        </header>
      </div>

      {/* The wallet. */}
      <div className="po-wallet">
        <div className="po-wallet-main">
          <span className="po-wallet-label">Held for shops, not yet paid out</span>
          <strong className="po-wallet-amount">{held.data ? heldLine || money(0) : '…'}</strong>
          <span className="po-wallet-sub">
            {held.data ? `${held.data.totalEntries} ${held.data.totalEntries === 1 ? 'entry' : 'entries'} in the ledger` : ' '}
          </span>
          {held.data && held.data.entriesWithoutSettlement > 0 && (
            <span className="po-wallet-warn">
              <Icon name="alert" size={15} />
              {held.data.entriesWithoutSettlement} entries have no settlement amount and cannot be paid.
            </span>
          )}
        </div>
        <div className="po-wallet-side">
          <div>
            <span>Ready to send</span>
            <strong>{ready ? (ready.count > 0 ? ready.amounts.map((a) => money(a.amountMinor, a.currency)).join(' + ') : money(0)) : '…'}</strong>
            <em>{ready ? `${ready.count} ${ready.count === 1 ? 'payout' : 'payouts'}` : ' '}</em>
          </div>
          <div>
            <span>With the operator</span>
            <strong>{counts.data ? counts.data.PROCESSING : '…'}</strong>
            <em>checked every minute</em>
          </div>
          <div>
            <span>Sent so far</span>
            <strong>{counts.data ? counts.data.PAID : '…'}</strong>
            <em>payouts</em>
          </div>
        </div>
      </div>

      {lastRun && <RunResult run={lastRun} money={money} onClose={() => setLastRun(null)} />}

      <div className="qtabs" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={`qtab${tab === t.value ? ' is-on' : ''}`}
            onClick={() =>
              setParams(
                (now) => {
                  const out = new URLSearchParams(now);
                  if (t.value === 'PENDING') out.delete('status');
                  else out.set('status', t.value);
                  return out;
                },
                { replace: true },
              )
            }
          >
            {t.label}
            {counts.data && (
              <span className={(t.value === 'PENDING' || t.value === 'FAILED') && counts.data[t.value] > 0 ? 'is-hot' : ''}>
                {counts.data[t.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="error q-error" role="alert">
          <Icon name="alert" size={16} />
          {error instanceof ApiError ? error.message : 'That did not work.'}
        </p>
      )}

      {list.isLoading && (
        <div className="po-list">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton po-skel" />
          ))}
        </div>
      )}

      {list.data && rows.length === 0 && (
        <div className="q-empty">
          <span>
            <Icon name={tab === 'PENDING' ? 'checkCircle' : 'send'} size={26} />
          </span>
          <strong>{tab === 'PENDING' ? 'Nothing to send' : tab === 'FAILED' ? 'No failed payouts' : 'No payouts here'}</strong>
          <p className="muted">
            {tab === 'PENDING' ? 'Run payouts to work out what each shop is owed now.' : 'None are in this state just now.'}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="po-list">
          {rows.map((p) => (
            <Row
              key={p.id}
              p={p}
              money={money}
              busy={(send.isPending && send.variables === p.id) || (mark.isPending && mark.variables?.id === p.id)}
              onSend={() => void askSend(p)}
              onPaid={() => void askPaid(p)}
              onFailed={() => void askFailed(p)}
            />
          ))}
        </ul>
      )}

      {list.data && rows.length > 0 && (
        <div className="q-more">
          <span className="muted small">
            {rows.length} of {total}
          </span>
          {list.hasNextPage && (
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  p,
  money,
  busy,
  onSend,
  onPaid,
  onFailed,
}: {
  p: Payout;
  money: (minor: number | null | undefined, code?: string | null) => string;
  busy: boolean;
  onSend: () => void;
  onPaid: () => void;
  onFailed: () => void;
}) {
  const look = STATUS[p.status];
  const network = p.destinationProvider === 'AIRTEL_MONEY' ? 'AIRTEL_MONEY' : 'MTN_MOMO';
  return (
    <li className={`po-row is-${look.cls}`}>
      <span className="po-shop">
        <ShopMark name={p.businessName} logoUrl={p.businessProfile.logoUrl} size={46} />
        <span>
          <strong>{p.businessName ?? <em className="muted">No name</em>}</strong>
          {p.destinationMsisdn ? (
            <span className="po-to">
              <NetworkMark network={network} size={18} />
              {spaced(p.destinationMsisdn)} · {NETWORK_NAME[network]}
            </span>
          ) : (
            // No checked number is also why Send is off, so the row says it.
            <Link to="/payout-destinations" className="po-nonumber">
              <Icon name="alert" size={14} />
              No checked payout number — check one first
            </Link>
          )}
        </span>
      </span>

      <span className="po-amount">
        <strong>{money(p.settlementAmountMinor, p.settlementCurrency)}</strong>
        {p.currency !== p.settlementCurrency && <span>reporting {money(p.amountMinor, p.currency)}</span>}
      </span>

      <span className="po-when">
        <span className={`pill ${look.cls}`}>{look.label}</span>
        <span>
          {p.status === 'PAID'
            ? `Sent ${when(p.paidAt)}`
            : p.status === 'PROCESSING'
              ? `Handed over ${when(p.sentAt)}`
              : `Run ${when(p.runAt)}`}
        </span>
        {p.reference && <span className="po-ref">Ref. {p.reference}</span>}
        {p.failureReason && <span className="po-fail">“{p.failureReason}”</span>}
        <button
          type="button"
          className="link po-export"
          onClick={() => void download(exportRunUrl(p.id), `payout-run-${p.runAt.slice(0, 10)}.csv`)}
          title="The whole run as a spreadsheet, for checking against the operator's statement"
        >
          <Icon name="external" size={14} />
          Export the run
        </button>
      </span>

      <span className="po-actions">
        {p.status === 'PENDING' && (
          <>
            <button type="button" className="primary" disabled={busy || !p.destinationMsisdn} onClick={onSend}>
              <Icon name="send" size={16} />
              Send
            </button>
            {/* Secondary: for a day the operator's API is down and somebody pays by hand. */}
            <button type="button" className="link" disabled={busy} onClick={onPaid}>
              Sent by hand
            </button>
            <button type="button" className="link danger-link" disabled={busy} onClick={onFailed}>
              Mark failed
            </button>
          </>
        )}
        {p.status === 'PROCESSING' && (
          <span className="po-wait">
            <i />
            With the operator — checked every minute
          </span>
        )}
      </span>
    </li>
  );
}

/** What the run did — and, by name, whom it held back and why (§48.3). */
function RunResult({
  run,
  money,
  onClose,
}: {
  run: RunSummary;
  money: (minor: number | null | undefined, code?: string | null) => string;
  onClose: () => void;
}) {
  const created = run.payoutsCreated;
  return (
    <div className="po-run-result">
      <header>
        <span className={`po-run-icon${created > 0 ? ' is-ok' : ''}`}>
          <Icon name={created > 0 ? 'checkCircle' : 'info'} size={20} />
        </span>
        <span>
          <strong>
            {created > 0
              ? `${created} ${created === 1 ? 'payout' : 'payouts'} ready to send${
                  run.settlementCurrencies.length === 1 ? ` — ${money(run.totalMinor, run.settlementCurrencies[0])}` : ''
                }`
              : 'Nothing new to pay out'}
          </strong>
          <em>
            {run.businessesConsidered} {run.businessesConsidered === 1 ? 'shop' : 'shops'} considered ·{' '}
            {new Date(run.runAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </em>
        </span>
        <button type="button" className="po-run-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      {run.pausedBusinesses.length > 0 && (
        <div className="po-held">
          <p>
            <Icon name="alert" size={16} />
            <strong>
              {run.pausedBusinesses.length} {run.pausedBusinesses.length === 1 ? 'shop was' : 'shops were'} held back — not
              paid until fixed:
            </strong>
          </p>
          <ul>
            {run.pausedBusinesses.map((b) => (
              <li key={b.businessId}>
                <strong>{b.name ?? 'A shop with no name'}</strong>
                {b.reason === 'SUSPENDED' ? (
                  <Link to={`/businesses?status=SUSPENDED&open=${b.businessId}`}>Suspended</Link>
                ) : (
                  <Link to="/payout-destinations">No checked payout number</Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.skippedNonPositive > 0 && (
        <p className="po-skipped">
          {run.skippedNonPositive} {run.skippedNonPositive === 1 ? 'shop' : 'shops'} skipped for a zero or negative
          balance — what they owe carries forward rather than being forgiven.
        </p>
      )}
    </div>
  );
}
