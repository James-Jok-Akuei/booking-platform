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
import { Icon, type IconName } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark, networkOf } from '../ui/NetworkMark';
import './payouts.css';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const PAYOUT: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'paid' },
  PENDING: { label: 'Pending', cls: 'pending' },
  PROCESSING: { label: 'Processing', cls: 'processing' },
  FAILED: { label: 'Failed', cls: 'failed' },
};

/**
 * What you are owed, and where it goes (§77, §200).
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

  const destination = useQuery({ queryKey: ['payout-destination'], queryFn: getPayoutDestination });
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
  const b = balance.data;
  const number = destination.data?.destination ?? null;
  // Payouts go out through MTN MoMo (the one network the platform sends with, §219).
  const network = number?.provider ?? 'MTN_MOMO';

  return (
    <section className="gp">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Getting paid</h1>
            <p className="muted">Your share of every deposit, sent to your mobile money.</p>
          </div>
        </header>
      </div>

      {b?.payoutsPaused && (
        <div className="gp-paused" role="status">
          <span>
            <Icon name="pause" size={20} />
          </span>
          <p>
            <strong>Payouts are paused.</strong>{' '}
            {b.payoutsPausedReason === 'DESTINATION_NOT_VERIFIED'
              ? 'Your payout number has not been confirmed yet. Nothing is lost — the balance is held and goes out on the first run after it is.'
              : 'This business is suspended. Nothing is written off; the balance is held until it is reinstated.'}
          </p>
        </div>
      )}

      <div className="gp-top">
        <article className="gp-wallet">
          <div className="gp-wallet-head">
            <span className="gp-wallet-label">
              <Icon name="wallet" size={16} /> Ready to send
            </span>
            {/* Where it goes, as a card shows its network (§219). */}
            <NetworkMark network={network} shape="wide" size={34} className="gp-brand" />
          </div>
          <strong className="gp-wallet-amount">{b ? money.format(b.availableNowMinor) : '–'}</strong>
          <p className="gp-wallet-note">Goes out on the next payout run.</p>
          <div className="gp-wallet-foot">
            <div>
              <span>Paid to you so far</span>
              <strong>{b ? money.format(b.lifetimePaidMinor) : '–'}</strong>
            </div>
            <div>
              <span>Payouts</span>
              <strong>{b ? b.payoutCount : '–'}</strong>
            </div>
            <div className="gp-wallet-to">
              <span>To {NETWORK_NAME[network]}</span>
              <strong>
                {number ? `•••• ${(number.msisdn ?? number.msisdnLast3 ?? '').slice(-3)}` : 'No number yet'}
              </strong>
            </div>
          </div>
        </article>

        <Destination
          destination={number}
          isOwner={isOwner}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['payout-destination'] });
            queryClient.invalidateQueries({ queryKey: ['balance'] });
          }}
        />
      </div>

      {b && (
        <article className="gp-flow">
          <header>
            <h2>Your money</h2>
            <p>{b.note}</p>
          </header>
          {/* Where each franc is, left to right: the order money moves in. */}
          <ol className="gp-steps">
            <Step
              icon="hourglass"
              tone="grey"
              label="Not yours yet"
              value={money.format(b.unresolvedMinor)}
              note="Appointments that have not been completed or cancelled."
            />
            <Step
              icon="clock"
              tone="amber"
              label="Still held"
              value={money.format(b.pendingMinor)}
              note="Earned, inside the waiting period after an appointment."
            />
            <Step
              icon="wallet"
              tone="green"
              label="Ready to send"
              value={money.format(b.availableNowMinor)}
              note="Goes out on the next payout run."
              strong
            />
            <Step
              icon="checkCircle"
              tone="night"
              label="Paid to you so far"
              value={money.format(b.lifetimePaidMinor)}
              note={`${b.payoutCount} payout(s).`}
            />
          </ol>
          {/* The deposit is not the price. Saying so here stops a business
              reconciling this screen against its till and finding a gap (§29.2). */}
          <p className="gp-deposits">
            <Icon name="info" size={15} />
            These are deposits only — the balance of each appointment is settled with the customer directly
            and never passes through the platform.
          </p>
        </article>
      )}

      <article className="gp-history">
        <header>
          <h2>Payments to you</h2>
          {payouts.data && payouts.data.payouts.length > 0 && <span>{payouts.data.payouts.length}</span>}
        </header>
        {payouts.isLoading && <div className="skeleton gp-skeleton" />}
        {payouts.data?.payouts.length === 0 && (
          <div className="gp-empty">
            <span>
              <Icon name="banknote" size={26} />
            </span>
            <p>Nothing sent yet.</p>
          </div>
        )}
        {payouts.data && payouts.data.payouts.length > 0 && (
          <ul className="gp-list">
            {payouts.data.payouts.map((payout) => {
              const look = PAYOUT[payout.status] ?? { label: payout.status, cls: '' };
              return (
                <li key={payout.id} className={`gp-row is-${look.cls}`}>
                  <span className="gp-row-icon">
                    <Icon name={payout.status === 'FAILED' ? 'xCircle' : payout.status === 'PAID' ? 'arrowUpRight' : 'clock'} size={18} />
                  </span>
                  <div className="gp-row-main">
                    <strong>{money.format(payout.settlementAmountMinor)}</strong>
                    <span>Run {when(payout.runAt)}</span>
                    {payout.failureReason && <span className="gp-fail">{payout.failureReason}</span>}
                  </div>
                  <div className="gp-row-side">
                    <span className={`pill ${look.cls}`}>{look.label}</span>
                    {payout.paidAt && <span>{when(payout.paidAt)}</span>}
                    {payout.reference && <code>{payout.reference}</code>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

function Step({
  icon,
  tone,
  label,
  value,
  note,
  strong,
}: {
  icon: IconName;
  tone: 'grey' | 'amber' | 'green' | 'night';
  label: string;
  value: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <li className={`gp-step tone-${tone}${strong ? ' is-strong' : ''}`}>
      <span className="gp-step-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="gp-step-label">{label}</span>
      <strong>{value}</strong>
      <span className="gp-step-note">{note}</span>
    </li>
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
  // The network the typed number belongs to, as the server would read it (§58.1).
  const typed = networkOf(msisdn);

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

  const status = destination?.status;
  const tone = status === 'VERIFIED' ? 'ok' : status === 'UNVERIFIED' ? 'warn' : status ? 'bad' : 'none';

  return (
    <article className={`gp-dest tone-${tone}`}>
      <header>
        <NetworkMark network={destination?.provider ?? 'MTN_MOMO'} size={46} className="gp-dest-mark" />
        <div>
          <h2>Where your money goes</h2>
          <p>
            Payouts are sent by <strong>MTN MoMo</strong> to this number. Changing it <strong>pauses payouts</strong>{' '}
            until an administrator confirms the new one — that check is what stops money going to a number
            nobody verified.
          </p>
        </div>
      </header>

      {destination ? (
        <div className="gp-number">
          <div>
            <span className="gp-number-label">
              <NetworkMark network={destination.provider} size={16} /> {NETWORK_NAME[destination.provider]} number
            </span>
            <code>{destination.msisdn ?? destination.msisdnLast3}</code>
          </div>
          <span className={`pill ${destination.status.toLowerCase()}`}>{destination.status.toLowerCase()}</span>
          <p>
            {destination.status === 'VERIFIED'
              ? `Confirmed ${when(destination.verifiedAt)}. Payouts can go out.`
              : destination.status === 'UNVERIFIED'
                ? 'Waiting on an administrator. Payouts are paused until then.'
                : destination.status === 'REJECTED'
                  ? (destination.rejectionReason ?? 'Refused. Submit another number.')
                  : 'Replaced by a newer number.'}
          </p>
        </div>
      ) : (
        <p className="gp-nonumber">
          <Icon name="alert" size={16} />
          <span>
            No number yet — <strong>you cannot be paid</strong> until you add one.
          </span>
        </p>
      )}

      {/* Only the OWNER may submit: it is the one decision that determines where
          money physically goes, and §48 keeps it at that level. */}
      {!isOwner ? (
        <p className="gp-owner-only">
          <Icon name="shield" size={15} /> Only the owner can change this.
        </p>
      ) : changing || !destination ? (
        <form className="gp-form" onSubmit={onSubmit}>
          <label htmlFor="msisdn">Number</label>
          <div>
            <input
              id="msisdn"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="+250788123456"
              inputMode="tel"
            />
            <button type="submit" className="primary" disabled={submit.isPending}>
              {submit.isPending ? 'Sending…' : 'Submit for checking'}
            </button>
          </div>
          {typed && (
            <p className={`gp-typed ${typed === 'MTN_MOMO' ? 'is-ok' : 'is-warn'}`}>
              <NetworkMark network={typed} size={22} />
              {typed === 'MTN_MOMO'
                ? 'An MTN MoMo number — payouts can be sent to it.'
                : 'An Airtel number. Payouts are sent by MTN MoMo only for now, so it could not receive them — use an MTN number (078 or 079).'}
            </p>
          )}
          {destination && (
            <button type="button" className="link" onClick={() => setChanging(false)}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <button type="button" className="gp-change" onClick={() => setChanging(true)}>
          <Icon name="pencil" size={15} /> Change the number
        </button>
      )}

      {submit.error && (
        <p className="error small" role="alert">
          {submit.error instanceof ApiError ? submit.error.message : 'Could not save.'}
        </p>
      )}
    </article>
  );
}
