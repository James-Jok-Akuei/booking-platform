import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listServices, type Appointment, type AppointmentStatus } from '../api/business';
import { dueLabel } from '../checkin/CheckIn';
import { clock, relativeDay, sameDay, startOfDay } from './time';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/*
 * How a booking is described, the same in the Appointments list and its
 * calendar (§213, §229): its status's name and colour, its number, what it
 * means for money, where it stands in time, and its service's photo.
 */

export const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  BOOKED: {
    get label() { return t`Expected`; },
    cls: 'booked'
  },
  IN_PROGRESS: {
    get label() { return t`In progress`; },
    cls: 'in-progress'
  },
  COMPLETED: {
    get label() { return t`Done`; },
    cls: 'completed'
  },
  NO_SHOW: {
    get label() { return t`No-show`; },
    cls: 'no-show'
  },
  CANCELLED: {
    get label() { return t`Cancelled`; },
    cls: 'cancelled'
  },
  PENDING_PAYMENT: {
    get label() { return t`Unpaid`; },
    cls: 'pending-payment'
  },
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

/** The small word after an amount — what that money is — in the app's language (§308.7). */
const UNIT = {
  get deposit() { return t({ message: 'deposit', context: 'after an amount: the money is the deposit' }); },
  get due() { return t({ message: 'due', context: 'after an amount: still to be paid at the shop' }); },
  get yours() { return t({ message: 'yours', context: 'after an amount: the shop’s share' }); },
  get total() { return t({ message: 'total', context: 'after an amount: the full price' }); },
};

/** What the money looks like for this booking, in two lines. */
export function payment(a: Appointment, money: Money) {
  const paid = Boolean(a.depositPaidAt);
  const due = dueAtShop(a);
  switch (a.status) {
    case 'PENDING_PAYMENT':
      return { amount: money(a.depositAmountMinor, a.currency), unit: UNIT.deposit, note: t`Not paid yet`, tone: 'warn', icon: 'hourglass' as IconName };
    case 'BOOKED':
    case 'IN_PROGRESS':
      return {
        amount: due === null ? '—' : money(due, a.currency),
        unit: due === null ? '' : UNIT.due,
        note: paid ? t`Deposit paid` : t`No deposit`,
        tone: paid ? 'ok' : 'muted',
        icon: (paid ? 'checkCircle' : 'info') as IconName,
      };
    case 'COMPLETED':
      return {
        amount: a.servicePriceMinor === null ? money(a.businessAmountMinor, a.currency) : money(a.servicePriceMinor, a.currency),
        unit: a.servicePriceMinor === null ? UNIT.yours : UNIT.total,
        note: t`Deposit paid`,
        tone: 'ok',
        icon: 'checkCircle' as IconName,
      };
    case 'NO_SHOW':
      return { amount: money(a.businessAmountMinor, a.currency), unit: UNIT.yours, note: t`Deposit kept`, tone: 'muted', icon: 'wallet' as IconName };
    case 'CANCELLED':
      if (!paid) return { amount: '—', unit: '', note: t`No deposit`, tone: 'muted', icon: 'info' as IconName };
      if (a.cancelledBy === 'BUSINESS')
        return { amount: '—', unit: '', note: t`Deposit refunded`, tone: 'muted', icon: 'refresh' as IconName };
      return { amount: money(a.businessAmountMinor, a.currency), unit: UNIT.yours, note: t`Deposit kept`, tone: 'muted', icon: 'wallet' as IconName };
  }
}

/** The status, and one line about where it stands in time. */
export function standing(a: Appointment, now: Date): { text: string; tone: string } {
  switch (a.status) {
    case 'BOOKED': {
      const start = new Date(a.startTime);
      if (start < startOfDay(now)) return { text: t`Not checked in`, tone: 'late' };
      if (!sameDay(start, now)) {
        const days = Math.round((startOfDay(start).getTime() - startOfDay(now).getTime()) / 86_400_000);
        return { text: days === 1 ? t`Tomorrow` : t`In ${days} days`, tone: 'muted' };
      }
      const due = dueLabel(a.startTime, now.getTime());
      return { text: due.text.charAt(0).toUpperCase() + due.text.slice(1), tone: due.tone };
    }
    case 'IN_PROGRESS':
      return { text: a.verifiedAt ? t`Arrived ${clock(a.verifiedAt)}` : t`With you`, tone: 'muted' };
    case 'COMPLETED':
      return { text: a.completedAt ? t`Finished ${clock(a.completedAt)}` : t`Finished`, tone: 'muted' };
    case 'NO_SHOW':
      return { text: a.noShowAt ? t`Marked ${clock(a.noShowAt)}` : t`Did not come`, tone: 'muted' };
    case 'CANCELLED':
      return {
        text: a.cancelledBy === 'BUSINESS' ? t`By you` : a.cancelledBy === 'CUSTOMER' ? t`By the customer` : t`Not paid in time`,
        tone: 'muted',
      };
    case 'PENDING_PAYMENT':
      return { text: t`Paying on their phone`, tone: 'muted' };
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
            <Trans>{a.customer.email} · No. {reservationNo(a.id)}</Trans>
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
    title: t`Mark this booking as done?`,
    tone: 'ok',
    icon: 'checkCircle',
    body: (
      <>
        <BookingInQuestion a={a} cover={cover} />
        {due !== null && due > 0 && (
          <p className="dlg-booking-due">
            <Icon name="banknote" size={16} />
            <span><Trans>Still to collect at the shop: <strong>{money(due, a.currency)}</strong></Trans>
            </span>
          </p>
        )}
        <p><Trans>It cannot be changed back.{' '}</Trans>
          {a.depositPaidAt ? t`The deposit becomes yours to be paid out, and the customer can rate the visit.` : t`The customer can then rate the visit.`}
        </p>
      </>
    ),
    confirmLabel: t`Yes, mark done`,
    cancelLabel: t`Not yet`,
  });
}
