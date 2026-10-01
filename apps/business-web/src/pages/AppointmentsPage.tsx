import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
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
      <td className="small">{when(appointment.startTime)}</td>
      <td>
        {appointment.customer.email}
        {/* The deposit is the platform's evidence the customer is serious. */}
        {appointment.depositPaidAt && (
          <div className="muted small">Deposit paid</div>
        )}
      </td>
      <td>
        {appointment.service.name}
        <div className="muted small">{appointment.service.durationMinutes} min</div>
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
