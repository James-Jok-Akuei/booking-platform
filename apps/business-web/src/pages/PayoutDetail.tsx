import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, download } from '../api/client';
import { getMyPayout, myPayoutExportPath, type Payout, type PayoutBooking } from '../api/business';
import { STATUS as BOOKING, reservationNo, useServiceCovers } from '../lib/bookingLook';
import { shortDay, clock } from '../lib/time';
import { useMoney } from '../money';
import { Icon, type IconName } from '../ui/Icon';
import { NETWORK_NAME } from '../ui/NetworkMark';
import { Panel } from '../ui/Panel';
import './payout-detail.css';

const PAGE = 30;

/** The ledger's own words for the lines beyond a deposit and its fee (§85, §290). */
const LINE: Record<string, string> = {
  DEPOSIT_REFUND: 'Deposit refunded',
  PLATFORM_FEE_REVERSAL: 'Platform fee returned',
  GATEWAY_FEE_DEBIT: 'Gateway fee',
  ADJUSTMENT: 'Manual adjustment',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  FAILED: 'Failed',
};

const at = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * One payment to the shop, opened (§290): where it is on its way, what it is
 * made of, and every booking whose money is in it — the service, the branch,
 * when, for whom, the deposit, the platform's share and what it adds. A
 * booking opens in Appointments; the whole payment downloads as a spreadsheet
 * for the shop's own books.
 */
