import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  getAppointment,
  cancelAppointment,
  completeAppointment,
  getCurrency,
  getMe,
  listAppointments,
  markNoShow,
  verifyArrival,
  verifyManually,
  type Appointment,
  type AppointmentStatus,
} from '../api/business';

const TABS: Array<{ value: AppointmentStatus | 'ALL'; label: string }> = [
  { value: 'BOOKED', label: 'Expected' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { value: 'COMPLETED', label: 'Done' },
  { value: 'ALL', label: 'All' },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The day's work.
 *
 * Defaults to `BOOKED` — the people who are expected and have not arrived yet —
 * because that is what someone opens this app to deal with. Everything else is
 * a tab away.
 */
export function AppointmentsPage() {
  const [status, setStatus] = useState<AppointmentStatus | 'ALL'>('BOOKED');
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const currency = useQuery({ queryKey: ['currency'], queryFn: getCurrency });

  const appointments = useQuery({
    queryKey: ['appointments', status],
    queryFn: () => listAppointments(status === 'ALL' ? {} : { status }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['appointments'] });

  const act = useMutation({
    mutationFn: (input: { id: string; action: string; text?: string }) => {
      switch (input.action) {
        case 'verify':
          return verifyArrival(input.id, input.text!);
        case 'verify-manually':
          return verifyManually(input.id, input.text!);
        case 'complete':
          return completeAppointment(input.id);
        case 'no-show':
          return markNoShow(input.id);
        case 'cancel':
          return cancelAppointment(input.id, input.text!);
        default:
          throw new Error(`Unknown action ${input.action}`);
      }
    },
    onSuccess: refresh,
  });

  /**
   * Minor units rendered as money, using the exponent the SERVER reports.
   *
   * Never a hardcoded /100: that is right in a two-decimal currency and wrong
   * by a hundred in one with no minor unit (§55.2). While the exponent is still
   * loading the raw figure is shown with its code, which is ugly and never
   * wrong.
   */
  const money = (minor: number) => {
    const c = currency.data;
    if (!c) return `${minor}`;
    if (c.exponent === 0) return `${c.code} ${minor.toLocaleString()}`;
    return `${c.code} ${(minor / c.minorUnitsPerMajor).toFixed(c.exponent)}`;
  };

  const canVerifyManually =
    me.data?.businessMembership?.role === 'OWNER' ||
    me.data?.businessMembership?.role === 'MANAGER';

  return (
    <section>
      <header className="page-head">
        <h1>Appointments</h1>
        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={tab.value === status ? 'tab active' : 'tab'}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {act.error && (
        <p className="error" role="alert">
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}

      {appointments.isLoading && <p className="muted">Loading…</p>}

      {appointments.data?.appointments.length === 0 && (
        <p className="muted empty">Nothing here.</p>
      )}

      {appointments.data && appointments.data.appointments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Customer</th>
              <th>Service</th>
              <th>You earn</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {appointments.data.appointments.map((appointment) => (
              <Row
                key={appointment.id}
                appointment={appointment}
                money={money}
                busy={act.isPending && act.variables?.id === appointment.id}
                canVerifyManually={canVerifyManually}
                onAct={(action, text) => act.mutate({ id: appointment.id, action, text })}
              />
            ))}
          </tbody>
        </table>
      )}

      {appointments.data && (
        <p className="muted count">
          {appointments.data.appointments.length} of {appointments.data.total}
        </p>
      )}
    </section>
  );
}

/**
 * The payment trail for one appointment (§96).
 *
 * Separate from the list because it is reached rarely and for one reason: a
 * customer disputes a charge, and the business needs the operator's reference
 * and the exact figures behind it. Nothing else on the screen carries those.
 */
function AppointmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const money = useMoney();
  const detail = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => getAppointment(id),
  });
  const d = detail.data;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>Booking details</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close this panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {!d ? (
          <p className="muted">Loading\u2026</p>
        ) : (
          <dl className="detail">
            <div><dt>Customer</dt><dd>{d.customer.email}</dd></div>
            <div><dt>Service</dt><dd>
              {d.service.name}
              {d.quantity > 1 &&
                (d.service.quantityMode === 'PEOPLE'
                  ? ` · ${d.quantity} people`
                  : ` × ${d.quantity}`)}
            </dd></div>
            <div><dt>Branch</dt><dd>{d.location.name}</dd></div>
            <div><dt>Status</dt><dd>{d.status.replace('_', ' ').toLowerCase()}</dd></div>
            <div>
              <dt>Deposit</dt>
              <dd>
                {money.format(d.depositAmountMinor, d.currency)}
                {d.depositPaidAt ? ` \u00b7 paid ${when(d.depositPaidAt)}` : ' \u00b7 not paid'}
              </dd>
            </div>
            <div><dt>Your share</dt><dd>{money.format(d.businessAmountMinor, d.currency)}</dd></div>
            <div><dt>Platform fee</dt><dd>{money.format(d.platformFeeAmountMinor, d.currency)}</dd></div>
            {d.servicePriceMinor !== null && (
              <div>
                <dt>Full price</dt>
                <dd>
                  {money.format(d.servicePriceMinor, d.currency)}
                  <div className="muted small">
                    The rest is paid to you directly, not through us.
                  </div>
                </dd>
              </div>
            )}
            {d.paymentProviderReferenceId && (
              <div>
                <dt>Operator reference</dt>
                <dd><code>{d.paymentProviderReferenceId}</code></dd>
              </div>
            )}
            {d.providerAmountMinor !== null && d.providerCurrency && (
              <div>
                <dt>Charged by the operator</dt>
                <dd>
                  {d.providerCurrency} {d.providerAmountMinor}
                  {d.exchangeRateUsed && (
                    <div className="muted small">rate used {d.exchangeRateUsed}</div>
                  )}
                </dd>
              </div>
            )}
            {d.verifiedAt && <div><dt>Customer arrived</dt><dd>{when(d.verifiedAt)}</dd></div>}
            {d.cancelledAt && (
              <div>
                <dt>Cancelled</dt>
                <dd>
                  {when(d.cancelledAt)} by {String(d.cancelledBy).toLowerCase()}
                  {d.cancellationReason && (
                    <div className="muted small">{d.cancellationReason}</div>
                  )}
                </dd>
              </div>
            )}
            <div><dt>Booked</dt><dd>{when(d.createdAt)}</dd></div>
          </dl>
        )}
      </aside>
    </div>
  );
}

