import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listServices, type Appointment, type AppointmentStatus } from '../api/business';
import { dueLabel } from '../checkin/CheckIn';
import { clock, relativeDay, sameDay, startOfDay } from './time';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';

/*
 * How a booking is described, the same in the Appointments list and its
 * calendar (§213, §229): its status's name and colour, its number, what it
 * means for money, where it stands in time, and its service's photo.
 */

export const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  BOOKED: { label: 'Expected', cls: 'booked' },
  IN_PROGRESS: { label: 'In progress', cls: 'in-progress' },
  COMPLETED: { label: 'Done', cls: 'completed' },
  NO_SHOW: { label: 'No-show', cls: 'no-show' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  PENDING_PAYMENT: { label: 'Unpaid', cls: 'pending-payment' },
};

/**
 * The number the customer's app shows them (§213): the first eight
 * characters of the booking's id, "3F2A-1C9B" — so the two screens can be
 * matched at a glance, and it can be searched for.
 */
export const reservationNo = (id: string) => {
  const s = id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

/** What is still to be paid at the shop; null on bookings older than the price snapshot. */
export const dueAtShop = (a: Appointment) =>
  a.servicePriceMinor === null ? null : Math.max(0, a.servicePriceMinor - a.depositAmountMinor);

export type Actions = {
  checkIn: (a: Appointment) => void;
  noCode: (a: Appointment) => void;
  /** Asks first (§232); true when it was marked done. */
  complete: (a: Appointment) => Promise<boolean>;
  noShow: (a: Appointment) => void;
  /** Absent for staff: cancelling refunds the customer, so it is the owner's or a manager's (§277). */
  cancel?: (a: Appointment) => void;
  open: (a: Appointment) => void;
};

export type Money = (minor: number | null | undefined, code?: string | null) => string;

/**
 * Each service's cover photo, by service (§211): a booking carries the
 * service's name, not its pictures, and the services list — shared with the
 * Services page, so usually already loaded — has them. The first photo is
 * the cover, as everywhere (§132).
 */
export function useServiceCovers() {
  const services = useQuery({ queryKey: ['services'], queryFn: listServices, staleTime: 5 * 60_000 });
  return useMemo(
    () => new Map((services.data ?? []).map((s) => [s.id, s.images[0]?.url ?? null] as const)),
    [services.data],
  );
}

/** The service's photo, or a soft tile when it has none. */
export function Thumb({ cover, size }: { cover: string | null; size: number }) {
  return (
    <span className={`ap-thumb${cover ? '' : ' is-empty'}`} style={{ width: size, height: size }}>
      {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="tag" size={Math.round(size * 0.4)} />}
    </span>
  );
}

/** What the money looks like for this booking, in two lines. */
export function payment(a: Appointment, money: Money) {
  const paid = Boolean(a.depositPaidAt);
  const due = dueAtShop(a);
  switch (a.status) {
    case 'PENDING_PAYMENT':
      return { amount: money(a.depositAmountMinor, a.currency), unit: 'deposit', note: 'Not paid yet', tone: 'warn', icon: 'hourglass' as IconName };
    case 'BOOKED':
    case 'IN_PROGRESS':
      return {
        amount: due === null ? '—' : money(due, a.currency),
        unit: due === null ? '' : 'due',
        note: paid ? 'Deposit paid' : 'No deposit',
        tone: paid ? 'ok' : 'muted',
        icon: (paid ? 'checkCircle' : 'info') as IconName,
      };
    case 'COMPLETED':
      return {
        amount: a.servicePriceMinor === null ? money(a.businessAmountMinor, a.currency) : money(a.servicePriceMinor, a.currency),
        unit: a.servicePriceMinor === null ? 'yours' : 'total',
        note: 'Deposit paid',
        tone: 'ok',
        icon: 'checkCircle' as IconName,
      };
    case 'NO_SHOW':
      return { amount: money(a.businessAmountMinor, a.currency), unit: 'yours', note: 'Deposit kept', tone: 'muted', icon: 'wallet' as IconName };
    case 'CANCELLED':
      if (!paid) return { amount: '—', unit: '', note: 'No deposit', tone: 'muted', icon: 'info' as IconName };
      if (a.cancelledBy === 'BUSINESS')
        return { amount: '—', unit: '', note: 'Deposit refunded', tone: 'muted', icon: 'refresh' as IconName };
      return { amount: money(a.businessAmountMinor, a.currency), unit: 'yours', note: 'Deposit kept', tone: 'muted', icon: 'wallet' as IconName };
  }
}

/** The status, and one line about where it stands in time. */
export function standing(a: Appointment, now: Date): { text: string; tone: string } {
  switch (a.status) {
    case 'BOOKED': {
      const start = new Date(a.startTime);
      if (start < startOfDay(now)) return { text: 'Not checked in', tone: 'late' };
      if (!sameDay(start, now)) {
        const days = Math.round((startOfDay(start).getTime() - startOfDay(now).getTime()) / 86_400_000);
        return { text: days === 1 ? 'Tomorrow' : `In ${days} days`, tone: 'muted' };
      }
      const due = dueLabel(a.startTime, now.getTime());
      return { text: due.text.charAt(0).toUpperCase() + due.text.slice(1), tone: due.tone };
    }
    case 'IN_PROGRESS':
      return { text: a.verifiedAt ? `Arrived ${clock(a.verifiedAt)}` : 'With you', tone: 'muted' };
    case 'COMPLETED':
      return { text: a.completedAt ? `Finished ${clock(a.completedAt)}` : 'Finished', tone: 'muted' };
    case 'NO_SHOW':
      return { text: a.noShowAt ? `Marked ${clock(a.noShowAt)}` : 'Did not come', tone: 'muted' };
    case 'CANCELLED':
      return {
        text: a.cancelledBy === 'BUSINESS' ? 'By you' : a.cancelledBy === 'CUSTOMER' ? 'By the customer' : 'Not paid in time',
        tone: 'muted',
      };
    case 'PENDING_PAYMENT':
      return { text: 'Paying on their phone', tone: 'muted' };
  }
}

/**
 * Which booking a question is about (§232), at the top of the dialogs that
 * change one for good — Mark done, No-show, Cancel: the service and its
 * photo, the customer, the time, and the BRANCH in bold with its address, so
 * a shop with several branches never closes the wrong one.
 */
export function BookingInQuestion({ a, cover }: { a: Appointment; cover?: string | null }) {
  return (
    <div className="dlg-booking">
      <div className="dlg-booking-top">
        <span className={`dlg-booking-thumb${cover ? '' : ' is-empty'}`}>
          {cover ? <img src={cover} alt="" /> : <Icon name="tag" size={18} />}
        </span>
        <span className="dlg-booking-what">
          <strong>
            {a.service.name}
            {a.quantity > 1 && <em> ×{a.quantity}</em>}
          </strong>
          <span>
            {relativeDay(a.startTime)} · {clock(a.startTime)}–{clock(a.endTime)}
          </span>
          <span>
            {a.customer.email} · No. {reservationNo(a.id)}
          </span>
        </span>
      </div>
      <div className="dlg-booking-where">
        <Icon name="pin" size={17} />
        <span>
          <b>{a.location.name}</b>
          {a.location.address && <small>{a.location.address}</small>}
        </span>
      </div>
    </div>
  );
}

/** "Mark this booking as done?" — finishing is for good, so it asks (§232). */
export function confirmDone(a: Appointment, money: Money, cover?: string | null) {
  const due = dueAtShop(a);
  return confirmDialog({
    title: 'Mark this booking as done?',
    tone: 'ok',
    icon: 'checkCircle',
    body: (
      <>
        <BookingInQuestion a={a} cover={cover} />
        {due !== null && due > 0 && (
          <p className="dlg-booking-due">
            <Icon name="banknote" size={16} />
            <span>
              Still to collect at the shop: <strong>{money(due, a.currency)}</strong>
            </span>
          </p>
        )}
        <p>
          It cannot be changed back.{' '}
          {a.depositPaidAt ? 'The deposit becomes yours to be paid out, and the customer can rate the visit.' : 'The customer can then rate the visit.'}
        </p>
      </>
    ),
    confirmLabel: 'Yes, mark done',
    cancelLabel: 'Not yet',
  });
}
