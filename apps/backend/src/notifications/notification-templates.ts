import { NotificationType } from '@prisma/client';
import { INTERNAL_CURRENCY, formatMoney } from '../payments/currency';
import { Audience, dayWord } from './notification-catalog';

export interface AppointmentContext {
  serviceName: string;
  locationName: string;
  businessName: string;
  startTime: Date;
  depositAmountMinor?: number;
  currency?: string;
  reason?: string;
  /** Whether the deposit was ever paid; left out where it does not matter. */
  depositPaid?: boolean;
}

/** Money for a person to read: "RWF 5,200" (§292). */
const money = (minor?: number, currency = INTERNAL_CURRENCY) =>
  minor === undefined ? '' : formatMoney(minor, currency);

/** "a manager", "a team member" — a role in a sentence, not a code. */
const roleWords = (role?: string) =>
  role === 'OWNER'
    ? 'an owner'
    : role === 'MANAGER'
      ? 'a manager'
      : role === 'STAFF'
        ? 'a team member'
        : role === 'ADMIN'
          ? 'an administrator'
          : null;

/**
 * Who cancelled, read from the sentence the cancellation was raised with
 * (§25, §33): it decides what happens to the deposit, which each side is
 * then told plainly. The sentences are written in AppointmentsService and the
 * payments scheduler; a new one falls through to saying nothing about money
 * rather than guessing.
 */
const cancelledBy = (reason?: string) =>
  !reason
    ? null
    : reason.startsWith('Cancelled by the customer')
      ? 'customer'
      : reason.startsWith('Cancelled by the business') || reason.startsWith('Reclassified')
        ? 'business'
        : reason.startsWith('The deposit was not paid')
          ? 'unpaid'
          : null;

/**
 * Copy for each notification type, rendered once at send time.
 *
 * Rendered text is stored on the row rather than re-rendered on read, so the
 * inbox always shows what was actually sent. Re-rendering against live data
 * would let a later cancellation silently rewrite the message that announced
 * the booking.
 *
 * Written as the email reads it (§292): a first paragraph that says what
 * happened, then any details as "Label: value" lines, then what happens next
 * — the email draws the details as a card and the rest as its words, and the
 * in-app list shows the same text. The same event reads differently to each
 * side, so most booking notices have a customer's version and a shop's.
 *
 * Times are in the platform's time zone, so "14:00" means the shop's 14:00.
 */
