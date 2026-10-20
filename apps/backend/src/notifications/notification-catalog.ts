import { NotificationCategory as C, NotificationChannel, NotificationType as T, UserRole } from '@prisma/client';

/**
 * What each notification is, and what its recipient may choose about it
 * (§287). One place, so the settings screens, the sender and the email footer
 * cannot disagree.
 *
 * The in-app list always gets everything: it is the record. Choices are about
 * the two things that interrupt — a push, and an email.
 */

export type Audience = 'CUSTOMER' | 'BUSINESS' | 'ADMIN';

export const audienceOf = (role: UserRole | string): Audience =>
  role === UserRole.ADMIN ? 'ADMIN' : role === UserRole.BUSINESS ? 'BUSINESS' : 'CUSTOMER';

/** The channels a person can choose about. SMS is not built (§287). */
export type ChoiceChannel = Extract<NotificationChannel, 'EMAIL' | 'PUSH'>;
export const CHOICE_CHANNELS: ChoiceChannel[] = [NotificationChannel.EMAIL, NotificationChannel.PUSH];

/** One channel of one kind: on or off to begin with, and whether it may be changed. */
export interface ChannelRule {
  on: boolean;
  /** Why it cannot be turned off, said where the switch would be. */
  locked?: string;
}

export interface CategoryRule {
  category: C;
  title: string;
  hint: string;
  email?: ChannelRule;
  /** Left out where the audience has no push (administrators). */
  push?: ChannelRule;
  /** A push that can wait until quiet hours end. Bookings, reminders and messages cannot. */
  canWait: boolean;
  /** Marketing: off until the person says yes, and the yes is kept (§287). */
  needsYes?: boolean;
}

const ALWAYS_EMAILED = 'Always emailed — it is the record of your booking.';
const ACCOUNT_EMAILED = 'Always emailed — it is about your account.';

/** Each audience's kinds, in the order the settings screen shows them. */
export const CATEGORY_RULES: Record<Audience, CategoryRule[]> = {
  CUSTOMER: [
    {
      category: C.BOOKINGS,
      title: 'Bookings and payments',
      hint: 'When a booking is confirmed, changed, cancelled or missed, and when a payment does not go through.',
      email: { on: true, locked: ALWAYS_EMAILED },
      push: { on: true },
      canWait: false,
    },
    {
      category: C.REMINDERS,
      title: 'Reminders',
      hint: 'The day before an appointment, so you do not miss it.',
      email: { on: true },
      push: { on: true },
      canWait: false,
    },
    {
      category: C.MESSAGES,
      title: 'Messages',
      hint: 'When a shop writes to you. If you read it in the app first, no email follows.',
      email: { on: true },
      push: { on: true },
      canWait: false,
    },
    {
      category: C.REVIEWS,
      title: 'Reviews',
      hint: 'Asking how a visit went, and when a shop replies to your review.',
      email: { on: true },
      push: { on: true },
      canWait: true,
    },
    {
      category: C.SHOP_OFFERS,
      title: 'Offers from places you follow',
      hint: 'Only from shops you follow and said yes to. Change it per shop under Saved → Following.',
      email: { on: false },
      push: { on: true },
      canWait: true,
    },
    {
      category: C.NEWS,
      title: 'News and offers from us',
      hint: 'New places, deals and tips. A few a month at most.',
      email: { on: false },
      push: { on: false },
      canWait: true,
      needsYes: true,
    },
    {
      category: C.ACCOUNT,
      title: 'Account and support',
      hint: 'Your account, your support requests, and notices about the service.',
      email: { on: true, locked: ACCOUNT_EMAILED },
      push: { on: true },
      canWait: true,
    },
  ],
  BUSINESS: [
    {
      category: C.BOOKINGS,
      title: 'Bookings',
      hint: 'New bookings, deposits paid, cancellations and missed appointments.',
      email: { on: true, locked: 'Always emailed — one by one, or as one summary each morning.' },
      push: { on: true },
      canWait: false,
    },
    {
      category: C.MESSAGES,
      title: 'Messages',
      hint: 'When a customer writes. If you read it in the app first, no email follows.',
      email: { on: true },
      push: { on: true },
      canWait: false,
    },
    {
      category: C.REVIEWS,
      title: 'Reviews',
      hint: 'New reviews of your branches, and reviews hidden by our team.',
      email: { on: true },
      push: { on: true },
      canWait: true,
    },
    {
      category: C.MONEY,
      title: 'Money',
      hint: 'Payouts sent or failed, and your payout number checked.',
      email: { on: true },
      push: { on: true },
      canWait: true,
    },
    {
      category: C.ACCOUNT,
      title: 'Your shop and support',
      hint: 'Approval, your team, stories taken down, support replies and notices from us.',
      email: { on: true, locked: 'Always emailed — it is about your shop.' },
      push: { on: true },
      canWait: true,
    },
    {
      category: C.NEWS,
      title: 'News and tips from us',
      hint: 'New features and ideas to get more bookings. A few a month at most.',
      email: { on: false },
      push: { on: false },
      canWait: true,
      needsYes: true,
    },
  ],
  ADMIN: [
    {
      category: C.ADMIN_TICKETS,
      title: 'Support tickets',
      hint: 'New tickets and replies.',
      email: { on: true },
      canWait: false,
    },
    {
      category: C.ADMIN_QUEUE,
      title: 'Waiting for a check',
      hint: 'Shops sent for review, payout numbers to verify, arrivals verified without a code.',
      email: { on: true },
      canWait: false,
    },
    {
      category: C.ADMIN_SYSTEM,
      title: 'Platform problems',
      hint: 'Payments failing, the exchange rate out of date.',
      email: { on: true, locked: 'Always emailed — the platform needs you.' },
      canWait: false,
    },
    {
      category: C.ACCOUNT,
      title: 'Your account',
      hint: 'Invitations and notices about your account.',
      email: { on: true, locked: ACCOUNT_EMAILED },
      canWait: false,
    },
  ],
};

