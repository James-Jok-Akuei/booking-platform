import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, download } from '../api/client';
import {
  exportRunUrl,
  heldTotals,
  listPayouts,
  markPayoutFailed,
  markPayoutPaid,
  runPayouts,
  type Payout,
  type PayoutStatus,
  type RunSummary,
} from '../api/admin';

const STATUSES: Array<{ value: PayoutStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'To send' },
  { value: 'PAID', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ALL', label: 'All' },
];

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Minor units, shown with the currency beside them and never divided by 100.
 *
 * A currency's decimal places are a property OF THE CURRENCY (§55.2), and this
 * app does not carry that table. Printing "SSP 2583750 minor" is uglier than
 * "SSP 25,837.50" and it is honest — inventing a decimal point here is exactly
 * the class of mistake §55 and §56 exist to prevent.
 */
const money = (minor: number, currency: string) =>
  `${currency} ${minor.toLocaleString()} minor`;

/**
 * Payouts: what is owed, what has been created, and what has actually been sent.
 *
 * Nothing here moves money. Every transfer is made BY HAND against the provider
 * (§36.7) — this screen creates the list, and records what happened after a
 * human did it. Marking one paid is a claim about the outside world, which is
 * why it demands the provider's reference.
 */
export function PayoutsPage() {
  const [status, setStatus] = useState<PayoutStatus | 'ALL'>('PENDING');
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const queryClient = useQueryClient();

  const held = useQuery({ queryKey: ['held'], queryFn: heldTotals });

  const payouts = useQuery({
    queryKey: ['payouts', status],
    queryFn: () => listPayouts(status === 'ALL' ? {} : { status }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['payouts'] });
    queryClient.invalidateQueries({ queryKey: ['held'] });
  };

  const run = useMutation({
    mutationFn: runPayouts,
    onSuccess: (summary) => {
      setLastRun(summary);
      refresh();
    },
  });

  const mark = useMutation({
    mutationFn: (input: { id: string; action: 'paid' | 'failed'; text: string }) =>
      input.action === 'paid'
        ? markPayoutPaid(input.id, input.text)
        : markPayoutFailed(input.id, input.text),
    onSuccess: refresh,
  });

  const markPaid = (payout: Payout) => {
    const reference = window.prompt(
      `Marking ${money(payout.settlementAmountMinor, payout.settlementCurrency)} as sent.\n\n` +
        "Enter the provider's transfer reference. Without it this payout cannot " +
        'be reconciled against a statement, and the statement is the only thing ' +
        'that proves the money left.',
    );
    if (reference === null) return;
    if (reference.trim().length < 3) {
      window.alert('A reference of at least 3 characters is required.');
      return;
    }
    mark.mutate({ id: payout.id, action: 'paid', text: reference.trim() });
  };

  const markFailed = (payout: Payout) => {
    const reason = window.prompt(
      'Marking this payout failed returns its money to the pool, so it will be ' +
        'picked up by the next run. Why did it fail?',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert('A reason of at least 3 characters is required.');
      return;
    }
    mark.mutate({ id: payout.id, action: 'failed', text: reason.trim() });
  };

  return (
    <section>
      <header className="page-head">
        <h1>Payouts</h1>
        <div className="tabs">
          {STATUSES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === status ? 'tab active' : 'tab'}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {held.data && (
        <div className="card summary">
          <div>
            <h2>Unsettled</h2>
            {held.data.bySettlementCurrency.length === 0 ? (
              <p className="muted">Nothing waiting.</p>
            ) : (
              held.data.bySettlementCurrency.map((row) => (
                <p key={row.settlementCurrency} className="figure">
                  {money(row.amountMinor, row.settlementCurrency)}
                  <span className="muted small"> · {row.entryCount} entries</span>
                </p>
              ))
            )}
            {held.data.entriesWithoutSettlement > 0 && (
              <p className="error small">
                {held.data.entriesWithoutSettlement} entries have no settlement amount
                and cannot be paid.
              </p>
            )}
          </div>
          <button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Running…' : 'Run payouts'}
          </button>
        </div>
      )}

      {run.error && (
        <p className="error" role="alert">
          {run.error instanceof ApiError ? run.error.message : 'The run failed.'}
        </p>
      )}

      {lastRun && (
        <div className="card summary run-result">
          <div>
            <h2>Last run — {formatDate(lastRun.runAt)}</h2>
            <p>
              <strong>{lastRun.payoutsCreated}</strong> payouts created from{' '}
              {lastRun.businessesConsidered} businesses considered
              {lastRun.settlementCurrencies.length > 0 && (
                <> · {lastRun.totalMinor.toLocaleString()} minor across{' '}
                  {lastRun.settlementCurrencies.join(', ')}</>
              )}
              .
            </p>

            {/* Held-back businesses are listed, never summarised away: a smaller
                batch with no explanation is how a business quietly stops being
                paid (§48.3). */}
            {lastRun.pausedBusinesses.length > 0 && (
              <>
                <p className="error small">
                  {lastRun.pausedBusinesses.length} business(es) held back — these are
                  NOT being paid until fixed:
                </p>
                <ul className="small">
                  {lastRun.pausedBusinesses.map((paused) => (
                    <li key={paused.businessId}>
                      <code>{paused.businessId.slice(0, 8)}</code> — {paused.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {lastRun.skippedNonPositive > 0 && (
              <p className="muted small">
                {lastRun.skippedNonPositive} skipped for a zero or negative balance —
                their debt carries forward rather than being forgiven.
              </p>
            )}
          </div>
        </div>
      )}

      {mark.error && (
        <p className="error" role="alert">
          {mark.error instanceof ApiError ? mark.error.message : 'That did not work.'}
        </p>
      )}

      {payouts.isLoading && <p className="muted">Loading…</p>}

      {payouts.data && payouts.data.payouts.length === 0 && (
        <p className="muted empty">
          No payouts {status === 'ALL' ? 'yet' : `with status ${status}`}.
        </p>
      )}

      {payouts.data && payouts.data.payouts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>To send</th>
              <th>Run</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {payouts.data.payouts.map((payout) => (
              <tr key={payout.id}>
                <td>
                  <code>{payout.businessId.slice(0, 8)}</code>
                </td>
                <td>
                  <strong>
                    {money(payout.settlementAmountMinor, payout.settlementCurrency)}
                  </strong>
                  {/* Reporting only. The settlement figure above is what is sent. */}
                  <div className="muted small">
                    reporting {money(payout.amountMinor, payout.currency)}
                  </div>
                </td>
                <td className="small">{formatDate(payout.runAt)}</td>
                <td>
                  <span className={`pill ${payout.status.toLowerCase()}`}>
                    {payout.status}
                  </span>
                  {payout.reference && (
                    <div className="muted small">Ref: {payout.reference}</div>
                  )}
                  {payout.failureReason && (
                    <div className="muted small">{payout.failureReason}</div>
                  )}
                  {payout.paidAt && (
                    <div className="muted small">{formatDate(payout.paidAt)}</div>
                  )}
                </td>
                <td className="actions">
                  {payout.status === 'PENDING' && (
                    <>
                      <button
                        type="button"
                        disabled={mark.isPending}
                        onClick={() => markPaid(payout)}
                      >
                        Mark sent
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={mark.isPending}
                        onClick={() => markFailed(payout)}
                      >
                        Failed
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      download(
                        exportRunUrl(payout.id),
                        `payout-run-${payout.runAt.slice(0, 10)}.csv`,
                      )
                    }
                  >
                    Export run
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {payouts.data && (
        <p className="muted count">
          {payouts.data.payouts.length} of {payouts.data.total}
        </p>
      )}
    </section>
  );
}
