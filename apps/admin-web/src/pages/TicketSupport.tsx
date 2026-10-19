import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { linkTicketBooking, listAdminAppointments, type AdminTicketDetail } from '../api/admin';
import { BOOKING_STATUS, reservationNo } from '../lib/bookingLook';
import { clock, shortDay } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';

/**
 * Tying a help request to the booking it is about (§297) — someone wrote "my
 * booking at 3" without choosing it. Only the reporter's own bookings are
 * offered: a customer's, or ones at their shop — the server refuses any other.
 * Once tied, the booking's help is one click away, and each thing done there
 * can answer this request.
 */
export function LinkBookingPanel({ ticket, onClose }: { ticket: AdminTicketDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const whose =
    ticket.reporterType === 'BUSINESS' && ticket.businessId ? { businessId: ticket.businessId } : { customerId: ticket.reporterId };
  const bookings = useQuery({
    queryKey: ['admin-appointments', 'for-ticket', whose, q],
    queryFn: () => listAdminAppointments({ ...whose, q: q.trim() || undefined, sort: 'latest', limit: 30 }),
  });
  const link = useMutation({
    mutationFn: (appointmentId: string | null) => linkTicketBooking(ticket.id, appointmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['support-history'] });
      onClose();
    },
  });
  const rows = bookings.data?.appointments ?? [];

  return (
    <Panel
      eyebrow={`${ticket.reference} · ${ticket.subject}`}
      title="Which booking is it about?"
      onClose={onClose}
      width={600}
      footer={
        ticket.appointmentId ? (
          <button type="button" className="danger" disabled={link.isPending} onClick={() => link.mutate(null)}>
            <Icon name="xCircle" size={16} /> Untie it from its booking
          </button>
        ) : undefined
      }
    >
      <p className="sa-intro">
        {ticket.reporterType === 'BUSINESS'
          ? `Bookings at ${ticket.businessProfile?.name ?? 'their shop'}, newest first.`
          : `${ticket.reporter.email}’s bookings, newest first.`}
      </p>
      <label className="sa-find">
        <Icon name="search" size={16} />
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Booking number, service, branch…" aria-label="Find a booking" autoFocus />
      </label>
      {bookings.isLoading ? (
        <div className="skeleton sa-skel" />
      ) : rows.length === 0 ? (
        <p className="sa-empty">No bookings{q ? ' match that' : ' yet'}.</p>
      ) : (
        <ul className="sa-picks">
          {rows.map((a) => {
            const look = BOOKING_STATUS[a.status];
            const on = a.id === ticket.appointmentId;
            return (
              <li key={a.id}>
                <button type="button" className={on ? 'is-on' : ''} disabled={link.isPending || on} onClick={() => link.mutate(a.id)}>
                  <span className="sa-pick-when">
                    <b>{shortDay(a.startTime)}</b>
                    <em>{clock(a.startTime)}</em>
                  </span>
                  <span className="sa-pick-what">
                    <strong>{a.serviceName}</strong>
                    <span>
                      No. {reservationNo(a.id)} · {ticket.reporterType === 'BUSINESS' ? a.customerEmail : (a.businessName ?? a.locationName)}
                    </span>
                  </span>
                  <span className={`pill ${look.cls}`}>{look.label}</span>
                  {on ? <Icon name="checkCircle" size={16} /> : <Icon name="chevronRight" size={15} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {link.error && (
        <p className="error small" role="alert">
          {link.error instanceof ApiError ? link.error.message : 'That did not work.'}
        </p>
      )}
    </Panel>
  );
}
