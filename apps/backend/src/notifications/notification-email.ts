import { AppointmentStatus, NotificationType } from '@prisma/client';
import { BookingFacts, bookingTicket, clockOf, icsFile } from '../mail/booking-email';
import { Badge, Block, Email, Tone, amount, codeBoxes, facts, letter, list, prose, quote } from '../mail/email-kit';
import { Audience, dayWord } from './notification-catalog';

const T = NotificationType;

/**
 * How each kind of notice looks as an email (§292): its colour, what sits in
 * its top corner, the small label above the title, and — for the notices
 * about a booking, whose subjects are written for an inbox list — a title
 * written to be read large.
 */
type Look = {
  tone: Exclude<Tone, 'night'>;
  glyph?: string;
  /** Whether the first paragraph is shown under the title (default yes). */
  lead?: false;
  eyebrow: string | ((audience: Audience) => string);
  title?: (n: { audience: Audience; booking: BookingFacts | null; timeZone: string; subject: string }) => string;
};

const CHECK = '&#10003;';
const BANG = '!';
const CROSS = '&times;';
const STAR = '&#9733;';
const QUOTE = '&ldquo;';
const HELP = '?';

const LOOKS: Partial<Record<NotificationType, Look>> = {
  [T.APPOINTMENT_BOOKED]: { tone: 'accent', glyph: '+', eyebrow: 'New booking', title: () => 'You have a new booking' },
  [T.DEPOSIT_CONFIRMED]: {
    tone: 'ok',
    glyph: CHECK,
    eyebrow: (a) => (a === 'CUSTOMER' ? 'Booking confirmed' : 'Deposit paid'),
    title: ({ audience }) => (audience === 'CUSTOMER' ? 'You are all set' : 'Booking confirmed'),
  },
  [T.APPOINTMENT_CANCELLED]: {
    tone: 'danger',
    glyph: CROSS,
    eyebrow: 'Booking cancelled',
    title: ({ audience }) => (audience === 'CUSTOMER' ? 'Your booking is cancelled' : 'A booking was cancelled'),
  },
  [T.APPOINTMENT_NO_SHOW]: {
    tone: 'warn',
    glyph: BANG,
    eyebrow: 'Missed booking',
    title: ({ audience }) => (audience === 'CUSTOMER' ? 'You were marked as missed' : 'Marked as missed'),
  },
  [T.DEPOSIT_FAILED]: {
    tone: 'danger',
    glyph: BANG,
    eyebrow: 'Deposit',
    title: ({ audience }) =>
      audience === 'CUSTOMER' ? 'Your payment did not go through' : 'The deposit did not go through',
  },
  [T.APPOINTMENT_REMINDER]: {
    tone: 'accent',
    eyebrow: 'Reminder',
    title: ({ booking, timeZone }) => {
      if (!booking) return 'See you soon';
      const day = dayWord(booking.startTime, timeZone);
      const at = clockOf(booking.startTime, timeZone);
      return day === 'Today' || day === 'Tomorrow'
        ? `See you ${day.toLowerCase()} at ${at}`
        : `See you on ${day} at ${at}`;
    },
  },
  [T.APPOINTMENT_COMPLETED]: {
    tone: 'accent',
    glyph: STAR,
    eyebrow: 'How was it?',
    title: ({ booking }) => (booking ? `How was ${booking.serviceName}?` : 'How was it?'),
  },
  [T.APPOINTMENT_MANUALLY_VERIFIED]: { tone: 'warn', glyph: BANG, eyebrow: 'Checked in without a code' },
  [T.NEW_MESSAGE]: { tone: 'accent', glyph: QUOTE, eyebrow: 'New message', lead: false },
  [T.REVIEW_CREATED]: { tone: 'accent', glyph: STAR, eyebrow: 'New review' },
  [T.REVIEW_RESPONSE]: { tone: 'accent', glyph: QUOTE, eyebrow: 'Your review' },
  [T.REVIEW_HIDDEN]: { tone: 'warn', glyph: BANG, eyebrow: 'Reviews' },
  [T.STORY_REMOVED]: { tone: 'warn', glyph: BANG, eyebrow: 'Stories' },
  [T.DISPLAY_NAME_CLEARED]: { tone: 'warn', glyph: BANG, eyebrow: 'Your reviews' },
  [T.TICKET_CREATED]: { tone: 'info', glyph: HELP, eyebrow: 'Support' },
  [T.TICKET_MESSAGE]: { tone: 'info', glyph: QUOTE, eyebrow: (a) => (a === 'ADMIN' ? 'Support' : 'Help') },
  [T.TICKET_STATUS_CHANGED]: { tone: 'info', glyph: HELP, eyebrow: 'Help' },
  [T.BUSINESS_SUBMITTED]: { tone: 'info', glyph: HELP, eyebrow: 'Waiting for a check' },
  [T.BUSINESS_KIND_WRITTEN]: { tone: 'info', glyph: HELP, eyebrow: 'Categories' },
  [T.BUSINESS_APPROVED]: { tone: 'ok', glyph: CHECK, eyebrow: 'Your shop' },
  [T.BUSINESS_REJECTED]: { tone: 'warn', glyph: BANG, eyebrow: 'Your shop' },
  [T.BUSINESS_SUSPENDED]: { tone: 'danger', glyph: BANG, eyebrow: 'Your shop' },
  [T.BUSINESS_REINSTATED]: { tone: 'ok', glyph: CHECK, eyebrow: 'Your shop' },
  [T.PAYOUT_DESTINATION_SUBMITTED]: { tone: 'warn', glyph: BANG, eyebrow: 'Waiting for a check' },
  [T.PAYOUT_DESTINATION_VERIFIED]: { tone: 'ok', glyph: CHECK, eyebrow: 'Getting paid' },
  [T.PAYOUT_DESTINATION_REJECTED]: { tone: 'danger', glyph: CROSS, eyebrow: 'Getting paid' },
  [T.PAYOUT_SENT]: { tone: 'ok', glyph: CHECK, eyebrow: 'Getting paid', title: () => 'A payment is on its way' },
  [T.PAYOUT_FAILED]: {
    tone: 'danger',
    glyph: BANG,
    eyebrow: 'Getting paid',
    title: () => 'A payment did not go through',
  },
  [T.EXCHANGE_RATE_STALE]: { tone: 'warn', glyph: BANG, eyebrow: 'Platform' },
  [T.PAYMENT_PROVIDER_MISCONFIGURED]: { tone: 'danger', glyph: BANG, eyebrow: 'Platform problem' },
  [T.BUSINESS_INVITATION]: { tone: 'accent', glyph: '+', eyebrow: 'An invitation' },
  [T.ANNOUNCEMENT]: { tone: 'accent', glyph: '&#10022;', eyebrow: 'From our team' },
  [T.SHOP_MESSAGE]: { tone: 'accent', eyebrow: 'From a shop you follow' },
};

