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

/**
 * Everyday names for the entry types in §34's enum (§85).
 *
 * The enum names are accounting words. These say who gained or lost what,
 * which is the only question anyone reads this table to answer.
 */
const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  DEPOSIT_RECEIVED: 'Customer paid',
  PLATFORM_FEE: 'Our fee',
  DEPOSIT_REFUND: 'Customer got their money back',
  PLATFORM_FEE_REVERSAL: 'We gave our fee back',
  GATEWAY_FEE_DEBIT: 'Mobile money charge',
  ADJUSTMENT: 'A fix done by hand',
};

const ADJUSTMENT_LABEL = {
  FEE_REFUND: 'Give our fee back',
  GATEWAY_FEE_DEBIT: 'Charge the shop for the mobile money fee',
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
            Money we are holding for shops, and the fixes that change it.
          </p>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={tab === 'adjustments' ? 'tab active' : 'tab'}
            onClick={() => setTab('adjustments')}
          >
            Fixes
          </button>
          <button
            type="button"
            className={tab === 'entries' ? 'tab active' : 'tab'}
            onClick={() => setTab('entries')}
          >
            Money records
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
              {row.entryCount} records of money we have not sent yet
            </span>
          </div>
        ))}
        {held.data.bySettlementCurrency.length === 0 && (
          <div className="held-figure">
            <strong>We are holding nothing</strong>
          </div>
        )}
      </div>
      <p className="muted small">
        Counted at {formatDate(held.data.asOf)}. The mobile money account should hold
        this much. <strong>Go and check it yourself</strong> — nothing checks it for you.
        {held.data.entriesWithoutSettlement > 0 && (
          <>
            {' '}
            <span className="warn">
              {held.data.entriesWithoutSettlement} records do not say how much will be
              paid, so they are not counted above.
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
      `You are about to apply a ${ADJUSTMENT_LABEL[type].toLowerCase()} of ${amount}.\n\n` +
        'This changes how much money the shop is owed, and you cannot undo it. ' +
        'If it turns out to be wrong, you fix it by writing a new fix — you ' +
        'cannot take this one back.\n\n' +
        'If the money was already sent on its own and you have a reference ' +
        'number for it, type it here. If it will just come off the shop\'s next ' +
        'payment, leave this empty.',
    );
    if (ref === null) return;
    const trimmed = ref.trim();
    if (trimmed !== '' && trimmed.length < 3) {
      window.alert('A reference number needs at least three letters. Or leave it empty.');
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
          Only the ones still to do
        </label>
        {adjustments.data && (
          <span className="muted small">
            {adjustments.data.outstanding} still to do, out of {adjustments.data.total}
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
          {onlyOutstanding
            ? 'Nothing is waiting to be done.'
            : 'No fixes have been written down yet.'}
        </p>
      )}

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Shop</th>
              <th>What kind of fix</th>
              <th className="num">How much</th>
              <th>Why</th>
              <th>Written down</th>
              <th>Done?</th>
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
                      <span className="pill resolved">Done</span>
                      <div className="muted small">
                        {formatDate(row.settledAt)}
                        {row.settlementRef && <> · {row.settlementRef}</>}
                        {!row.settlementRef && <> · taken off a future payment</>}
                      </div>
                      {row.ledgerEntries.length > 0 && (
                        <div className="muted small">
                          added {row.ledgerEntries.length} money{' '}
                          {row.ledgerEntries.length === 1 ? 'record' : 'records'}
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
                      Apply this fix
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
            <option value="">all kinds</option>
            {(Object.keys(ENTRY_LABEL) as LedgerEntryType[]).map((key) => (
              <option key={key} value={key}>
                {ENTRY_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {ledger.data && (
          <span className="muted small">
            {ledger.data.entries.length} of {ledger.data.total} shown
            {ledger.data.totalsBySettlementCurrency.map((total) => (
              <span key={total.settlementCurrency}>
                {' '}
                · they add up to {money.signed(total.amountMinor, total.settlementCurrency)}
              </span>
            ))}
          </span>
        )}
      </div>

      {ledger.isLoading && <p className="muted">Loading…</p>}
      {ledger.data?.entries.length === 0 && (
        <p className="muted empty">No records of that kind.</p>
      )}

      {ledger.data && ledger.data.entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Shop</th>
              <th>What happened</th>
              <th className="num">How much</th>
              <th>Can we send it?</th>
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
                    <div className="muted small">from a fix</div>
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
                        same as {money.signed(entry.amountMinor, entry.currency)}
                      </div>
                    )}
                </td>
                <td className="small">
                  {entry.payoutId ? (
                    <span className="muted">already sent</span>
                  ) : entry.availableAt === null ? (
                    // §34.3: null means the appointment has not resolved, or
                    // the hold has not expired. Not "pending" — nothing is
                    // waiting on a process, the money is simply not payable.
                    <span className="muted">waiting</span>
                  ) : new Date(entry.availableAt) > new Date() ? (
                    <>waiting until {formatDate(entry.availableAt)}</>
                  ) : (
                    <span className="ok">ready to send</span>
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