export function PayoutDetail({
  businessId,
  payout,
  onClose,
}: {
  businessId: string;
  payout: Payout;
  onClose: () => void;
}) {
  const money = useMoney();
  const navigate = useNavigate();
  const covers = useServiceCovers();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pages = useInfiniteQuery({
    queryKey: ['my-payout', payout.id],
    queryFn: ({ pageParam }) => getMyPayout(businessId, payout.id, { limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.bookings.length < last.totals.bookings ? last.offset + PAGE : undefined,
  });
  const first = pages.data?.pages[0];
  const bookings = useMemo(() => pages.data?.pages.flatMap((p) => p.bookings) ?? [], [pages.data]);
  const totals = first?.totals;

  const currency = payout.settlementCurrency;
  const fmt = (minor: number) => (minor < 0 ? `− ${money.format(-minor, currency)}` : money.format(minor, currency));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await download(myPayoutExportPath(businessId, payout.id), `payout-${payout.runAt.slice(0, 10)}.csv`);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'That did not download. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const sendTo = first?.sendTo;
  const where = sendTo
    ? `your ${NETWORK_NAME[sendTo.provider]} number ending ${sendTo.last3}`
    : 'your mobile money number';
  const story: Record<string, string> = {
    PENDING: `Worked out on ${at(payout.runAt)}. Our team sends it next, to ${where}.`,
    PROCESSING: `Sent on ${at(payout.sentAt)}. Waiting for MTN MoMo to confirm — that usually takes minutes.`,
    PAID: `Arrived on ${at(payout.paidAt)}.`,
    FAILED: 'It did not go through. Nothing is lost: the money was put back and goes out with your next payment.',
  };

  // Worked out → sent → arrived, each lit once it has happened.
  const steps: Array<{ label: string; when: string | null; icon: IconName }> = [
    { label: 'Worked out', when: payout.runAt, icon: 'clock' },
    { label: 'Sent', when: payout.sentAt ?? (payout.status === 'PAID' ? payout.paidAt : null), icon: 'send' },
    { label: payout.status === 'FAILED' ? 'Did not arrive' : 'Arrived', when: payout.paidAt, icon: 'checkCircle' },
  ];

  return (
    <Panel
      eyebrow="Payment to you"
      title={money.format(payout.settlementAmountMinor, currency)}
      onClose={onClose}
      width={640}
      footer={
        <>
          {saveError && (
            <span className="gpd-save-error" role="alert">
              {saveError}
            </span>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || !first}>
            <Icon name="download" size={16} />
            {saving ? 'Preparing…' : 'Download as a spreadsheet'}
          </button>
        </>
      }
    >
      <section className={`gpd-state is-${payout.status.toLowerCase()}`}>
        <div className="gpd-state-head">
          <span className={`pill ${payout.status.toLowerCase()}`}>{STATUS_LABEL[payout.status] ?? payout.status}</span>
          <p>{story[payout.status]}</p>
        </div>
        {payout.status === 'FAILED' && payout.failureReason && <q className="gpd-reason">{payout.failureReason}</q>}
        <ol className="gpd-steps">
          {steps.map((step, i) => {
            const done = Boolean(step.when) && !(payout.status === 'FAILED' && i === 2);
            return (
              <li
                key={step.label}
                className={`${done ? 'is-done' : ''}${payout.status === 'FAILED' && i === 2 ? ' is-bad' : ''}`}
              >
                <span className="gpd-dot">
                  <Icon name={payout.status === 'FAILED' && i === 2 ? 'xCircle' : step.icon} size={15} />
                </span>
                <strong>{step.label}</strong>
                <em>{done ? at(step.when) : payout.status === 'FAILED' && i === 2 ? 'Put back' : 'Not yet'}</em>
              </li>
            );
          })}
        </ol>
        {payout.reference && (
          <p className="gpd-ref">
            MTN MoMo reference <code>{payout.reference}</code>
          </p>
        )}
      </section>

      <section className="gpd-sum">
        <h3>What is in it</h3>
        {!totals ? (
          <div className="skeleton gpd-skel" />
        ) : (
          <dl>
            <div>
              <dt>
                Deposits received{' '}
                <span>
                  · {totals.bookings} {totals.bookings === 1 ? 'booking' : 'bookings'}
                </span>
              </dt>
              <dd>{fmt(totals.depositsMinor)}</dd>
            </div>
            <div>
              <dt>Platform fee</dt>
              <dd>{fmt(totals.platformFeesMinor)}</dd>
            </div>
            {totals.refundsMinor !== 0 && (
              <div>
                <dt>Deposits refunded</dt>
                <dd>{fmt(totals.refundsMinor)}</dd>
              </div>
            )}
            {totals.feesReturnedMinor !== 0 && (
              <div>
                <dt>Platform fee returned</dt>
                <dd>{fmt(totals.feesReturnedMinor)}</dd>
              </div>
            )}
            {totals.gatewayFeesMinor !== 0 && (
              <div>
                <dt>Gateway fee</dt>
                <dd>{fmt(totals.gatewayFeesMinor)}</dd>
              </div>
            )}
            {totals.adjustmentsMinor !== 0 && (
              <div>
                <dt>Manual adjustments</dt>
                <dd>{fmt(totals.adjustmentsMinor)}</dd>
              </div>
            )}
            <div className="gpd-total">
              <dt>You get</dt>
              <dd>{fmt(totals.netMinor)}</dd>
            </div>
          </dl>
        )}
        <p className="gpd-note">
          <Icon name="info" size={14} />
          Deposits only — the rest of each price is paid to you at the shop.
        </p>
      </section>

      <section className="gpd-bookings">
        <h3>
          The bookings <span>{totals ? totals.bookings : ''}</span>
        </h3>
        {pages.isLoading && (
          <div className="gpd-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton gpd-row-skel" />
            ))}
          </div>
        )}
        {pages.error && (
          <p className="error" role="alert">
            {pages.error instanceof ApiError ? pages.error.message : 'Could not load the bookings.'}
          </p>
        )}
        <ul className="gpd-list">
          {bookings.map((b, i) => (
            <Booking
              key={b.appointmentId}
              b={b}
              index={i}
              cover={covers.get(b.serviceId) ?? null}
              fmt={fmt}
              onOpen={() => {
                onClose();
                navigate(`/appointments?open=${b.appointmentId}`);
              }}
            />
          ))}
        </ul>
        {pages.hasNextPage && (
          <button
            type="button"
            className="gpd-more"
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? 'Loading…' : `Show more (${bookings.length} of ${totals?.bookings ?? ''})`}
          </button>
        )}
        {first && first.adjustments.length > 0 && (
          <ul className="gpd-list gpd-adjustments">
            {first.adjustments.map((a) => (
              <li key={a.id} className="gpd-adjustment">
                <span className="gpd-thumb is-adjust">
                  <Icon name="sliders" size={16} />
                </span>
                <span className="gpd-main">
                  <strong>Manual adjustment</strong>
                  <span>{a.reason ?? 'A correction made by our team.'}</span>
                </span>
                <strong className={`gpd-net${a.amountMinor < 0 ? ' is-minus' : ''}`}>{fmt(a.amountMinor)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Panel>
  );
}

function Booking({
  b,
  index,
  cover,
  fmt,
  onOpen,
}: {
  b: PayoutBooking;
  index: number;
  cover: string | null;
  fmt: (minor: number) => string;
  onOpen: () => void;
}) {
  const look = BOOKING[b.status] ?? { label: b.status, cls: '' };
  return (
    <li style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <button type="button" className="gpd-booking" onClick={onOpen} title="Open this booking">
        <span className={`gpd-thumb${cover ? '' : ' is-empty'}`}>
          {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="tag" size={16} />}
        </span>
        <span className="gpd-main">
          <strong>
            {b.serviceName}
            {b.quantity > 1 && <span className="gpd-qty"> × {b.quantity}</span>}
          </strong>
          <span>
            {shortDay(b.startTime)}, {clock(b.startTime)} · {b.branchName}
          </span>
          <span>
            {b.customerEmail} · No. {reservationNo(b.appointmentId)}
          </span>
        </span>
        <span className="gpd-money">
          <strong className={`gpd-net${b.netMinor < 0 ? ' is-minus' : ''}`}>{fmt(b.netMinor)}</strong>
          <span>
            {fmt(b.depositMinor)} deposit − {fmt(-b.platformFeeMinor)} fee
          </span>
          {b.others.map((line) => (
            <span key={line.type} className="gpd-other">
              {LINE[line.type] ?? line.type} {fmt(line.amountMinor)}
            </span>
          ))}
          <span className={`pill ${look.cls}`}>{look.label}</span>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
    </li>
  );
}
