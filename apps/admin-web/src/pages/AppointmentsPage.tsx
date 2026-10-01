import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  listAdminAppointments,
  reclassifyAsBusinessCancellation,
  type AdminAppointment,
} from '../api/admin';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const BLAME: Record<string, string> = {
  CUSTOMER: 'the customer',
  BUSINESS: 'the business',
  SYSTEM_EXPIRY: 'nobody — the deposit was never paid',
};

/**
 * Appointments, and the one thing an admin may do to one.
 *
 * Reclassifying says a cancellation was the business's fault. It is the only
 * admin action in this console that **moves money**: the customer is refunded
 * in full including the platform fee, and the business carries the operator's
 * charge (§25). It cannot be undone — there is no endpoint for the reverse —
 * so the form asks for everything the decision needs before it is possible.
 */
export function AppointmentsPage() {
  const [onlyReclassifiable, setOnlyReclassifiable] = useState(true);
  const [open, setOpen] = useState<AdminAppointment | null>(null);
  const money = useMoney();

  const appointments = useQuery({
    queryKey: ['admin-appointments', onlyReclassifiable],
    queryFn: () =>
      listAdminAppointments({
        limit: 100,
        ...(onlyReclassifiable ? { reclassifiable: 'true' } : {}),
      }),
  });

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Appointments</h1>
          <p className="muted">
            Cancellations recorded against the wrong party can be corrected here.
          </p>
        </div>
      </header>

      <div className="toolbar">
        <label className="inline small">
          <input
            type="checkbox"
            checked={onlyReclassifiable}
            onChange={(event) => setOnlyReclassifiable(event.target.checked)}
          />
          Only cancellations that could be put on the business
        </label>
        {appointments.data && (
          <span className="muted small">{appointments.data.total} shown</span>
        )}
      </div>

      {appointments.isLoading && <p className="muted">Loading…</p>}
      {appointments.data?.appointments.length === 0 && (
        <p className="muted empty">
          {onlyReclassifiable
            ? 'No cancellation is waiting to be corrected.'
            : 'No appointments.'}
        </p>
      )}

      {appointments.data && appointments.data.appointments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Business</th>
              <th>Customer</th>
              <th className="num">Deposit</th>
              <th>What happened</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {appointments.data.appointments.map((appointment) => (
              <tr key={appointment.id}>
                <td className="small">{formatDate(appointment.startTime)}</td>
                <td>
                  <strong>{appointment.businessName ?? 'Unnamed'}</strong>
                  <div className="muted small">
                    {appointment.locationName} · {appointment.serviceName}
                  </div>
                </td>
                <td className="small">{appointment.customerEmail}</td>
                <td className="num">
                  {money.format(appointment.depositAmountMinor, appointment.currency)}
                  <div className="muted small">
                    {appointment.depositPaid ? 'paid' : 'never paid'}
                  </div>
                </td>
                <td className="small">
                  <span className={`pill ${appointment.status.toLowerCase().replace('_', '-')}`}>
                    {appointment.status.replace('_', ' ').toLowerCase()}
                  </span>
                  {appointment.cancelledBy && (
                    <div className="muted small">
                      cancelled by {BLAME[appointment.cancelledBy]}
                    </div>
                  )}
                  {appointment.cancellationReason && (
                    <div className="muted small">{appointment.cancellationReason}</div>
                  )}
                </td>
                <td>
                  {appointment.canReclassify && (
                    <button type="button" onClick={() => setOpen(appointment)}>
                      It was the business
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && <ReclassifyForm appointment={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ReclassifyForm({
  appointment,
  onClose,
}: {
  appointment: AdminAppointment;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const money = useMoney();
  const [reason, setReason] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [charge, setCharge] = useState('0');

  const run = useMutation({
    mutationFn: () =>
      reclassifyAsBusinessCancellation(appointment.id, {
        reason: reason.trim(),
        gatewayChargeMinor: Number(charge),
        ...(ticketId.trim() ? { ticketId: ticketId.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['held'] });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run.mutate();
  };

  const chargeValid = Number.isInteger(Number(charge)) && Number(charge) >= 0;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>Put this cancellation on the business</h2>
            <p className="muted small">
              {appointment.businessName} · {appointment.serviceName} ·{' '}
              {formatDate(appointment.startTime)}
            </p>
          </div>
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

        {/* Spelled out rather than summarised. This is the only action in the
            console that pays a customer, and it has no reverse. */}
        <p className="notice">
          <strong>This moves money and cannot be undone.</strong>
        </p>
        <ul className="consequences">
          <li>
            {appointment.customerEmail} gets back{' '}
            <strong>
              {money.format(appointment.depositAmountMinor, appointment.currency)}
            </strong>{' '}
            — the whole deposit, including our fee of{' '}
            {money.format(appointment.platformFeeAmountMinor, appointment.currency)}.
          </li>
          <li>
            {appointment.businessName} loses the{' '}
            {money.format(appointment.businessAmountMinor, appointment.currency)} it was
            owed, and carries the operator's charge for moving the refund.
          </li>
          <li>Both of them are told, with the reason you write below.</li>
        </ul>

        <form className="stack" onSubmit={submit}>
          <label>
            What actually happened
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="The shop was closed when the customer arrived and asked them to cancel."
            />
          </label>

          <label>
            Support ticket this came from{' '}
            <span className="muted small">(optional, but it is the evidence)</span>
            <input
              value={ticketId}
              onChange={(event) => setTicketId(event.target.value)}
              placeholder="Ticket id"
            />
          </label>

          <label>
            What the operator charged to move the refund
            <input
              value={charge}
              onChange={(event) => setCharge(event.target.value)}
              inputMode="numeric"
            />
            <span className="muted small">
              In {money.code} minor units, from the operator's statement. Enter 0 if
              there was no charge — a guess here is carried by the business.
            </span>
          </label>

          {run.error && (
            <p className="error small" role="alert">
              {run.error instanceof ApiError ? run.error.message : 'That did not work.'}
            </p>
          )}

          <div className="row-end">
            <button type="button" className="link" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={run.isPending || reason.trim().length < 3 || !chargeValid}
            >
              {run.isPending ? 'Working…' : 'Refund the customer'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
