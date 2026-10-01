import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  executeAdjustment,
  heldTotals,
  listAdjustments,
  listBusinesses,
  listLedgerEntries,
  type LedgerEntryType,
} from '../api/admin';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Plain-language names for the entry types in §34's enum. */
const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  DEPOSIT_RECEIVED: 'Deposit received',
  PLATFORM_FEE: 'Platform fee',
  DEPOSIT_REFUND: 'Deposit refunded',
  PLATFORM_FEE_REVERSAL: 'Platform fee returned',
  GATEWAY_FEE_DEBIT: 'Gateway fee',
  ADJUSTMENT: 'Manual adjustment',
};

/**
 * What each line means, and — the part the label cannot carry — WHO gained or
 * lost the money (§86).
 *
 * A legend rather than longer labels: "Platform fee returned" does not say who
 * returns it or who receives it, and no column heading can. Renaming it was
 * tried and reversed (§85), so the words stay and the explanation sits beside
 * them.
 */
const ENTRY_MEANING: Record<LedgerEntryType, string> = {
  DEPOSIT_RECEIVED: "The customer's payment at booking. Owed to the business.",
  PLATFORM_FEE: 'Our cut of that payment, taken from the business.',
  DEPOSIT_REFUND:
    'The customer got their payment back, because the business cancelled.',
  PLATFORM_FEE_REVERSAL:
    'We hand our own cut back too, so the business is not left funding our fee ' +
    'on a booking it earned nothing from. The money reaches the customer, who ' +
    'is refunded in full.',
  GATEWAY_FEE_DEBIT:
    'What the operator charged to move the refund. Borne by the business that ' +
    'cancelled, because it caused it.',
  ADJUSTMENT: 'A correction recorded and executed on the Adjustments tab.',
};

const ADJUSTMENT_LABEL = {
  FEE_REFUND: 'Fee refund',
  GATEWAY_FEE_DEBIT: 'Gateway fee charged back',
} as const;

/**
 * The ledger, and the adjustments that write to it.
 *
 * Read-only except for one button. Executing an adjustment is the only act on
 * this screen that changes a balance, and it does so by APPENDING entries —
 * nothing here edits history, because the database will not allow it (§34.2).
 */
export function LedgerPage() {
  const [tab, setTab] = useState<'adjustments' | 'entries'>('adjustments');

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Money</h1>
          <p className="muted">
            What the platform is holding, and the corrections that change it.
          </p>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={tab === 'adjustments' ? 'tab active' : 'tab'}
            onClick={() => setTab('adjustments')}
          >
            Adjustments
          </button>
          <button
            type="button"
            className={tab === 'entries' ? 'tab active' : 'tab'}
            onClick={() => setTab('entries')}
          >
            Ledger
          </button>
        </div>
      </header>

      <HeldSummary />
      {tab === 'adjustments' ? <Adjustments /> : <Entries />}
    </section>
  );
}

/** Looks up business names once, so every table can print one. */
function useBusinessNames() {
  // 100 is the server's cap on this list, not a guess — asking for more is a
  // 400, which would blank every name on the page.
  const businesses = useQuery({
    queryKey: ['businesses', 'all'],
    queryFn: () => listBusinesses({ limit: 100 }),
    staleTime: 60_000,
  });

  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const business of businesses.data?.businesses ?? []) {
      // A business may genuinely have no name yet — one can be created before
      // its profile is filled in.
      if (business.name) byId.set(business.id, business.name);
    }
    // The id, shortened, when a name is not loaded or not set — never a blank
    // cell, which reads as "no business" rather than "name not to hand".
    return (id: string) => byId.get(id) ?? `${id.slice(0, 8)}…`;
  }, [businesses.data]);
}

