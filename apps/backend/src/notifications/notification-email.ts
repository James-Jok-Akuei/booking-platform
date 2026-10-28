import { AppointmentStatus, NotificationType } from '@prisma/client';
import { BookingFacts, bookingTicket, clockOf, icsFile, weekdayOf } from '../mail/booking-email';
import { Badge, Block, Email, Tone, amount, codeBoxes, facts, letter, list, prose, quote, todo } from '../mail/email-kit';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { msg, say } from '../i18n/say';
import { Audience, dayKind } from './notification-catalog';
import { ARRIVAL, DETAIL } from './notification-templates';

const T = NotificationType;

/**
 * How each kind of notice looks as an email (§292): its colour, what sits in
 * its top corner, the small label above the title, and — for the notices
 * about a booking, whose subjects are written for an inbox list — a title
 * written to be read large. The words are said in the reader's language
 * (§308); those only our team reads are left unmarked, in English.
 */
type Look = {
  tone: Exclude<Tone, 'night'>;
  glyph?: string;
  /** Whether the first paragraph is shown under the title (default yes). */
  lead?: false;
  eyebrow: string | ((audience: Audience) => string);
  title?: (n: { audience: Audience; booking: BookingFacts | null; timeZone: string; subject: string; l: Locale }) => string;
};

const CHECK = '&#10003;';
const BANG = '!';
const CROSS = '&times;';
const STAR = '&#9733;';
const QUOTE = '&ldquo;';
const HELP = '?';