/** A notice whose email shows the booking it is about. */
const ABOUT_A_BOOKING = new Set<NotificationType>([
  T.APPOINTMENT_BOOKED,
  T.DEPOSIT_CONFIRMED,
  T.APPOINTMENT_CANCELLED,
  T.APPOINTMENT_NO_SHOW,
  T.DEPOSIT_FAILED,
  T.APPOINTMENT_REMINDER,
  T.APPOINTMENT_COMPLETED,
  T.APPOINTMENT_MANUALLY_VERIFIED,
]);

/** Details the ticket already shows, so they are not said twice. */
const ON_THE_TICKET = new Set(['Service', 'Where', 'When', 'Deposit', 'Deposit paid']);

/**
 * A notice's text, read back into its parts (§292): the templates write a
 * first paragraph that says what happened, details as "Label: value" lines,
 * someone's words in quotes, and what happens next.
 */
export function readBody(body: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean);
  const detail = /^([A-Z][A-Za-z .'’-]{0,24}): (.+)$/;
  const facts: Array<{ label: string; value: string }> = [];
  const quotes: string[] = [];
  const words: string[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n');
    if (lines.every((line) => detail.test(line))) {
      for (const line of lines) {
        const [, label, value] = detail.exec(line)!;
        facts.push({ label, value });
      }
    } else if (/^["“].*["”]$/s.test(para)) {
      quotes.push(para);
    } else {
      words.push(para);
    }
  }
  return { facts, quotes, words };
}

export interface NoticeForEmail {
  type: NotificationType;
  audience: Audience;
  subject: string;
  body: string;
  /** Where its button goes — the seller's or the console's own page — or null. */
  button: { label: string; url: string } | null;
  /** Why it came and how to change that. */
  footer: Email['footer'];
  booking: BookingFacts | null;
  /** The customer's arrival code, on a confirmation or a reminder. */
  arrivalCode: string | null;
  /** Who wrote it, for a shop's message to its followers. */
  author: { name: string; logoUrl: string | null } | null;
  timeZone: string;
}

/**
 * A seller's morning summary (§287, §292): every booking email they asked
 * to have together, as one list, each with its time.
 */
export function summaryEmail(opts: { items: Array<{ at: string; subject: string }>; appUrl: string }): {
  subject: string;
  body: string;
  email: Email;
} {
  const n = opts.items.length;
  const subject = `${n} booking update${n === 1 ? '' : 's'} since yesterday`;
  const lines = opts.items.map((i) => `${i.at} — ${i.subject}`).join('\n');
  return {
    subject,
    body: `Here is what happened with your bookings.\n\n${lines}\n\nEach one is in your notifications, and all of them under Appointments.`,
    email: {
      preheader: opts.items
        .slice(0, 2)
        .map((i) => i.subject)
        .join(' · '),
      audience: 'BUSINESS',
      hero: {
        tone: 'accent',
        badge: { kind: 'glyph', glyph: String(Math.min(n, 99)) },
        eyebrow: 'Your morning summary',
        title: `${n} booking update${n === 1 ? '' : 's'} since yesterday`,
        lead: 'Here is what happened with your bookings. Each one is also in your notifications.',
      },
      blocks: [
        list(
          opts.items.map((i) => {
            // "New booking: Cut and beard, Tue 20 Oct, 11:15" → what, then which.
            const [what, which] = i.subject.split(/: (.+)/);
            return { when: i.at, title: which ? what : i.subject, detail: which ?? null };
          }),
        ),
      ],
      button: { label: 'See bookings', url: `${opts.appUrl}/appointments` },
      footer: {
        reason: 'You chose one booking summary each morning instead of an email for each.',
        manage: { label: 'Change what we send', url: `${opts.appUrl}/notifications` },
      },
    },
  };
}

/** Whether a sentence only says what the title already does. */
const sameWords = (a: string, b: string) => {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  const [x, y] = [norm(a), norm(b)];
  return x.startsWith(y) || y.startsWith(x);
};

/** One notice, as an email in the platform's design (§292). */
export function noticeEmail(n: NoticeForEmail): { email: Email; calendar: string | null } {
  const look: Look = LOOKS[n.type] ?? { tone: 'info', glyph: '&#8226;', eyebrow: 'A notice' };
  // Someone's own words are kept as they wrote them — never read as details.
  const written = n.type === T.ANNOUNCEMENT || n.type === T.SHOP_MESSAGE || n.type === T.SHOP_DISCOUNT;
  const {
    facts: details,
    quotes,
    words,
  } = written
    ? {
        facts: [],
        quotes: [],
        words: n.body
          .split(/\n{2,}/)
          .map((x) => x.trim())
          .filter(Boolean),
      }
    : readBody(n.body);
  const booking = ABOUT_A_BOOKING.has(n.type) ? n.booking : null;

  // The first paragraph leads, under the title; the rest follow the details.
  // Someone's own message is not split: it is read whole, in the body.
  const lead: string | undefined = written ? undefined : words[0];
  const rest = written ? [] : words.slice(1);
  const amountRow = details.find((d) => d.label === 'Amount');
  const shown = details.filter((d) => d !== amountRow && !(booking && ON_THE_TICKET.has(d.label)));

  let badge: Badge | null = null;
  if (n.type === T.SHOP_MESSAGE && n.author?.logoUrl) badge = { kind: 'image', url: n.author.logoUrl };
  else if (look.glyph) badge = { kind: 'glyph', glyph: look.glyph };

  const customer = n.audience === 'CUSTOMER';
  const going =
    booking &&
    customer &&
    booking.status === AppointmentStatus.BOOKED &&
    (n.type === T.DEPOSIT_CONFIRMED || n.type === T.APPOINTMENT_REMINDER);

  const blocks: Array<Block | null> = [
    amountRow
      ? amount({
          label: n.type === T.PAYOUT_FAILED ? 'Did not arrive' : 'On its way to you',
          value: amountRow.value,
          tone: n.type === T.PAYOUT_FAILED ? 'danger' : 'ok',
        })
      : null,
    booking ? bookingTicket(booking, { timeZone: n.timeZone, audience: n.audience }) : null,
    // The code they will be asked for, where they will need it (§54.2).
    going && n.arrivalCode
      ? codeBoxes(n.arrivalCode, {
          label: 'Your arrival code',
          note: 'Give it to the shop when you arrive. Do not share it before.',
        })
      : null,
    written && words.length
      ? letter(words.join('\n\n'), n.type === T.SHOP_MESSAGE ? (n.author?.name ?? null) : 'The BwanguReservations team')
      : null,
    n.type === T.SHOP_MESSAGE && n.author ? prose(`Open ${n.author.name} in the app to book.`) : null,
    ...quotes.map((q) =>
      quote(q, n.type === T.NEW_MESSAGE && customer ? n.subject.replace(/^New message from /, '') : null),
    ),
    shown.length ? facts(shown.map((d) => ({ ...d, strong: d.label === 'Reference' }))) : null,
    // The code is shown above, so the sentence pointing to it is not needed.
    !written && rest.filter((para) => !(going && n.arrivalCode && /arrival code/i.test(para))).length
      ? prose(rest.filter((para) => !(going && n.arrivalCode && /arrival code/i.test(para))).join('\n\n'))
      : null,
  ];

  const eyebrow = typeof look.eyebrow === 'function' ? look.eyebrow(n.audience) : look.eyebrow;
  const title = look.title?.({ audience: n.audience, booking, timeZone: n.timeZone, subject: n.subject }) ?? n.subject;
  // A shop's message or our announcement: written by someone, signed by them.
  const signed =
    n.type === T.SHOP_MESSAGE && n.author
      ? `From ${n.author.name}`
      : n.type === T.ANNOUNCEMENT
        ? 'From the BwanguReservations team'
        : null;

  return {
    email: {
      preheader: (lead ?? n.body).replace(/\s+/g, ' ').slice(0, 140),
      audience: n.audience === 'CUSTOMER' ? null : n.audience,
      hero: {
        tone: look.tone,
        badge,
        eyebrow: signed ?? eyebrow,
        title,
        // Not said twice: a first paragraph that only repeats the title is left out.
        lead: look.lead === false || !lead || sameWords(lead, title) ? null : lead,
      },
      blocks,
      button: n.button,
      // Add it to a calendar: for someone who is going (§292).
      footer: n.footer,
    },
    calendar: going && booking ? icsFile(booking) : null,
  };
}