function HeldSummary() {
  const money = useMoney();
  const held = useQuery({ queryKey: ['held'], queryFn: heldTotals });

  if (!held.data) return null;

  return (
    <div className="held">
      <div className="held-figures">
        {held.data.bySettlementCurrency.map((row) => (
          <div key={row.settlementCurrency} className="held-figure">
            <strong>{money.format(row.amountMinor, row.settlementCurrency)}</strong>
            <span className="muted small">
              {row.entryCount} entries not yet paid out
            </span>
          </div>
        ))}
        {held.data.bySettlementCurrency.length === 0 && (
          <div className="held-figure">
            <strong>Nothing held</strong>
          </div>
        )}
      </div>
      <p className="muted small">
        As of {formatDate(held.data.asOf)}. This is what the provider's balance should
        hold — <strong>compare it by hand</strong>, nothing reconciles it automatically.
        {held.data.entriesWithoutSettlement > 0 && (
          <>
            {' '}
            <span className="warn">
              {held.data.entriesWithoutSettlement} entries carry no settlement amount and
              are missing from this figure.
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function Adjustments() {
  const money = useMoney();
  const nameOf = useBusinessNames();
  const queryClient = useQueryClient();
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);

  const adjustments = useQuery({
    queryKey: ['adjustments'],
    queryFn: () => listAdjustments({ limit: 200 }),
  });

  const execute = useMutation({
    mutationFn: (input: { id: string; ref?: string }) =>
      executeAdjustment(input.id, input.ref),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['held'] });
    },
  });

  const rows = (adjustments.data?.adjustments ?? []).filter(
    (row) => !onlyOutstanding || row.settledAt === null,
  );

  const run = (id: string, amount: string, type: keyof typeof ADJUSTMENT_LABEL) => {
    const ref = window.prompt(
      `Executing a ${ADJUSTMENT_LABEL[type].toLowerCase()} of ${amount}.\n\n` +
        'This writes ledger entries and changes what the business is owed. It ' +
        'cannot be undone — a mistake is corrected by recording another ' +
        'adjustment, not by reversing this one.\n\n' +
        "The provider's reference, if this was settled by its own transfer. " +
        'Leave blank if it nets against a future payout.',
    );
    if (ref === null) return;
    const trimmed = ref.trim();
    if (trimmed !== '' && trimmed.length < 3) {
      window.alert('A reference needs at least three characters, or leave it blank.');
      return;
    }
    execute.mutate({ id, ref: trimmed === '' ? undefined : trimmed });
  };

  return (
    <>
      <div className="toolbar">
        <label className="inline small">
          <input
            type="checkbox"
            checked={onlyOutstanding}
            onChange={(event) => setOnlyOutstanding(event.target.checked)}
          />
          Only ones still to execute
        </label>
        {adjustments.data && (
          <span className="muted small">
            {adjustments.data.outstanding} outstanding of {adjustments.data.total}
          </span>
        )}
      </div>

      {execute.error && (
        <p className="error" role="alert">
          {execute.error instanceof ApiError ? execute.error.message : 'That did not work.'}
        </p>
      )}

      {adjustments.isLoading && <p className="muted">Loading…</p>}
      {rows.length === 0 && !adjustments.isLoading && (
        <p className="muted empty">
          {onlyOutstanding ? 'Nothing waiting to be executed.' : 'No adjustments recorded.'}
        </p>
      )}

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>What</th>
              <th className="num">Amount</th>
              <th>Why</th>
              <th>Recorded</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{nameOf(row.businessId)}</td>
                <td>{ADJUSTMENT_LABEL[row.type]}</td>
                {/* `amount` is a decimal string in MAJOR units, unlike every
                    other figure on this page. Printed as given, with the code
                    beside it, rather than converted into a minor-unit integer
                    that would look like the ledger column and not match it. */}
                <td className="num">
                  {money.code} {row.amount}
                </td>
                <td className="reason">{row.reason}</td>
                <td className="small">{formatDate(row.createdAt)}</td>
                <td>
                  {row.settledAt ? (
                    <>
                      <span className="pill resolved">Executed</span>
                      <div className="muted small">
                        {formatDate(row.settledAt)}
                        {row.settlementRef && <> · {row.settlementRef}</>}
                        {!row.settlementRef && <> · netted against a payout</>}
                      </div>
                      {row.ledgerEntries.length > 0 && (
                        <div className="muted small">
                          wrote {row.ledgerEntries.length} ledger{' '}
                          {row.ledgerEntries.length === 1 ? 'entry' : 'entries'}
                        </div>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={execute.isPending}
                      onClick={() => run(row.id, `${money.code} ${row.amount}`, row.type)}
                    >
                      Execute
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Entries() {
  const money = useMoney();
  const nameOf = useBusinessNames();
  const [type, setType] = useState<LedgerEntryType | ''>('');

  const ledger = useQuery({
    queryKey: ['ledger', type],
    queryFn: () => listLedgerEntries({ limit: 200, ...(type ? { type } : {}) }),
  });

  return (
    <>
      <div className="toolbar">
        <label className="inline small">
          Showing
          <select value={type} onChange={(event) => setType(event.target.value as LedgerEntryType | '')}>
            <option value="">every kind of entry</option>
            {(Object.keys(ENTRY_LABEL) as LedgerEntryType[]).map((key) => (
              <option key={key} value={key}>
                {ENTRY_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {ledger.data && (
          <span className="muted small">
            {ledger.data.entries.length} of {ledger.data.total}
            {ledger.data.totalsBySettlementCurrency.map((total) => (
              <span key={total.settlementCurrency}>
                {' '}
                · {money.signed(total.amountMinor, total.settlementCurrency)} in view
              </span>
            ))}
          </span>
        )}
      </div>

      {ledger.isLoading && <p className="muted">Loading…</p>}
      {ledger.data?.entries.length === 0 && (
        <p className="muted empty">No entries of that kind.</p>
      )}

      {ledger.data && ledger.data.entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Business</th>
              <th>What happened</th>
              <th className="num">Amount</th>
              <th>Payable</th>
            </tr>
          </thead>
          <tbody>
            {ledger.data.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="small">{formatDate(entry.createdAt)}</td>
                <td>{nameOf(entry.businessId)}</td>
                <td>
                  {ENTRY_LABEL[entry.type]}
                  {entry.billingAdjustmentId && (
                    <div className="muted small">from an adjustment</div>
                  )}
                </td>
                {/* Signed from the business's point of view (§34.2): positive
                    is owed to them, negative is owed back. */}
                <td className={entry.amountMinor < 0 ? 'num negative' : 'num'}>
                  {money.signed(entry.settlementAmountMinor ?? entry.amountMinor,
                    entry.settlementCurrency ?? entry.currency)}
                  {entry.settlementAmountMinor !== null &&
                    entry.settlementCurrency !== entry.currency && (
                      <div className="muted small">
                        reporting {money.signed(entry.amountMinor, entry.currency)}
                      </div>
                    )}
                </td>
                <td className="small">
                  {entry.payoutId ? (
                    <span className="muted">paid out</span>
                  ) : entry.availableAt === null ? (
                    // §34.3: null means the appointment has not resolved, or
                    // the hold has not expired. Not "pending" — nothing is
                    // waiting on a process, the money is simply not payable.
                    <span className="muted">held</span>
                  ) : new Date(entry.availableAt) > new Date() ? (
                    <>held until {formatDate(entry.availableAt)}</>
                  ) : (
                    <span className="ok">available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ledger.data && ledger.data.entries.length > 0 && (
        <div className="legend">
          <h2>What these lines mean</h2>
          <p className="muted small">
            Every amount is written from the <strong>business's</strong> point of view:
            positive is owed to them, negative is owed back.
          </p>
          <dl>
            {(Object.keys(ENTRY_LABEL) as LedgerEntryType[]).map((key) => (
              <div key={key}>
                <dt>{ENTRY_LABEL[key]}</dt>
                <dd className="muted">{ENTRY_MEANING[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}
