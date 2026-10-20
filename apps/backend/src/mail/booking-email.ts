import { AppointmentStatus, Prisma } from '@prisma/client';
import { formatMoney } from '../payments/currency';
import { Badge, Block, Ticket, Tone, ticket } from './email-kit';

/**
 * A booking, as every email draws it (§292): the ticket, its date tile, the
 * way there and a place in the calendar. Shared by the arrival-code email
 * and every notice about a booking, so a booking looks the same wherever it
 * appears.
 */
export interface BookingFacts {
  id: string;
  serviceName: string;
  photoUrl: string | null;
  quantity: number;
  shopName: string;
  shopLogoUrl: string | null;
  branchName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  startTime: Date;
  endTime: Date;
  depositMinor: number;
  /** The whole price, when the booking kept one (§136). */
  priceMinor: number | null;
  currency: string;
  status: AppointmentStatus;
  depositPaid: boolean;
  /**
   * What was chosen (§300), "Hair length: Long" — never a private answer:
   * those are only said to be there, and read in the app (§300.6).
   */
  choices: string[];
  hasPrivateAnswers: boolean;
  /** The customer's note to the shop (§300.5). */
  note: string | null;
}

/** The select that loads a booking's facts, in one query. */
export const BOOKING_FACTS_SELECT = {
  id: true,
  startTime: true,
  endTime: true,
  status: true,
  quantity: true,
  depositAmountMinor: true,
  servicePriceMinor: true,
  currency: true,
  depositPaidAt: true,
  // What was chosen (§300). The sealed column only to say there is something
  // private — it is never opened for an email.
  choices: true,
  customerNote: true,
  healthChoicesSealed: true,
  service: {
    select: {
      name: true,
      images: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { url: true } },
    },
  },
  location: {
    select: {
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      business: { select: { name: true, logoUrl: true } },
    },
  },
} satisfies Prisma.AppointmentSelect;

type Loaded = {
  id: string;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  quantity: number;
  depositAmountMinor: number;
  servicePriceMinor: number | null;
  currency: string;
  depositPaidAt: Date | null;
  choices: Prisma.JsonValue;
  customerNote: string | null;
  healthChoicesSealed: string | null;
  service: { name: string; images: Array<{ url: string }> };
  location: {
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    business: { name: string | null; logoUrl: string | null };
  };
};

export function bookingFacts(row: Loaded): BookingFacts {
  return {
    id: row.id,
    serviceName: row.service.name,
    photoUrl: row.service.images[0]?.url ?? null,
    quantity: row.quantity,
    shopName: row.location.business.name ?? row.location.name,
    shopLogoUrl: row.location.business.logoUrl,
    branchName: row.location.name,
    address: row.location.address || null,
    latitude: row.location.latitude,
    longitude: row.location.longitude,
    startTime: row.startTime,
    endTime: row.endTime,
    depositMinor: row.depositAmountMinor,
    priceMinor: row.servicePriceMinor,
    currency: row.currency,
    status: row.status,
    depositPaid: Boolean(row.depositPaidAt) || row.status === AppointmentStatus.BOOKED,
    choices: ((row.choices as Array<{ group: string; option: string }> | null) ?? []).map(
      (pick) => `${pick.group}: ${pick.option}`,
    ),
    hasPrivateAnswers: row.healthChoicesSealed !== null,
    note: row.customerNote,
  };
}