export function renderNotification(
  type: NotificationType,
  ctx: AppointmentContext & {
    timeZone: string;
    inviterEmail?: string;
    role?: string;
    /** Who is reading it — the same event reads differently to each side (§287). */
    audience?: Audience;
  },
): { subject: string; body: string } {
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    ctx.startTime ? new Intl.DateTimeFormat('en-GB', { timeZone: ctx.timeZone, ...options }).format(ctx.startTime) : '';
  // "Tuesday 20 October at 11:15" and "Tue 20 Oct, 11:15".
  const when = ctx.startTime
    ? `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')} at ${fmt({ hour: '2-digit', minute: '2-digit' })}`
    : '';
  const short = ctx.startTime
    ? `${fmt({ weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}, ${fmt({ hour: '2-digit', minute: '2-digit' })}`
    : '';
  const clock = fmt({ hour: '2-digit', minute: '2-digit' });
  const customer = ctx.audience === 'CUSTOMER';
  const details = (lines: Array<string | false | null | undefined>) => lines.filter(Boolean).join('\n');
  const booking = details([
    `Service: ${ctx.serviceName}`,
    `Where: ${ctx.locationName}`,
    when && `When: ${when}`,
  ]);

  switch (type) {
    case NotificationType.APPOINTMENT_BOOKED:
      return {
        subject: `New booking: ${ctx.serviceName}, ${short}`,
        body:
          `A customer just booked ${ctx.serviceName} at ${ctx.locationName}.\n\n` +
          `${booking}\n\n` +
          'The time is held while they pay the deposit, which usually takes a minute or two. ' +
          'We will tell you when it is paid; if it is not paid within 5 minutes, the time is free again.',
      };

    case NotificationType.DEPOSIT_CONFIRMED:
      if (customer) {
        return {
          subject: `You are booked: ${ctx.serviceName}, ${short}`,
          body:
            `Your deposit is paid and your booking at ${ctx.businessName} is confirmed.\n\n` +
            details([booking, ctx.depositAmountMinor !== undefined && `Deposit paid: ${money(ctx.depositAmountMinor, ctx.currency)}`]) +
            '\n\nWhen you arrive, give the shop your 6-digit arrival code. It is in the app, on the booking.',
        };
      }
      return {
        subject: `Confirmed: ${ctx.serviceName}, ${short}`,
        body:
          'The deposit is paid, so this booking is confirmed.\n\n' +
          details([booking, ctx.depositAmountMinor !== undefined && `Deposit: ${money(ctx.depositAmountMinor, ctx.currency)}`]) +
          '\n\nOn the day, the customer gives you a 6-digit arrival code. Enter it to check them in.',
      };

    case NotificationType.APPOINTMENT_CANCELLED: {
      // Nothing was paid, so there is nothing to refund or keep.
      const by = ctx.depositPaid === false && cancelledBy(ctx.reason) !== 'unpaid' ? 'nothing-paid' : cancelledBy(ctx.reason);
      const who = cancelledBy(ctx.reason);
      const why = by === 'business' && ctx.reason ? ctx.reason.replace(/^.*?Reason: /, '') : null;
      if (customer) {
        return {
          subject: `Cancelled: ${ctx.serviceName}, ${short}`,
          body:
            (who === 'customer'
              ? `You cancelled your booking at ${ctx.businessName}.`
              : who === 'business'
                ? `${ctx.businessName} cancelled your booking.`
                : by === 'unpaid'
                  ? `Your booking at ${ctx.businessName} was let go, because the deposit was not paid in time.`
                  : `Your booking at ${ctx.businessName} has been cancelled.`) +
            `\n\n${details([booking, why && `Reason: ${why}`])}\n\n` +
            (by === 'business'
              ? 'Your whole deposit comes back to you, the platform fee included.'
              : by === 'customer'
                ? 'As agreed when you booked, a deposit is not refunded when you cancel.'
                : by === 'unpaid' || by === 'nothing-paid'
                  ? 'No deposit was taken. You can book again at any time.'
                  : 'Anything you are owed is shown on the booking in the app.'),
        };
      }
      return {
        subject: `Cancelled: ${ctx.serviceName}, ${short}`,
        body:
          (who === 'customer'
            ? 'The customer cancelled this booking.'
            : who === 'business'
              ? 'This booking was cancelled by your shop.'
              : by === 'unpaid'
                ? 'This booking was let go, because the deposit was not paid in time.'
                : 'This booking has been cancelled.') +
          ` The time is free for someone else.\n\n${details([booking, why && `Reason: ${why}`])}` +
          (by === 'customer'
            ? '\n\nYour share of the deposit is still paid to you.'
            : by === 'business'
              ? '\n\nThe customer gets their whole deposit back, and the mobile money charge for sending it back is yours.'
              : ''),
      };
    }

    case NotificationType.APPOINTMENT_NO_SHOW:
      if (customer) {
        return {
          subject: `Marked as missed: ${ctx.serviceName}`,
          body:
            `${ctx.businessName} marked your booking as missed — you were expected at ${clock}.\n\n` +
            `${booking}\n\n` +
            'As agreed when you booked, the deposit is not refunded for a missed booking. ' +
            'If you think this is a mistake, write to the shop from the booking in the app.',
        };
      }
      return {
        subject: `Marked as missed: ${ctx.serviceName}`,
        body: `This booking was marked as missed.\n\n${booking}\n\nYour share of the deposit is paid to you.`,
      };

    case NotificationType.DEPOSIT_FAILED:
      if (customer) {
        return {
          subject: `Payment did not go through: ${ctx.serviceName}`,
          body:
            `Your deposit for ${ctx.serviceName} at ${ctx.businessName} did not go through.\n\n` +
            `${details([booking, ctx.reason && `Reason: ${ctx.reason}`])}\n\n` +
            'Your time is held for a few more minutes — open the booking in the app and try again.',
        };
      }
      return {
        subject: `Deposit not paid: ${ctx.serviceName}, ${short}`,
        body:
          `A customer's deposit for this booking did not go through.\n\n${details([booking, ctx.reason && `Reason: ${ctx.reason}`])}\n\n` +
          'The time is held a little longer while they try again, then it is free.',
      };

    case NotificationType.APPOINTMENT_REMINDER: {
      // "Today" or "Tomorrow" as it really is: a booking made in the morning
      // for the afternoon is reminded the same day (§287).
      const day = ctx.startTime ? dayWord(ctx.startTime, ctx.timeZone) : 'Soon';
      const said = day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : `on ${day}`;
      return {
        subject: `${day} at ${clock}: ${ctx.serviceName} at ${ctx.businessName}`,
        body:
          `See you ${said} at ${clock}.\n\n${booking}\n\n` +
          'When you arrive, give the shop your 6-digit arrival code. It is in the app, on the booking.',
      };
    }

    case NotificationType.NEW_MESSAGE:
      // To the shop it is a customer writing, not the shop itself (§287).
      if (ctx.audience === 'BUSINESS') {
        return {
          subject: 'New message from a customer',
          body:
            `A customer wrote to ${ctx.businessName}.\n\n` +
            (ctx.reason ? `"${ctx.reason}"\n\n` : '') +
            'Open Messages to read it and reply. More messages in this conversation will not email you again straight away.',
        };
      }
      return {
        subject: `New message from ${ctx.businessName}`,
        body:
          `${ctx.businessName} sent you a message.\n\n` +
          (ctx.reason ? `"${ctx.reason}"\n\n` : '') +
          'Open the app to read it and reply. More messages in this conversation will not email you again straight away.',
      };

    // Ticket notices reuse the shared context: serviceName carries the
    // reference and locationName the subject.
    case NotificationType.TICKET_CREATED:
      return {
        subject: `New ticket ${ctx.serviceName}: ${ctx.locationName}`,
        body: `Someone asked for help.\n\nReference: ${ctx.serviceName}\nSubject: ${ctx.locationName}\n\nOpen the ticket queue to answer it.`,
      };

    case NotificationType.TICKET_MESSAGE:
      if (ctx.audience === 'ADMIN') {
        return {
          subject: `New reply on ${ctx.serviceName}`,
          body: `There is a new reply on a ticket.\n\nReference: ${ctx.serviceName}\nSubject: ${ctx.locationName}\n\nOpen the ticket to read it and answer.`,
        };
      }
      return {
        subject: `We replied: ${ctx.locationName}`,
        body: `There is a new reply to your question.\n\nSubject: ${ctx.locationName}\nReference: ${ctx.serviceName}\n\nOpen Help to read it and reply.`,
      };

    case NotificationType.TICKET_STATUS_CHANGED: {
      // Raised as "Now RESOLVED." — said as what it means for them.
      const now = /^Now (\w+)\.$/.exec(ctx.reason ?? '')?.[1];
      const said =
        now === 'IN_PROGRESS'
          ? 'We are looking into your question.'
          : now === 'RESOLVED'
            ? 'We marked your question as solved. If it is not, reply within 14 days and it opens again.'
            : now === 'CLOSED'
              ? 'Your question is now closed.'
              : now === 'OPEN'
                ? 'Your question is open again, and we will reply soon.'
                : (ctx.reason ?? 'There is news on your question.');
      return {
        subject: `Update on your question: ${ctx.locationName}`,
        body:
          `${said}\n\n` +
          `Subject: ${ctx.locationName}\nReference: ${ctx.serviceName}\n\n` +
          'Open Help to see the whole conversation.',
      };
    }

    case NotificationType.REVIEW_CREATED:
      return {
        subject: 'You have a new review',
        body: `${ctx.reason ?? 'A customer reviewed one of your branches.'}\n\nOpen Reviews to read it. You can post one public reply.`,
      };

    case NotificationType.REVIEW_RESPONSE:
      return {
        subject: 'The shop replied to your review',
        body: `${ctx.reason ?? 'The shop replied to your review.'}\n\nOpen the shop in the app to read their reply.`,
      };

    case NotificationType.REVIEW_HIDDEN:
      return {
        subject: 'A review was hidden',
        body:
          `${ctx.reason ?? 'A review was hidden by our team and is no longer public.'}\n\n` +
          'If you think this is a mistake, write to us from Help.',
      };

    case NotificationType.STORY_REMOVED:
      return {
        subject: 'One of your stories was taken down',
        body:
          'Our team took down one of your stories, so customers no longer see it.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'If you think this is a mistake, write to us from Help.',
      };

    case NotificationType.DISPLAY_NAME_CLEARED:
      return {
        subject: 'The name on your reviews was removed',
        body:
          'Our team removed the name shown beside your reviews, so they now show as "Anonymous".\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'You can choose a new one the next time you write or edit a review.',
      };

    case NotificationType.EXCHANGE_RATE_STALE:
      return {
        subject: 'The exchange rate needs checking',
        body:
          'The exchange rate used to charge deposits has not been updated recently.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Deposits are still being charged at the stored rate, so nothing is blocked and no customer is affected yet. ' +
          'Check it against the market rate and update it if it has moved.',
      };

    case NotificationType.BUSINESS_SUBMITTED:
      return {
        subject: 'A shop is ready for review',
        body:
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'It cannot take bookings until it is approved. Approve it, or send it back with a reason the shop can act on.',
      };

    case NotificationType.BUSINESS_KIND_WRITTEN:
      return {
        subject: 'A live shop wrote in what it is',
        body:
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Check that it is a fair description in a few words. If many shops write the same thing, add it as a type in Categories.',
      };

    case NotificationType.BUSINESS_APPROVED:
      return {
        subject: 'Your shop is approved',
        body:
          'Good news — your shop has been approved.\n\n' +
          'Customers cannot see it yet. When you are ready, press "Post my shop" in your dashboard, and from then ' +
          'they can find your branches, see your times and book with you. Anything you would like to change first, you can change now.',
      };

    case NotificationType.BUSINESS_REJECTED:
      return {
        subject: 'Your shop was not approved yet',
        body:
          'We reviewed your shop and could not approve it yet.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'Everything you made is kept. Fix what the reason describes and send your shop back for review from your dashboard — ' +
          'or write to us from Help to talk it through.',
      };

    case NotificationType.BUSINESS_SUSPENDED:
      return {
        subject: 'Your shop has been suspended',
        body:
          'Our team suspended your shop. While it lasts, new customers cannot find or book with you, and your payments are paused.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'Bookings customers have already made still stand, and you are expected to honour them. Nothing is written off — ' +
          'money owed to you is kept and paid once this is resolved. Write to us from Help to talk about it.',
      };

    case NotificationType.BUSINESS_REINSTATED:
      return {
        subject: 'Your shop is back',
        body:
          'The suspension has been lifted. Customers can find and book with you again, and money kept while you ' +
          'were suspended goes out with your next payment.',
      };

    case NotificationType.PAYOUT_DESTINATION_SUBMITTED:
      return {
        subject: 'A payout number needs checking',
        body:
          'A shop gave a mobile money number to be paid to.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Its payments are paused until the number is checked — nothing is lost, but the money is not moving. Check it or refuse it in the queue.',
      };

    case NotificationType.PAYOUT_DESTINATION_VERIFIED:
      return {
        subject: 'Your mobile money number is confirmed',
        body:
          'We checked the number you gave, and your payments now go there. Anything kept while it was being checked goes out with your next payment.\n\n' +
          'If you ever lose that number, give a new one straight away — payments pause until the new one is checked, which is what keeps your money safe.',
      };

    case NotificationType.PAYOUT_DESTINATION_REJECTED:
      return {
        subject: 'Your mobile money number was not accepted',
        body:
          'We could not accept the number you gave, so your payments stay paused.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'Nothing is written off — your money is kept. Give a corrected number under Getting paid to start again.',
      };

    case NotificationType.PAYMENT_PROVIDER_MISCONFIGURED:
      return {
        subject: 'Urgent: deposits are failing — the payment provider is set up wrongly',
        body:
          'A customer tried to pay a deposit and the payment provider refused it for a reason that will not fix itself.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'This is a platform fault, not the customer’s. Every deposit will keep failing until it is fixed — check the provider currency, ' +
          'the credentials and the target environment. No customer has been charged.',
      };

    case NotificationType.APPOINTMENT_MANUALLY_VERIFIED:
      return {
        subject: `Checked in without a code: ${ctx.serviceName} at ${ctx.locationName}`,
        body:
          `${ctx.businessName} checked a customer in for ${ctx.serviceName} at ${ctx.locationName}${when ? ` on ${when}` : ''} without the arrival code.\n\n` +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'This is allowed — a customer with no phone still has to be served. It is reported because it is the one way a booking ' +
          'is completed on the shop’s word alone, so a shop that uses it often is worth a look.',
      };

    case NotificationType.APPOINTMENT_COMPLETED:
      return {
        subject: `How was ${ctx.serviceName} at ${ctx.businessName}?`,
        body:
          `Thank you for visiting ${ctx.businessName}.\n\n` +
          'A few words about how it went help other people choose, and help the shop do even better. It takes a minute, in the app.',
      };

    case NotificationType.PAYOUT_SENT:
      return {
        subject: `Payment sent: ${money(ctx.depositAmountMinor, ctx.currency)}`,
        body:
          'A payment is on its way to your mobile money number.\n\n' +
          details([`Amount: ${money(ctx.depositAmountMinor, ctx.currency)}`, ctx.reason && `Reference: ${ctx.reason}`]) +
          '\n\nOpen Getting paid to see every booking it covers.',
      };

    case NotificationType.PAYOUT_FAILED:
      return {
        subject: 'A payment to you did not go through',
        body:
          'A payment could not reach your mobile money number.\n\n' +
          details([`Amount: ${money(ctx.depositAmountMinor, ctx.currency)}`, ctx.reason && `Reason: ${ctx.reason}`]) +
          '\n\nNothing is lost: the money is back in your balance and goes out with your next payment. If your number has changed, update it under Getting paid.',
      };

    // Written by a person, not a template: the title and the words are theirs (§287).
    case NotificationType.ANNOUNCEMENT:
    case NotificationType.SHOP_MESSAGE:
    case NotificationType.SHOP_DISCOUNT:
      return { subject: ctx.serviceName, body: ctx.reason ?? '' };

    case NotificationType.BUSINESS_INVITATION: {
      const as = roleWords(ctx.role);
      return {
        subject: `You are invited to join ${ctx.businessName}`,
        body:
          `${ctx.inviterEmail ?? 'The owner'} invited you to join ${ctx.businessName}${as ? ` as ${as}` : ''} on BwanguReservations.\n\n` +
          'To accept, sign in with this email address — that is all.',
      };
    }
  }
}