export const ruleFor = (audience: Audience, category: C): CategoryRule | undefined =>
  CATEGORY_RULES[audience].find((rule) => rule.category === category);

/** Marketing kinds: a few pushes a week at most, whatever was sent (§287). */
export const MARKETING: C[] = [C.NEWS, C.SHOP_OFFERS];
export const MARKETING_PUSHES_PER_WEEK = 3;

/** What a notification is about, for the person receiving it. */
export function categoryOf(type: T, audience: Audience): C {
  if (audience === 'ADMIN') {
    switch (type) {
      case T.TICKET_CREATED:
      case T.TICKET_MESSAGE:
      case T.TICKET_STATUS_CHANGED:
        return C.ADMIN_TICKETS;
      case T.EXCHANGE_RATE_STALE:
      case T.PAYMENT_PROVIDER_MISCONFIGURED:
        return C.ADMIN_SYSTEM;
      case T.BUSINESS_SUBMITTED:
      case T.BUSINESS_KIND_WRITTEN:
      case T.PAYOUT_DESTINATION_SUBMITTED:
      case T.APPOINTMENT_MANUALLY_VERIFIED:
        return C.ADMIN_QUEUE;
      default:
        return C.ACCOUNT;
    }
  }
  switch (type) {
    case T.APPOINTMENT_BOOKED:
    case T.DEPOSIT_CONFIRMED:
    case T.APPOINTMENT_CANCELLED:
    case T.APPOINTMENT_NO_SHOW:
    case T.DEPOSIT_FAILED:
    case T.BOOKING_CHOICES_CHANGED:
      return C.BOOKINGS;
    case T.APPOINTMENT_REMINDER:
      return C.REMINDERS;
    case T.NEW_MESSAGE:
      return C.MESSAGES;
    case T.REVIEW_CREATED:
    case T.REVIEW_RESPONSE:
    case T.REVIEW_HIDDEN:
    case T.APPOINTMENT_COMPLETED:
      return C.REVIEWS;
    case T.PAYOUT_DESTINATION_VERIFIED:
    case T.PAYOUT_DESTINATION_REJECTED:
    case T.PAYOUT_SENT:
    case T.PAYOUT_FAILED:
      return C.MONEY;
    case T.SHOP_MESSAGE:
    case T.SHOP_DISCOUNT:
      return C.SHOP_OFFERS;
    // Usually given its kind where it is raised (a booking's is BOOKINGS, §297).
    case T.SUPPORT_UPDATE:
    case T.NEW_SIGN_IN:
      return C.ACCOUNT;
    default:
      return C.ACCOUNT;
  }
}

/** What a notification is about, to open it at the right place. */
export interface NotificationRef {
  appointmentId?: string | null;
  threadId?: string | null;
  ticketId?: string | null;
  ticketReference?: string | null;
  locationId?: string | null;
}

/**
 * Where a notification opens, in its recipient's own app — the same path the
 * bell, a push and an email's button all go to (§287).
 */
