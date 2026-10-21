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
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';
import { plural } from '@lingui/core/macro';

const PAGE = 30;

/** The ledger's own words for the lines beyond a deposit and its fee (§85, §290). */
const LINE: Record<string, string> = {
  get DEPOSIT_REFUND() { return t`Deposit refunded`; },
  get PLATFORM_FEE_REVERSAL() { return t`Platform fee returned`; },
  get GATEWAY_FEE_DEBIT() { return t`Gateway fee`; },
  get ADJUSTMENT() { return t`Manual adjustment`; },
};

/**
 * How long a payment has been stuck, when that is longer than it should be
 * (§291): waiting to be sent for 3 days or more, or with MTN for a day or
 * more. Null when it is not.
 */
export function overdue(payout: Payout): string | null {
  const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0);
  if (payout.status === 'PENDING' && days(payout.runAt) >= 3) return plural(days(payout.runAt), { one: 'Waiting # day', other: 'Waiting # days' });
  if (payout.status === 'PROCESSING' && days(payout.sentAt) >= 1)
    return plural(days(payout.sentAt), { one: 'With MTN for # day', other: 'With MTN for # days' });
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  get PENDING() { return t`Pending`; },
  get PROCESSING() { return t`Processing`; },
  get PAID() { return t`Paid`; },
  get FAILED() { return t`Failed`; },
};