/** The number both apps show (§213): "3F2A-1C9B". */
export const reservationNo = (id: string) => {
  const s = id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

const parts = (at: Date, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(at);

/** "Tuesday 20 October · 11:15 – 12:15", in the platform's own time. */
export function whenText(b: Pick<BookingFacts, 'startTime' | 'endTime'>, timeZone: string) {
  const day = parts(b.startTime, timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  const from = parts(b.startTime, timeZone, { hour: '2-digit', minute: '2-digit' });
  const to = parts(b.endTime, timeZone, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${from} – ${to}`;
}

/** "11:15". */
export const clockOf = (at: Date, timeZone: string) => parts(at, timeZone, { hour: '2-digit', minute: '2-digit' });

/** The date tile, for the top of the email. */
export function dateBadge(b: Pick<BookingFacts, 'startTime'>, timeZone: string): Badge {
  return {
    kind: 'date',
    weekday: parts(b.startTime, timeZone, { weekday: 'short' }),
    day: parts(b.startTime, timeZone, { day: 'numeric' }),
  };
}

/** Directions from wherever they are: the pin when there is one, else the address. */
export function mapsUrl(b: Pick<BookingFacts, 'latitude' | 'longitude' | 'address' | 'branchName' | 'shopName'>) {
  const destination =
    b.latitude !== null && b.longitude !== null
      ? `${b.latitude},${b.longitude}`
      : [b.shopName, b.branchName, b.address].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

const stamp = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** A Google Calendar event, filled in. */
export function calendarUrl(b: BookingFacts) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${b.serviceName} — ${b.shopName}`,
    dates: `${stamp(b.startTime)}/${stamp(b.endTime)}`,
    location: [b.branchName, b.address].filter(Boolean).join(', '),
    details: `Booking no. ${reservationNo(b.id)}. Give the shop your arrival code when you arrive.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The same event as a file, which Apple Mail, Outlook and Gmail offer to add (RFC 5545). */
export function icsFile(b: BookingFacts) {
  const text = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BwanguReservations//Booking//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@bwangureservations`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(b.startTime)}`,
    `DTEND:${stamp(b.endTime)}`,
    `SUMMARY:${text(`${b.serviceName} — ${b.shopName}`)}`,
    `LOCATION:${text([b.branchName, b.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${text(`Booking no. ${reservationNo(b.id)}. Give the shop your arrival code when you arrive.`)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(`${b.serviceName} in an hour`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** A booking's state, in the words of whoever reads it. */
function statusOf(
  b: BookingFacts,
  audience: 'CUSTOMER' | 'BUSINESS' | 'ADMIN',
): { label: string; tone: Exclude<Tone, 'night'> } {
  switch (b.status) {
    case AppointmentStatus.PENDING_PAYMENT:
      return { label: audience === 'CUSTOMER' ? 'Waiting for your deposit' : 'Waiting for the deposit', tone: 'warn' };
    case AppointmentStatus.BOOKED:
      return { label: 'Confirmed', tone: 'ok' };
    case AppointmentStatus.IN_PROGRESS:
      return { label: 'In progress', tone: 'info' };
    case AppointmentStatus.COMPLETED:
      return { label: 'Done', tone: 'ok' };
    case AppointmentStatus.NO_SHOW:
      return { label: 'Missed', tone: 'warn' };
    case AppointmentStatus.CANCELLED:
      return { label: 'Cancelled', tone: 'danger' };
  }
}

/** The ticket, for the customer or the shop. */
export function bookingTicket(
  b: BookingFacts,
  opts: { timeZone: string; audience: 'CUSTOMER' | 'BUSINESS' | 'ADMIN'; links?: boolean },
): Block {
  const money: Ticket['money'] = [];
  // What is left to pay matters only while the visit is still to come.
  const ahead =
    b.status === AppointmentStatus.BOOKED ||
    b.status === AppointmentStatus.PENDING_PAYMENT ||
    b.status === AppointmentStatus.IN_PROGRESS;
  // A deposit is shown when it was paid, or while it still can be.
  if (b.depositPaid || ahead) {
    money.push({
      label: b.depositPaid ? 'Deposit paid' : 'Deposit to pay',
      value: formatMoney(b.depositMinor, b.currency),
    });
  }
  if (ahead && b.priceMinor !== null && b.priceMinor > b.depositMinor) {
    money.push({
      label: opts.audience === 'CUSTOMER' ? 'To pay at the shop' : 'Due at the shop',
      value: formatMoney(b.priceMinor - b.depositMinor, b.currency),
    });
  }
  const live = b.status === AppointmentStatus.BOOKED || b.status === AppointmentStatus.PENDING_PAYMENT;
  return ticket({
    photoUrl: b.photoUrl,
    service: b.serviceName,
    quantity: b.quantity,
    shop: b.shopName,
    shopLogoUrl: b.shopLogoUrl,
    weekday: parts(b.startTime, opts.timeZone, { weekday: 'short' }),
    day: parts(b.startTime, opts.timeZone, { day: 'numeric' }),
    month: parts(b.startTime, opts.timeZone, { month: 'short' }),
    when: whenText(b, opts.timeZone),
    branch: b.branchName,
    address: b.address,
    reservation: reservationNo(b.id),
    status: statusOf(b, opts.audience),
    money,
    // What was chosen (§300); a private answer only as "in the app" (§300.6).
    extras:
      b.choices.length > 0 || b.hasPrivateAnswers || b.note
        ? {
            label: opts.audience === 'CUSTOMER' ? 'Your choices' : 'What they chose',
            lines: b.choices,
            privateNote: b.hasPrivateAnswers
              ? opts.audience === 'CUSTOMER'
                ? 'Your private answers are with the shop — see them in the app.'
                : 'Private answers — open the booking to read them.'
              : null,
            note: b.note,
          }
        : null,
    // The way there and a place in the calendar, for someone going to it.
    links:
      opts.links !== false && opts.audience === 'CUSTOMER' && live
        ? [
            { label: 'Get directions', url: mapsUrl(b) },
            { label: 'Add to calendar', url: calendarUrl(b) },
          ]
        : [],
  });
}