const LOOKS: Partial<Record<NotificationType, Look>> = {
  [T.APPOINTMENT_BOOKED]: {
    tone: 'accent',
    glyph: '+',
    eyebrow: msg('New booking'),
    title: ({ l }) => say(l, 'You have a new booking'),
  },
  [T.DEPOSIT_CONFIRMED]: {
    tone: 'ok',
    glyph: CHECK,
    eyebrow: (a) => (a === 'CUSTOMER' ? msg('Booking confirmed') : msg('Deposit paid')),
    title: ({ audience, l }) => (audience === 'CUSTOMER' ? say(l, 'You are all set') : say(l, 'Booking confirmed')),
  },
  [T.APPOINTMENT_CANCELLED]: {
    tone: 'danger',
    glyph: CROSS,
    eyebrow: msg('Booking cancelled'),
    title: ({ audience, l }) =>
      audience === 'CUSTOMER' ? say(l, 'Your booking is cancelled') : say(l, 'A booking was cancelled'),
  },
  [T.APPOINTMENT_NO_SHOW]: {
    tone: 'warn',
    glyph: BANG,
    eyebrow: msg('Missed booking'),
    title: ({ audience, l }) => (audience === 'CUSTOMER' ? say(l, 'You were marked as missed') : say(l, 'Marked as missed')),
  },
  [T.DEPOSIT_FAILED]: {
    tone: 'danger',
    glyph: BANG,
    eyebrow: msg('Deposit'),
    title: ({ audience, l }) =>
      audience === 'CUSTOMER' ? say(l, 'Your payment did not go through') : say(l, 'The deposit did not go through'),
  },
  [T.APPOINTMENT_REMINDER]: {
    tone: 'accent',
    eyebrow: msg('Reminder'),
    title: ({ booking, timeZone, l }) => {
      if (!booking) return say(l, 'See you soon');
      const clock = clockOf(booking.startTime, timeZone, l);
      const kind = dayKind(booking.startTime, timeZone);
      return kind === 'today'
        ? say(l, 'See you today at {clock}', { clock })
        : kind === 'tomorrow'
          ? say(l, 'See you tomorrow at {clock}', { clock })
          : say(l, 'See you on {weekday} at {clock}', { weekday: weekdayOf(booking.startTime, timeZone, l), clock });
    },
  },
  [T.APPOINTMENT_COMPLETED]: {
    tone: 'accent',
    glyph: STAR,
    eyebrow: msg('How was it?'),
    title: ({ booking, l }) =>
      booking ? say(l, 'How was {serviceName}?', { serviceName: booking.serviceName }) : say(l, 'How was it?'),
  },
  [T.APPOINTMENT_MANUALLY_VERIFIED]: { tone: 'warn', glyph: BANG, eyebrow: 'Checked in without a code' },
  [T.NEW_MESSAGE]: { tone: 'accent', glyph: QUOTE, eyebrow: msg('New message'), lead: false },
  [T.REVIEW_CREATED]: { tone: 'accent', glyph: STAR, eyebrow: msg('New review') },
  [T.REVIEW_RESPONSE]: { tone: 'accent', glyph: QUOTE, eyebrow: msg('Your review') },
  [T.REVIEW_HIDDEN]: { tone: 'warn', glyph: BANG, eyebrow: msg('Reviews') },
  [T.STORY_REMOVED]: { tone: 'warn', glyph: BANG, eyebrow: msg('Stories') },
  [T.DISPLAY_NAME_CLEARED]: { tone: 'warn', glyph: BANG, eyebrow: msg('Your reviews') },
  [T.TICKET_CREATED]: { tone: 'info', glyph: HELP, eyebrow: 'Support' },
  [T.TICKET_MESSAGE]: { tone: 'info', glyph: QUOTE, eyebrow: (a) => (a === 'ADMIN' ? 'Support' : msg('Help')) },
  [T.TICKET_STATUS_CHANGED]: { tone: 'info', glyph: HELP, eyebrow: msg('Help') },
  [T.BUSINESS_SUBMITTED]: { tone: 'info', glyph: HELP, eyebrow: 'Waiting for a check' },
  [T.BUSINESS_KIND_WRITTEN]: { tone: 'info', glyph: HELP, eyebrow: 'Categories' },
  [T.BUSINESS_APPROVED]: { tone: 'ok', glyph: CHECK, eyebrow: msg('Your shop') },
  [T.BUSINESS_REJECTED]: { tone: 'warn', glyph: BANG, eyebrow: msg('Your shop') },
  [T.BUSINESS_SUSPENDED]: { tone: 'danger', glyph: BANG, eyebrow: msg('Your shop') },
  [T.BUSINESS_REINSTATED]: { tone: 'ok', glyph: CHECK, eyebrow: msg('Your shop') },
  [T.PAYOUT_DESTINATION_SUBMITTED]: { tone: 'warn', glyph: BANG, eyebrow: 'Waiting for a check' },
  [T.PAYOUT_DESTINATION_VERIFIED]: { tone: 'ok', glyph: CHECK, eyebrow: msg('Getting paid') },
  [T.PAYOUT_DESTINATION_REJECTED]: { tone: 'danger', glyph: CROSS, eyebrow: msg('Getting paid') },
  [T.BUSINESS_DOCUMENT_SUBMITTED]: { tone: 'info', glyph: HELP, eyebrow: 'Waiting for a check' },
  [T.BUSINESS_DOCUMENT_VERIFIED]: { tone: 'ok', glyph: CHECK, eyebrow: msg('Business papers') },
  [T.BUSINESS_DOCUMENT_REFUSED]: { tone: 'danger', glyph: CROSS, eyebrow: msg('Business papers') },
  [T.BUSINESS_DOCUMENT_EXPIRING]: { tone: 'warn', glyph: BANG, eyebrow: msg('Business papers') },
  [T.PAYOUT_SENT]: {
    tone: 'ok',
    glyph: CHECK,
    eyebrow: msg('Getting paid'),
    title: ({ l }) => say(l, 'A payment is on its way'),
  },
  [T.PAYOUT_FAILED]: {
    tone: 'danger',
    glyph: BANG,
    eyebrow: msg('Getting paid'),
    title: ({ l }) => say(l, 'A payment did not go through'),
  },
  [T.EXCHANGE_RATE_STALE]: { tone: 'warn', glyph: BANG, eyebrow: 'Platform' },
  [T.PAYMENT_PROVIDER_MISCONFIGURED]: { tone: 'danger', glyph: BANG, eyebrow: 'Platform problem' },
  [T.BUSINESS_INVITATION]: { tone: 'accent', glyph: '+', eyebrow: msg('An invitation') },
  [T.ANNOUNCEMENT]: { tone: 'accent', glyph: '&#10022;', eyebrow: msg('From our team') },
  // Support acted for them (§297): what was done, and why, from a person.
  [T.SUPPORT_UPDATE]: { tone: 'info', glyph: HELP, eyebrow: msg('From our support team') },
  // A sign-in not seen before (§298): worth a look, not an alarm.
  [T.NEW_SIGN_IN]: { tone: 'warn', glyph: BANG, eyebrow: msg('Your account') },
  [T.SHOP_MESSAGE]: { tone: 'accent', eyebrow: msg('From a shop you follow') },
  // What they changed is on the booking, never in the email (§300.7).
  [T.BOOKING_CHOICES_CHANGED]: {
    tone: 'info',
    glyph: '&#9998;',
    eyebrow: msg('A booking changed'),
    title: ({ l }) => say(l, 'New wishes for a booking'),
  },
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
  T.BOOKING_CHOICES_CHANGED,
  // Only when it is about one: a shop paused by support has no booking (§297).
  T.SUPPORT_UPDATE,
]);