const at = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(dateLocale(), {
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
      setSaveError(error instanceof ApiError ? error.message : t`That did not download. Check your connection.`);
    } finally {
      setSaving(false);
    }
  };

  const late = overdue(payout);
  const amount = money.format(payout.settlementAmountMinor, currency);
  const ask = () => {
    // Their own words to our team, in their language (§308) — the payment's number stays as it is.
    const workedOut = at(payout.runAt);
    const status = STATUS_LABEL[payout.status] ?? payout.status;
    const subject = t`My payment of ${amount}, worked out on ${workedOut}`;
    const said = late
      ? t`My payment of ${amount}, worked out on ${workedOut}, says “${status}” — ${late}. Could you check it?`
      : t`My payment of ${amount}, worked out on ${workedOut}, says “${status}”. Could you check it?`;
    const body = `${said}\n\n${t`Payment ${payout.id}`}`;
    onClose();
    navigate(`/help?${new URLSearchParams({ new: 'PAYMENT_ISSUE', subject, body }).toString()}`);
  };

  const sendTo = first?.sendTo;
  const network = sendTo ? NETWORK_NAME[sendTo.provider] : '';
  const ending = sendTo?.last3 ?? '';
  const workedOutOn = at(payout.runAt);
  const sentOn = at(payout.sentAt);
  const arrivedOn = at(payout.paidAt);
  const story: Record<string, string> = {
    PENDING: sendTo
      ? t`Worked out on ${workedOutOn}. Our team sends it next, to your ${network} number ending ${ending}.`
      : t`Worked out on ${workedOutOn}. Our team sends it next, to your mobile money number.`,
    PROCESSING: t`Sent on ${sentOn}. Waiting for MTN MoMo to confirm — that usually takes minutes.`,
    PAID: t`Arrived on ${arrivedOn}.`,
    FAILED: t`It did not go through. Nothing is lost: the money was put back and goes out with your next payment.`,
  };

  // Worked out → sent → arrived, each lit once it has happened.
  const steps: Array<{ label: string; when: string | null; icon: IconName }> = [
    { label: t`Worked out`, when: payout.runAt, icon: 'clock' },
    { label: t`Sent`, when: payout.sentAt ?? (payout.status === 'PAID' ? payout.paidAt : null), icon: 'send' },
    { label: payout.status === 'FAILED' ? t`Did not arrive` : t`Arrived`, when: payout.paidAt, icon: 'checkCircle' },
  ];

  return (
    <Panel
      eyebrow={t`Payment to you`}
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
            <Trans>Close</Trans>
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || !first}>
            <Icon name="download" size={16} />
            {saving ? t`Preparing…` : t`Download as a spreadsheet`}
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
                <em>{done ? at(step.when) : payout.status === 'FAILED' && i === 2 ? t`Put back` : t`Not yet`}</em>
              </li>
            );
          })}
        </ol>
        {payout.reference && (
          <p className="gpd-ref"><Trans>MTN MoMo reference <code>{payout.reference}</code></Trans>
          </p>
        )}
      </section>

      {/* Where is my money? — asked in one tap, about this payment (§291). */}
      {late ? (
        <div className="gpd-late" role="status">
          <Icon name="alert" size={18} />
          <p>
            <Trans>
              <strong>{late}.</strong> If that is longer than you expected, ask us — we will check this payment and reply
              on the Help page and by email.
            </Trans>
          </p>
          <button type="button" className="primary" onClick={ask}>
            <Trans>Ask us about it</Trans>
          </button>
        </div>
      ) : (
        <button type="button" className="link gpd-ask" onClick={ask}>
          <Icon name="help" size={15} />
          <Trans>Something wrong with this payment? Ask us about it</Trans>
        </button>
      )}

      <section className="gpd-sum">
        <h3><Trans>What is in it</Trans></h3>
        {!totals ? (
          <div className="skeleton gpd-skel" />
        ) : (
          <dl>
            <div>
              <dt><Trans>Deposits received{' '}</Trans>
                <span>
                  · {totals.bookings} {totals.bookings === 1 ? t`booking` : t`bookings`}
                </span>
              </dt>
              <dd>{fmt(totals.depositsMinor)}</dd>
            </div>
            <div>
              <dt><Trans>Platform fee</Trans></dt>
              <dd>{fmt(totals.platformFeesMinor)}</dd>
            </div>
            {totals.refundsMinor !== 0 && (
              <div>
                <dt><Trans>Deposits refunded</Trans></dt>
                <dd>{fmt(totals.refundsMinor)}</dd>
              </div>
            )}
            {totals.feesReturnedMinor !== 0 && (
              <div>
                <dt><Trans>Platform fee returned</Trans></dt>
                <dd>{fmt(totals.feesReturnedMinor)}</dd>
              </div>
            )}
            {totals.gatewayFeesMinor !== 0 && (
              <div>
                <dt><Trans>Gateway fee</Trans></dt>
                <dd>{fmt(totals.gatewayFeesMinor)}</dd>
              </div>
            )}
            {totals.adjustmentsMinor !== 0 && (
              <div>
                <dt><Trans>Manual adjustments</Trans></dt>
                <dd>{fmt(totals.adjustmentsMinor)}</dd>
              </div>
            )}
            <div className="gpd-total">
              <dt><Trans>You get</Trans></dt>
              <dd>{fmt(totals.netMinor)}</dd>
            </div>
          </dl>
        )}
        <p className="gpd-note">
          <Icon name="info" size={14} />
          <Trans>Deposits only — the rest of each price is paid to you at the shop.</Trans>
        </p>
      </section>

      <section className="gpd-bookings">
        <h3><Trans>The bookings </Trans><span>{totals ? totals.bookings : ''}</span>
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
            {pages.error instanceof ApiError ? pages.error.message : t`Could not load the bookings.`}
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
            {pages.isFetchingNextPage ? t`Loading…` : t`Show more (${bookings.length} of ${totals?.bookings ?? ''})`}
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
                  <strong><Trans>Manual adjustment</Trans></strong>
                  <span>{a.reason ?? t`A correction made by our team.`}</span>
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
      <button type="button" className="gpd-booking" onClick={onOpen} title={t`Open this booking`}>
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
            <Trans>{b.customerEmail} · No. {reservationNo(b.appointmentId)}</Trans>
          </span>
        </span>
        <span className="gpd-money">
          <strong className={`gpd-net${b.netMinor < 0 ? ' is-minus' : ''}`}>{fmt(b.netMinor)}</strong>
          <span>
            <Trans>{fmt(b.depositMinor)} deposit − {fmt(-b.platformFeeMinor)} fee</Trans>
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