export function linkFor(type: T, audience: Audience, ref: NotificationRef): string | null {
  if (audience === 'CUSTOMER') {
    switch (type) {
      case T.APPOINTMENT_BOOKED:
      case T.DEPOSIT_CONFIRMED:
      case T.APPOINTMENT_CANCELLED:
      case T.APPOINTMENT_NO_SHOW:
      case T.DEPOSIT_FAILED:
      case T.APPOINTMENT_REMINDER:
        return ref.appointmentId ? `/booking/${ref.appointmentId}` : '/bookings';
      case T.APPOINTMENT_COMPLETED:
        return ref.appointmentId ? `/review/${ref.appointmentId}` : '/bookings';
      case T.NEW_MESSAGE:
        return ref.threadId ? `/thread/${ref.threadId}` : '/messages';
      case T.TICKET_MESSAGE:
      case T.TICKET_STATUS_CHANGED:
        return ref.ticketId ? `/ticket/${ref.ticketId}` : null;
      case T.REVIEW_RESPONSE:
      case T.REVIEW_HIDDEN:
      case T.SHOP_MESSAGE:
      case T.SHOP_DISCOUNT:
        return ref.locationId ? `/shop/${ref.locationId}` : null;
      // Where you are signed in (§298).
      case T.NEW_SIGN_IN:
        return '/sessions';
      default:
        return null;
    }
  }
  if (audience === 'BUSINESS') {
    switch (type) {
      // The booking itself, opened (§290's `?open=`), when it is known.
      case T.APPOINTMENT_BOOKED:
      case T.DEPOSIT_CONFIRMED:
      case T.APPOINTMENT_REMINDER:
      case T.BOOKING_CHOICES_CHANGED:
        return ref.appointmentId ? `/appointments?open=${ref.appointmentId}` : '/appointments';
      case T.APPOINTMENT_CANCELLED:
      case T.APPOINTMENT_NO_SHOW:
        return ref.appointmentId ? `/appointments?tab=all&open=${ref.appointmentId}` : '/appointments?tab=all';
      case T.DEPOSIT_FAILED:
        return ref.appointmentId
          ? `/appointments?tab=awaiting-payment&open=${ref.appointmentId}`
          : '/appointments?tab=awaiting-payment';
      case T.NEW_MESSAGE:
        return ref.threadId ? `/messages?thread=${ref.threadId}` : '/messages';
      case T.TICKET_MESSAGE:
      case T.TICKET_STATUS_CHANGED:
        return '/help';
      case T.REVIEW_CREATED:
      case T.REVIEW_RESPONSE:
      case T.REVIEW_HIDDEN:
        return '/reviews';
      case T.STORY_REMOVED:
        return '/stories';
      case T.BUSINESS_APPROVED:
        return '/';
      case T.BUSINESS_REJECTED:
      case T.BUSINESS_SUSPENDED:
      case T.BUSINESS_REINSTATED:
        return '/profile';
      case T.BUSINESS_INVITATION:
        return '/people';
      case T.PAYOUT_DESTINATION_VERIFIED:
      case T.PAYOUT_DESTINATION_REJECTED:
      case T.PAYOUT_SENT:
      case T.PAYOUT_FAILED:
        return '/getting-paid';
      case T.NEW_SIGN_IN:
        return '/security';
      default:
        return null;
    }
  }
  switch (type) {
    case T.TICKET_CREATED:
    case T.TICKET_MESSAGE:
    case T.TICKET_STATUS_CHANGED:
      return ref.ticketReference ? `/tickets?ref=${encodeURIComponent(ref.ticketReference)}` : '/tickets';
    case T.BUSINESS_SUBMITTED:
    case T.BUSINESS_KIND_WRITTEN:
      return '/businesses';
    case T.PAYOUT_DESTINATION_SUBMITTED:
      return '/payout-destinations';
    case T.EXCHANGE_RATE_STALE:
    case T.PAYMENT_PROVIDER_MISCONFIGURED:
      return '/settings';
    case T.APPOINTMENT_MANUALLY_VERIFIED:
      return '/appointments';
    case T.NEW_SIGN_IN:
      return '/security';
    default:
      return null;
  }
}

// ---------- Time, in the platform's own clock ----------

/** Minutes after local midnight, in `timeZone`. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** Whether `minutes` falls in a window that may run past midnight (21:00–07:00). */
export const inWindow = (minutes: number, from: number, to: number) =>
  from === to ? false : from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;

/** The next moment the local clock in `timeZone` reads `target` minutes, after `from`. */
export function nextLocalTime(from: Date, timeZone: string, target: number): Date {
  const now = localMinutes(from, timeZone);
  let wait = target - now;
  if (wait <= 0) wait += 24 * 60;
  const next = new Date(from.getTime() + wait * 60_000);
  next.setUTCSeconds(0, 0);
  return next;
}

/** "Today", "Tomorrow", or "Monday" — how far an appointment is, as a person says it. */
export function dayWord(at: Date, timeZone: string, now = new Date()): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (day(at) === day(now)) return 'Today';
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(at);
}