/**
 * The words after the lead, in their order: plain paragraphs as prose, and a
 * paragraph of "• " lines — the advice under an approval (§303) — as a
 * checklist, each line's "Title — why" split into its two parts.
 */
function wordsAndLists(paragraphs: string[]): Block[] {
  const blocks: Block[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) blocks.push(prose(run.join('\n\n')));
    run = [];
  };
  for (const para of paragraphs) {
    const lines = para.split('\n');
    if (lines.every((line) => line.startsWith('• '))) {
      flush();
      blocks.push(
        todo(
          lines.map((line) => {
            const [title, ...why] = line.slice(2).split(' — ');
            return { title: title.trim(), detail: why.length ? why.join(' — ').replace(/\.$/, '') : null };
          }),
        ),
      );
    } else run.push(para);
  }
  flush();
  return blocks;
}

/** What stands in for a value, to find the words around it in a language (§308). */
const HOLE = '\u0000';
const HOLES = { serviceName: HOLE, locationName: HOLE, when: HOLE, amount: HOLE, reference: HOLE, businessName: HOLE };

/** "Service" from "Service: {serviceName}", as the reader's language writes it. */
const labelIn = (l: Locale, message: string) =>
  say(l, message, HOLES)
    .split(HOLE)[0]
    .replace(/[\s\u00a0\u202f]*:[\s\u00a0\u202f]*$/, '');

