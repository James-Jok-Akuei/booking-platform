import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getBalance,
  getMe,
  getPayoutDestination,
  listMyPayouts,
  submitPayoutDestination,
  type PayoutDestination,
} from '../api/business';
import { useMoney } from '../money';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * What you are owed, and where it goes.
 *
 * Deliberately one screen. A business owner's question is "when do I get my
 * money", and the answer depends on both halves: an unverified number pauses
 * every payout (§48.3), so a balance shown without the number's status would
 * answer half the question and mislead about the other half.
 */
export function GettingPaidPage() {
  const money = useMoney();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const businessId = me.data?.businessMembership?.businessProfile.id;

  const destination = useQuery({
    queryKey: ['payout-destination'],
    queryFn: getPayoutDestination,
  });
  const balance = useQuery({
    queryKey: ['balance', businessId],
    queryFn: () => getBalance(businessId!),
    enabled: Boolean(businessId),
  });
  const payouts = useQuery({
    queryKey: ['my-payouts', businessId],
    queryFn: () => listMyPayouts(businessId!),
    enabled: Boolean(businessId),
  });

  const isOwner = me.data?.businessMembership?.role === 'OWNER';

  return (
    <section>
      <header className="page-head">
        <h1>Getting paid</h1>
      </header>

      <Destination
        destination={destination.data?.destination ?? null}
        isOwner={isOwner}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['payout-destination'] });
          queryClient.invalidateQueries({ queryKey: ['balance'] });
        }}
      />

      {balance.data && (
        <div className="card setting">
          <div className="setting-head">
            <h2>Your money</h2>
            <p className="muted small">{balance.data.note}</p>
          </div>

          {balance.data.payoutsPaused && (
            <p className="notice">
              <strong>Payouts are paused.</strong>{' '}
              {balance.data.payoutsPausedReason === 'DESTINATION_NOT_VERIFIED'
                ? 'Your payout number has not been confirmed yet. Nothing is lost — ' +
                  'the balance is held and goes out on the first run after it is.'
                : 'This business is suspended. Nothing is written off; the balance ' +
                  'is held until it is reinstated.'}
            </p>
          )}

          <div className="figures">
            <Figure
              label="Ready to send"
              value={money.format(balance.data.availableNowMinor)}
              note="Goes out on the next payout run."
              strong
            />
            <Figure
              label="Still held"
              value={money.format(balance.data.pendingMinor)}
              note="Earned, inside the waiting period after an appointment."
            />
            <Figure
              label="Not yours yet"
              value={money.format(balance.data.unresolvedMinor)}
              note="Appointments that have not been completed or cancelled."
            />
            <Figure
              label="Paid to you so far"
              value={money.format(balance.data.lifetimePaidMinor)}
              note={`${balance.data.payoutCount} payout(s).`}
            />
          </div>

          {/* The deposit is not the price. Saying so here stops a business
              reconciling this screen against its till and finding a gap (§29.2). */}
          <p className="muted small">
            These are deposits only — the balance of each appointment is settled
            with the customer directly and never passes through the platform.
          </p>
        </div>
      )}

      <h2 className="section-title">Payments to you</h2>
      {payouts.data?.payouts.length === 0 && (
        <p className="muted empty">Nothing sent yet.</p>
      )}
      {payouts.data && payouts.data.payouts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Amount</th>
              <th>Run</th>
              <th>Status</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {payouts.data.payouts.map((payout) => (
              <tr key={payout.id}>
                <td>
                  <strong>{money.format(payout.settlementAmountMinor)}</strong>
                </td>
                <td className="small">{when(payout.runAt)}</td>
                <td>
                  <span className={`pill ${payout.status.toLowerCase()}`}>
                    {payout.status}
                  </span>
                  {payout.failureReason && (
                    <div className="muted small">{payout.failureReason}</div>
                  )}
                  {payout.paidAt && (
                    <div className="muted small">{when(payout.paidAt)}</div>
                  )}
                </td>
                <td className="small">{payout.reference ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <div className="figure-block">
      <span className="muted small">{label}</span>
      <span className={strong ? 'figure' : 'figure muted-figure'}>{value}</span>
      <span className="muted small">{note}</span>
    </div>
  );
}

function Destination({
  destination,
  isOwner,
  onSaved,
}: {
  destination: PayoutDestination | null;
  isOwner: boolean;
  onSaved: () => void;
}) {
  const [msisdn, setMsisdn] = useState('');
  const [changing, setChanging] = useState(false);

  const submit = useMutation({
    mutationFn: (value: string) => submitPayoutDestination(value),
    onSuccess: () => {
      setChanging(false);
      setMsisdn('');
      onSaved();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate(msisdn.trim());
  };

  return (
    <div className="card setting">
      <div className="setting-head">
        <h2>Where your money goes</h2>
        <p className="muted small">
          The mobile money number payouts are sent to. Changing it{' '}
          <strong>pauses payouts</strong> until an administrator confirms the new
          one — that check is what stops money going to a number nobody verified.
        </p>
      </div>

      {destination ? (
        <div className="destination">
          <code>{destination.msisdn ?? destination.msisdnLast3}</code>
          <span className={`pill ${destination.status.toLowerCase()}`}>
            {destination.status}
          </span>
          <span className="muted small">
            {destination.status === 'VERIFIED'
              ? `Confirmed ${when(destination.verifiedAt)}. Payouts can go out.`
              : destination.status === 'UNVERIFIED'
                ? 'Waiting on an administrator. Payouts are paused until then.'
                : destination.status === 'REJECTED'
                  ? (destination.rejectionReason ?? 'Refused. Submit another number.')
                  : 'Replaced by a newer number.'}
          </span>
        </div>
      ) : (
        <p className="error small">
          No number yet — <strong>you cannot be paid</strong> until you add one.
        </p>
      )}

      {/* Only the OWNER may submit: it is the one decision that determines where
          money physically goes, and §48 keeps it at that level. */}
      {!isOwner ? (
        <p className="muted small">Only the owner can change this.</p>
      ) : changing || !destination ? (
        <form className="setting-form" onSubmit={onSubmit}>
          <label htmlFor="msisdn">Number</label>
          <input
            id="msisdn"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            placeholder="+250788123456"
            style={{ width: 190 }}
          />
          <button type="submit" className="primary" disabled={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Submit for checking'}
          </button>
          {destination && (
            <button type="button" className="link" onClick={() => setChanging(false)}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <button type="button" onClick={() => setChanging(true)}>
          Change the number
        </button>
      )}

      {submit.error && (
        <p className="error small" role="alert">
          {submit.error instanceof ApiError ? submit.error.message : 'Could not save.'}
        </p>
      )}
    </div>
  );
}