function Row({
  appointment,
  money,
  busy,
  canVerifyManually,
  onAct,
}: {
  appointment: Appointment;
  money: (minor: number) => string;
  busy: boolean;
  canVerifyManually: boolean;
  onAct: (action: string, text?: string) => void;
}) {
  const [code, setCode] = useState('');
  const [detail, setDetail] = useState(false);

  const askManual = () => {
    const note = window.prompt(
      'Verifying without the code. What did the customer recall — the booking ' +
        'time, the service, anything that identified them?\n\n' +
        'This is recorded against your name and every administrator is told.',
    );
    if (note === null) return;
    if (note.trim().length < 10) {
      window.alert('Please write at least 10 characters. This is the record of the decision.');
      return;
    }
    onAct('verify-manually', note.trim());
  };

  const askCancel = () => {
    const reason = window.prompt(
      'Cancelling. The customer is told this reason, and if they have paid a ' +
        'deposit it is refunded in full — including our fee.',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) return;
    onAct('cancel', reason.trim());
  };

  return (
    <tr>
      <td className="small">
        {when(appointment.startTime)}
        <div>
          <button type="button" className="link" onClick={() => setDetail(true)}>
            Details
          </button>
        </div>
        {detail && (
          <AppointmentDetail id={appointment.id} onClose={() => setDetail(false)} />
        )}
      </td>
      <td>
        {appointment.customer.email}
        {/* The deposit is the platform's evidence the customer is serious. */}
        {appointment.depositPaidAt && (
          <div className="muted small">Deposit paid</div>
        )}
      </td>
      <td>
        {appointment.service.name}
        {appointment.quantity > 1 && (
          <strong>
            {' '}
            {appointment.service.quantityMode === 'PEOPLE'
              ? `· ${appointment.quantity} people`
              : `× ${appointment.quantity}`}
          </strong>
        )}
        <div className="muted small">
          {Math.round(
            (new Date(appointment.endTime).getTime() -
              new Date(appointment.startTime).getTime()) /
              60_000,
          )}{' '}
          min
        </div>
      </td>
      <td>
        <strong>{money(appointment.businessAmountMinor)}</strong>
        {/* The deposit share is NOT the price. The balance is settled directly
            with the customer and the platform never sees it (§29.2). */}
        {appointment.servicePriceMinor !== null && (
          <div className="muted small">
            of {money(appointment.servicePriceMinor)} — rest paid to you directly
          </div>
        )}
      </td>
      <td>
        <span className={`pill ${appointment.status.toLowerCase().replace('_', '-')}`}>
          {appointment.status.replace('_', ' ')}
        </span>
        {appointment.cancellationReason && (
          <div className="muted small">{appointment.cancellationReason}</div>
        )}
      </td>
      <td className="actions">
        {appointment.status === 'BOOKED' && (
          <>
            {/* The code is the gate. Without it there is nothing separating
                "the customer came" from "the business says so" (§16.2). */}
            <input
              className="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="Code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            <button
              type="button"
              className="primary"
              disabled={busy || code.length !== 6}
              onClick={() => onAct('verify', code)}
            >
              Verify
            </button>
            {canVerifyManually && (
              <button type="button" className="link" disabled={busy} onClick={askManual}>
                No code?
              </button>
            )}
            <button type="button" className="link" disabled={busy} onClick={() => onAct('no-show')}>
              No-show
            </button>
            <button type="button" className="link danger-link" disabled={busy} onClick={askCancel}>
              Cancel
            </button>
          </>
        )}

        {appointment.status === 'IN_PROGRESS' && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAct('complete')}
          >
            Mark done
          </button>
        )}

        {appointment.status === 'PENDING_PAYMENT' && (
          <span className="muted small">Waiting for the customer to pay</span>
        )}
      </td>
    </tr>
  );
}