/** The value in `text` written from `message` ("Salon A" from "New message from Salon A"), or null. */
const valueIn = (l: Locale, message: string, text: string) => {
  const [before, after = ''] = say(l, message, HOLES).split(HOLE);
  return text.startsWith(before) && text.endsWith(after) && text.length > before.length + after.length
    ? text.slice(before.length, text.length - after.length)
    : null;
};

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
  // A label in any language: "Service", "Où", "Igihe" — French may put a space before the colon.
  const detail = /^(\p{Lu}[\p{L}\p{M}\p{N} .'’°-]{0,30}?)[ \u00a0\u202f]?: (.+)$/u;
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
  /** The reader's language (§308). */
  locale?: Locale;
}

/**
 * A seller's morning summary (§287, §292): every booking email they asked
 * to have together, as one list, each with its time.
 */
export function summaryEmail(opts: {
  items: Array<{ at: string; subject: string }>;
  appUrl: string;
  locale?: Locale;
}): {
  subject: string;
  body: string;
  email: Email;
} {
  const l = opts.locale ?? DEFAULT_LOCALE;
  const n = opts.items.length;
  const subject = say(l, '{n, plural, one {# booking update since yesterday} other {# booking updates since yesterday}}', { n });
  const lines = opts.items.map((i) => `${i.at} — ${i.subject}`).join('\n');
  return {
    subject,
    body:
      `${say(l, 'Here is what happened with your bookings.')}\n\n${lines}\n\n` +
      say(l, 'Each one is in your notifications, and all of them under Appointments.'),
    email: {
      preheader: opts.items
        .slice(0, 2)
        .map((i) => i.subject)
        .join(' · '),
      audience: 'BUSINESS',
      hero: {
        tone: 'accent',
        badge: { kind: 'glyph', glyph: String(Math.min(n, 99)) },
        eyebrow: say(l, 'Your morning summary'),
        title: subject,
        lead: say(l, 'Here is what happened with your bookings. Each one is also in your notifications.'),
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
      button: { label: say(l, 'See bookings'), url: `${opts.appUrl}/appointments` },
      footer: {
        reason: say(l, 'You chose one booking summary each morning instead of an email for each.'),
        manage: { label: say(l, 'Change what we send'), url: `${opts.appUrl}/notifications` },
      },
      locale: l,
    },
  };
}

/** Whether a sentence only says what the title already does. */
const sameWords = (a: string, b: string) => {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim();
  const [x, y] = [norm(a), norm(b)];
  return x.startsWith(y) || y.startsWith(x);
};

/** One notice, as an email in the platform's design (§292). */
export function noticeEmail(n: NoticeForEmail): { email: Email; calendar: string | null } {
  const l = n.locale ?? DEFAULT_LOCALE;
  const look: Look = LOOKS[n.type] ?? { tone: 'info', glyph: '&#8226;', eyebrow: msg('A notice') };
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
  // Details the ticket already shows are not said twice.
  const onTicket = new Set([DETAIL.service, DETAIL.where, DETAIL.when, DETAIL.deposit, DETAIL.depositPaid].map((m) => labelIn(l, m)));
  const amountRow = details.find((d) => d.label === labelIn(l, DETAIL.amount));
  const reference = labelIn(l, DETAIL.reference);
  const shown = details.filter((d) => d !== amountRow && !(booking && onTicket.has(d.label)));

  let badge: Badge | null = null;
  if (n.type === T.SHOP_MESSAGE && n.author?.logoUrl) badge = { kind: 'image', url: n.author.logoUrl };
  else if (look.glyph) badge = { kind: 'glyph', glyph: look.glyph };

  const customer = n.audience === 'CUSTOMER';
  const going =
    booking &&
    customer &&
    booking.status === AppointmentStatus.BOOKED &&
    (n.type === T.DEPOSIT_CONFIRMED || n.type === T.APPOINTMENT_REMINDER);

  // Someone's own words. A reviewer's note on an approval (§303) closes the
  // email, after the advice it goes with, and says who it is from.
  const noteLast = n.type === T.BUSINESS_APPROVED;
  const said = quotes.map((q) =>
    quote(
      q,
      n.type === T.NEW_MESSAGE && customer
        ? valueIn(l, 'New message from {businessName}', n.subject)
        : noteLast
          ? say(l, 'Our review team')
          : null,
    ),
  );

  const blocks: Array<Block | null> = [
    amountRow
      ? amount({
          label: n.type === T.PAYOUT_FAILED ? say(l, 'Did not arrive') : say(l, 'On its way to you'),
          value: amountRow.value,
          tone: n.type === T.PAYOUT_FAILED ? 'danger' : 'ok',
        })
      : null,
    booking ? bookingTicket(booking, { timeZone: n.timeZone, audience: n.audience, locale: l }) : null,
    // The code they will be asked for, where they will need it (§54.2).
    going && n.arrivalCode
      ? codeBoxes(n.arrivalCode, {
          label: say(l, 'Your arrival code'),
          note: say(l, 'Give it to the shop when you arrive. Do not share it before.'),
        })
      : null,
    written && words.length
      ? letter(words.join('\n\n'), n.type === T.SHOP_MESSAGE ? (n.author?.name ?? null) : say(l, 'The BwanguReservations team'))
      : null,
    n.type === T.SHOP_MESSAGE && n.author ? prose(say(l, 'Open {shop} in the app to book.', { shop: n.author.name })) : null,
    ...(noteLast ? [] : said),
    shown.length ? facts(shown.map((d) => ({ ...d, strong: d.label === reference }))) : null,
    // The code is shown above, so the sentence pointing to it is not needed.
    ...(written ? [] : wordsAndLists(rest.filter((para) => !(going && n.arrivalCode && para === say(l, ARRIVAL))))),
    ...(noteLast ? said : []),
  ];

  const eyebrow = say(l, typeof look.eyebrow === 'function' ? look.eyebrow(n.audience) : look.eyebrow);
  const title = look.title?.({ audience: n.audience, booking, timeZone: n.timeZone, subject: n.subject, l }) ?? n.subject;
  // A shop's message or our announcement: written by someone, signed by them.
  const signed =
    n.type === T.SHOP_MESSAGE && n.author
      ? say(l, 'From {shop}', { shop: n.author.name })
      : n.type === T.ANNOUNCEMENT
        ? say(l, 'From the BwanguReservations team')
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
      locale: l,
    },
    calendar: going && booking ? icsFile(booking, l) : null,
  };
}
