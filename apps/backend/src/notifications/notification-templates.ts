import { NotificationType } from '@prisma/client';
import { adviceItems, adviceLead, type AdviceShop } from '../business/shop-advice';
import { describeDevice } from '../auth/device';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { DATE_TAGS, msg, say } from '../i18n/say';
import { INTERNAL_CURRENCY, formatMoney } from '../payments/currency';
import { Audience, dayKind } from './notification-catalog';

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
  /**
   * Sent with an approval (§303): the shop as it is, the items chosen, and the
   * reviewer's own note — written out in each reader's language (§308).
   */
  advice?: { shop: AdviceShop; keys: string[]; note: string | null };
  /** A new review's stars (§308: the sentence is written in each reader's language). */
  rating?: number;
  /** A new sign-in's phone or browser, as it describes itself (§298). */
  userAgent?: string | null;
  /**
   * Words composed where they are raised — what our support team did (§297)
   * — written out for each reader in their own language (§308).
   */
  compose?: (locale: Locale) => { subject: string; body: string };
}

/**
 * The advice under an approval (§303): the sentence, the list — one "• "
 * line each, which the email draws as a checklist — and the reviewer's note
 * in quotes, which it draws as their words. In the reader's language (§308).
 */
const adviceWords = (advice: AppointmentContext['advice'], l: Locale) => {
  if (!advice) return '';
  const chosen = new Set(advice.keys);
  const items = adviceItems(advice.shop, l).filter((item) => !item.done && chosen.has(item.key));
  return (
    (items.length ? `\n\n${adviceLead(l)}\n\n${items.map((item) => `• ${item.title} — ${item.why}.`).join('\n')}` : '') +
    (advice.note ? `\n\n“${advice.note}”` : '')
  );
};

/**
 * The "Label: value" lines, one sentence each, which the email reads back and
 * draws as a card (§292) — in any language, as long as it is "Label: value".
 */
export const DETAIL = {
  service: msg('Service: {serviceName}'),
  where: msg('Where: {locationName}'),
  when: msg('When: {when}'),
  deposit: msg('Deposit: {amount}'),
  depositPaid: msg('Deposit paid: {amount}'),
  amount: msg('Amount: {amount}'),
  reference: msg('Reference: {reference}'),
};

/** Where the arrival code is — the email shows the code itself instead. */
export const ARRIVAL = msg('When you arrive, give the shop your 6-digit arrival code. It is in the app, on the booking.');

/** Money for a person to read: "RWF 5,200" (§292). */
const money = (minor?: number, currency = INTERNAL_CURRENCY) =>
  minor === undefined ? '' : formatMoney(minor, currency);

/** "You are invited to join … as a manager" — the whole sentence for each role, in the reader's language (§308). */
const invitation = (l: Locale, role: string | undefined, inviter: string | undefined, businessName: string) => {
  const values = { businessName };
  if (inviter) {
    const who = { ...values, inviter };
    return role === 'OWNER'
      ? say(l, '{inviter} invited you to join {businessName} as an owner on BwanguReservations.', who)
      : role === 'MANAGER'
        ? say(l, '{inviter} invited you to join {businessName} as a manager on BwanguReservations.', who)
        : role === 'STAFF'
          ? say(l, '{inviter} invited you to join {businessName} as a team member on BwanguReservations.', who)
          : role === 'ADMIN'
            ? say(l, '{inviter} invited you to join {businessName} as an administrator on BwanguReservations.', who)
            : say(l, '{inviter} invited you to join {businessName} on BwanguReservations.', who);
  }
  return role === 'OWNER'
    ? say(l, 'The owner invited you to join {businessName} as an owner on BwanguReservations.', values)
    : role === 'MANAGER'
      ? say(l, 'The owner invited you to join {businessName} as a manager on BwanguReservations.', values)
      : role === 'STAFF'
        ? say(l, 'The owner invited you to join {businessName} as a team member on BwanguReservations.', values)
        : role === 'ADMIN'
          ? say(l, 'The owner invited you to join {businessName} as an administrator on BwanguReservations.', values)
          : say(l, 'The owner invited you to join {businessName} on BwanguReservations.', values);
};

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
    : reason.startsWith('Cancelled by the customer') || reason.startsWith('Cancelled by support for the customer')
      ? 'customer'
      : reason.startsWith('Cancelled by the business') ||
          reason.startsWith('Reclassified') ||
          reason.startsWith('Cancelled by support for the shop')
        ? 'business'
        : reason.startsWith('The deposit was not paid')
          ? 'unpaid'
          : null;

/** Whether our support team did it, on the side named (§297). */
const bySupport = (reason?: string) =>
  Boolean(reason && (reason.startsWith('Cancelled by support') || reason.startsWith('Reclassified by support')));

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
    /** The reader's language (§308); notices only administrators read stay in English. */
    locale?: Locale;
  },
): { subject: string; body: string } {
  const l = ctx.locale ?? DEFAULT_LOCALE;
  if (ctx.compose) return ctx.compose(l);
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    ctx.startTime ? new Intl.DateTimeFormat(DATE_TAGS[l], { timeZone: ctx.timeZone, ...options }).format(ctx.startTime) : '';
  const clock = fmt({ hour: '2-digit', minute: '2-digit' });
  // "Tuesday 20 October at 11:15" and "Tue 20 Oct, 11:15".
  const when = ctx.startTime
    ? say(l, '{day} at {time}', { day: fmt({ weekday: 'long', day: 'numeric', month: 'long' }).replace(',', ''), time: clock })
    : '';
  const short = ctx.startTime ? `${fmt({ weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}, ${clock}` : '';
  const customer = ctx.audience === 'CUSTOMER';
  const details = (lines: Array<string | false | null | undefined>) => lines.filter(Boolean).join('\n');
  const serviceName = ctx.serviceName;
  const locationName = ctx.locationName;
  const businessName = ctx.businessName;
  // "Label: value" lines: the email draws them as a card (§292), in any language.
  const booking = details([
    say(l, DETAIL.service, { serviceName }),
    say(l, DETAIL.where, { locationName }),
    when && say(l, DETAIL.when, { when }),
  ]);
  const reasonLine = (reason?: string | null) => reason && say(l, 'Reason: {reason}', { reason });
  const arrival = say(l, ARRIVAL);

  switch (type) {
    case NotificationType.APPOINTMENT_BOOKED:
      return {
        subject: say(l, 'New booking: {serviceName}, {short}', { serviceName, short }),
        body:
          `${say(l, 'A customer just booked {serviceName} at {locationName}.', { serviceName, locationName })}\n\n` +
          `${booking}\n\n` +
          say(
            l,
            'The time is held while they pay the deposit, which usually takes a minute or two. We will tell you when it is paid; if it is not paid within 5 minutes, the time is free again.',
          ),
      };

    case NotificationType.DEPOSIT_CONFIRMED: {
      const amount = money(ctx.depositAmountMinor, ctx.currency);
      if (customer) {
        return {
          subject: say(l, 'You are booked: {serviceName}, {short}', { serviceName, short }),
          body:
            `${say(l, 'Your deposit is paid and your booking at {businessName} is confirmed.', { businessName })}\n\n` +
            details([booking, ctx.depositAmountMinor !== undefined && say(l, DETAIL.depositPaid, { amount })]) +
            `\n\n${arrival}`,
        };
      }
      return {
        subject: say(l, 'Confirmed: {serviceName}, {short}', { serviceName, short }),
        body:
          `${say(l, 'The deposit is paid, so this booking is confirmed.')}\n\n` +
          details([booking, ctx.depositAmountMinor !== undefined && say(l, DETAIL.deposit, { amount })]) +
          `\n\n${say(l, 'On the day, the customer gives you a 6-digit arrival code. Enter it to check them in.')}`,
      };
    }

    case NotificationType.APPOINTMENT_CANCELLED: {
      // Nothing was paid, so there is nothing to refund or keep.
      const by = ctx.depositPaid === false && cancelledBy(ctx.reason) !== 'unpaid' ? 'nothing-paid' : cancelledBy(ctx.reason);
      const who = cancelledBy(ctx.reason);
      const support = bySupport(ctx.reason);
      const why = (who === 'business' || support) && ctx.reason?.includes('Reason: ') ? ctx.reason.replace(/^.*?Reason: /, '') : null;
      if (customer) {
        return {
          subject: say(l, 'Cancelled: {serviceName}, {short}', { serviceName, short }),
          body:
            (support && who === 'customer'
              ? say(l, 'Our support team cancelled your booking at {businessName}, as you asked.', { businessName })
              : support && who === 'business'
                ? say(l, "Your booking at {businessName} was cancelled on the shop's side by our support team.", { businessName })
                : who === 'customer'
                  ? say(l, 'You cancelled your booking at {businessName}.', { businessName })
                  : who === 'business'
                    ? say(l, '{businessName} cancelled your booking.', { businessName })
                    : by === 'unpaid'
                      ? say(l, 'Your booking at {businessName} was let go, because the deposit was not paid in time.', { businessName })
                      : say(l, 'Your booking at {businessName} has been cancelled.', { businessName })) +
            `\n\n${details([booking, reasonLine(why)])}\n\n` +
            (by === 'business'
              ? say(l, 'Your whole deposit comes back to you, the platform fee included.')
              : by === 'customer'
                ? say(l, 'As agreed when you booked, a deposit is not refunded when you cancel.')
                : by === 'unpaid' || by === 'nothing-paid'
                  ? say(l, 'No deposit was taken. You can book again at any time.')
                  : say(l, 'Anything you are owed is shown on the booking in the app.')),
        };
      }
      return {
        subject: say(l, 'Cancelled: {serviceName}, {short}', { serviceName, short }),
        body:
          (support && who === 'customer'
            ? say(l, 'Our support team cancelled this booking for the customer, as they asked.')
            : support && who === 'business'
              ? say(l, "Our support team cancelled this booking on your shop's side.")
              : who === 'customer'
                ? say(l, 'The customer cancelled this booking.')
                : who === 'business'
                  ? say(l, 'This booking was cancelled by your shop.')
                  : by === 'unpaid'
                    ? say(l, 'This booking was let go, because the deposit was not paid in time.')
                    : say(l, 'This booking has been cancelled.')) +
          ` ${say(l, 'The time is free for someone else.')}\n\n${details([booking, reasonLine(why)])}` +
          (by === 'customer'
            ? `\n\n${say(l, 'Your share of the deposit is still paid to you.')}`
            : by === 'business'
              ? `\n\n${say(l, 'The customer gets their whole deposit back, and the mobile money charge for sending it back is yours.')}`
              : ''),
      };
    }

    case NotificationType.APPOINTMENT_NO_SHOW:
      if (customer) {
        return {
          subject: say(l, 'Marked as missed: {serviceName}', { serviceName }),
          body:
            `${say(l, '{businessName} marked your booking as missed — you were expected at {clock}.', { businessName, clock })}\n\n` +
            `${booking}\n\n` +
            say(
              l,
              'As agreed when you booked, the deposit is not refunded for a missed booking. If you think this is a mistake, write to the shop from the booking in the app.',
            ),
        };
      }
      return {
        subject: say(l, 'Marked as missed: {serviceName}', { serviceName }),
        body: `${say(l, 'This booking was marked as missed.')}\n\n${booking}\n\n${say(l, 'Your share of the deposit is paid to you.')}`,
      };

    case NotificationType.DEPOSIT_FAILED:
      if (customer) {
        return {
          subject: say(l, 'Payment did not go through: {serviceName}', { serviceName }),
          body:
            `${say(l, 'Your deposit for {serviceName} at {businessName} did not go through.', { serviceName, businessName })}\n\n` +
            `${details([booking, reasonLine(ctx.reason)])}\n\n` +
            say(l, 'Your time is held for a few more minutes — open the booking in the app and try again.'),
        };
      }
      return {
        subject: say(l, 'Deposit not paid: {serviceName}, {short}', { serviceName, short }),
        body:
          `${say(l, "A customer's deposit for this booking did not go through.")}\n\n${details([booking, reasonLine(ctx.reason)])}\n\n` +
          say(l, 'The time is held a little longer while they try again, then it is free.'),
      };

    case NotificationType.APPOINTMENT_REMINDER: {
      // "Today" or "Tomorrow" as it really is: a booking made in the morning
      // for the afternoon is reminded the same day (§287).
      const kind = ctx.startTime ? dayKind(ctx.startTime, ctx.timeZone) : 'later';
      const weekday = fmt({ weekday: 'long' });
      return {
        subject:
          kind === 'today'
            ? say(l, 'Today at {clock}: {serviceName} at {businessName}', { clock, serviceName, businessName })
            : kind === 'tomorrow'
              ? say(l, 'Tomorrow at {clock}: {serviceName} at {businessName}', { clock, serviceName, businessName })
              : say(l, '{weekday} at {clock}: {serviceName} at {businessName}', { weekday, clock, serviceName, businessName }),
        body:
          (kind === 'today'
            ? say(l, 'See you today at {clock}.', { clock })
            : kind === 'tomorrow'
              ? say(l, 'See you tomorrow at {clock}.', { clock })
              : say(l, 'See you on {weekday} at {clock}.', { weekday, clock })) +
          `\n\n${booking}\n\n${arrival}`,
      };
    }

    case NotificationType.NEW_MESSAGE:
      // To the shop it is a customer writing, not the shop itself (§287).
      if (ctx.audience === 'BUSINESS') {
        return {
          subject: say(l, 'New message from a customer'),
          body:
            `${say(l, 'A customer wrote to {businessName}.', { businessName })}\n\n` +
            (ctx.reason ? `"${ctx.reason}"\n\n` : '') +
            say(l, 'Open Messages to read it and reply. More messages in this conversation will not email you again straight away.'),
        };
      }
      return {
        subject: say(l, 'New message from {businessName}', { businessName }),
        body:
          `${say(l, '{businessName} sent you a message.', { businessName })}\n\n` +
          (ctx.reason ? `"${ctx.reason}"\n\n` : '') +
          say(l, 'Open the app to read it and reply. More messages in this conversation will not email you again straight away.'),
      };

    // Ticket notices reuse the shared context: serviceName carries the
    // reference and locationName the subject. To our team: English (§308).
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
        subject: say(l, 'We replied: {subject}', { subject: locationName }),
        body:
          `${say(l, 'There is a new reply to your question.')}\n\n` +
          `${say(l, 'Subject: {subject}', { subject: locationName })}\n${say(l, DETAIL.reference, { reference: serviceName })}\n\n` +
          say(l, 'Open Help to read it and reply.'),
      };

    case NotificationType.TICKET_STATUS_CHANGED: {
      // Raised as "Now RESOLVED." — said as what it means for them.
      const now = /^Now (\w+)\.$/.exec(ctx.reason ?? '')?.[1];
      const said =
        now === 'IN_PROGRESS'
          ? say(l, 'We are looking into your question.')
          : now === 'RESOLVED'
            ? say(l, 'We marked your question as solved. If it is not, reply within 14 days and it opens again.')
            : now === 'CLOSED'
              ? say(l, 'Your question is now closed.')
              : now === 'OPEN'
                ? say(l, 'Your question is open again, and we will reply soon.')
                : (ctx.reason ?? say(l, 'There is news on your question.'));
      return {
        subject: say(l, 'Update on your question: {subject}', { subject: locationName }),
        body:
          `${said}\n\n` +
          `${say(l, 'Subject: {subject}', { subject: locationName })}\n${say(l, DETAIL.reference, { reference: serviceName })}\n\n` +
          say(l, 'Open Help to see the whole conversation.'),
      };
    }

    case NotificationType.REVIEW_CREATED:
      return {
        subject: say(l, 'You have a new review'),
        body:
          (ctx.rating
            ? say(l, '{rating, plural, one {A customer left a #-star review.} other {A customer left a #-star review.}}', {
                rating: ctx.rating,
              })
            : say(l, 'A customer reviewed one of your branches.')) +
          `\n\n${say(l, 'Open Reviews to read it. You can post one public reply.')}`,
      };

    case NotificationType.REVIEW_RESPONSE:
      return {
        subject: say(l, 'The shop replied to your review'),
        body: `${say(l, 'The shop replied to your review.')}\n\n${say(l, 'Open the shop in the app to read their reply.')}`,
      };

    // To the author with our team's reason; to the shop, that its rating moved.
    case NotificationType.REVIEW_HIDDEN:
      return {
        subject: say(l, 'A review was hidden'),
        body:
          (customer
            ? say(l, 'Our team hid your review, so it is no longer public.')
            : ctx.audience === 'BUSINESS'
              ? say(l, 'Our team hid a review of one of your branches. It is no longer public, and it no longer counts in your rating.')
              : say(l, 'A review was hidden by our team and is no longer public.')) +
          (ctx.reason ? `\n\n${reasonLine(ctx.reason)}` : '') +
          `\n\n${say(l, 'If you think this is a mistake, write to us from Help.')}`,
      };

    case NotificationType.STORY_REMOVED:
      return {
        subject: say(l, 'One of your stories was taken down'),
        body:
          `${say(l, 'Our team took down one of your stories, so customers no longer see it.')}\n\n` +
          (ctx.reason ? `${reasonLine(ctx.reason)}\n\n` : '') +
          say(l, 'If you think this is a mistake, write to us from Help.'),
      };

    case NotificationType.DISPLAY_NAME_CLEARED:
      return {
        subject: say(l, 'The name on your reviews was removed'),
        body:
          `${say(l, 'Our team removed the name shown beside your reviews, so they now show as "Anonymous".')}\n\n` +
          (ctx.reason ? `${reasonLine(ctx.reason)}\n\n` : '') +
          say(l, 'You can choose a new one the next time you write or edit a review.'),
      };

    // To our team: English (§308).
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
        subject: say(l, 'Your shop is approved'),
        body:
          `${say(l, 'Good news — your shop has been approved.')}\n\n` +
          say(
            l,
            'Customers cannot see it yet. When you are ready, press "Post my shop" in your dashboard, and from then they can find your branches, see your times and book with you. Anything you would like to change first, you can change now.',
          ) +
          adviceWords(ctx.advice, l),
      };

    case NotificationType.BUSINESS_REJECTED:
      return {
        subject: say(l, 'Your shop was not approved yet'),
        body:
          `${say(l, 'We reviewed your shop and could not approve it yet.')}\n\n` +
          (ctx.reason ? `${reasonLine(ctx.reason)}\n\n` : '') +
          say(
            l,
            'Everything you made is kept. Fix what the reason describes and send your shop back for review from your dashboard — or write to us from Help to talk it through.',
          ),
      };

    case NotificationType.BUSINESS_SUSPENDED:
      return {
        subject: say(l, 'Your shop has been suspended'),
        body:
          `${say(l, 'Our team suspended your shop. While it lasts, new customers cannot find or book with you, and your payments are paused.')}\n\n` +
          (ctx.reason ? `${reasonLine(ctx.reason)}\n\n` : '') +
          say(
            l,
            'Bookings customers have already made still stand, and you are expected to honour them. Nothing is written off — money owed to you is kept and paid once this is resolved. Write to us from Help to talk about it.',
          ),
      };

    case NotificationType.BUSINESS_REINSTATED:
      return {
        subject: say(l, 'Your shop is back'),
        body: say(
          l,
          'The suspension has been lifted. Customers can find and book with you again, and money kept while you were suspended goes out with your next payment.',
        ),
      };

    // To our team: English (§308).
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
        subject: say(l, 'Your mobile money number is confirmed'),
        body:
          `${say(l, 'We checked the number you gave, and your payments now go there. Anything kept while it was being checked goes out with your next payment.')}\n\n` +
          say(
            l,
            'If you ever lose that number, give a new one straight away — payments pause until the new one is checked, which is what keeps your money safe.',
          ),
      };

    case NotificationType.PAYOUT_DESTINATION_REJECTED:
      return {
        subject: say(l, 'Your mobile money number was not accepted'),
        body:
          `${say(l, 'We could not accept the number you gave, so your payments stay paused.')}\n\n` +
          (ctx.reason ? `${reasonLine(ctx.reason)}\n\n` : '') +
          say(l, 'Nothing is written off — your money is kept. Give a corrected number under Getting paid to start again.'),
      };

    // To our team: English (§308).
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
        subject: say(l, 'How was {serviceName} at {businessName}?', { serviceName, businessName }),
        body:
          `${say(l, 'Thank you for visiting {businessName}.', { businessName })}\n\n` +
          say(l, 'A few words about how it went help other people choose, and help the shop do even better. It takes a minute, in the app.'),
      };

    case NotificationType.PAYOUT_SENT: {
      const amount = money(ctx.depositAmountMinor, ctx.currency);
      return {
        subject: say(l, 'Payment sent: {amount}', { amount }),
        body:
          `${say(l, 'A payment is on its way to your mobile money number.')}\n\n` +
          details([say(l, DETAIL.amount, { amount }), ctx.reason && say(l, DETAIL.reference, { reference: ctx.reason })]) +
          `\n\n${say(l, 'Open Getting paid to see every booking it covers.')}`,
      };
    }

    case NotificationType.PAYOUT_FAILED: {
      const amount = money(ctx.depositAmountMinor, ctx.currency);
      return {
        subject: say(l, 'A payment to you did not go through'),
        body:
          `${say(l, 'A payment could not reach your mobile money number.')}\n\n` +
          details([say(l, DETAIL.amount, { amount }), reasonLine(ctx.reason)]) +
          `\n\n${say(
            l,
            'Nothing is lost: the money is back in your balance and goes out with your next payment. If your number has changed, update it under Getting paid.',
          )}`,
      };
    }

    // A customer changed their wishes or note after booking (§300.7). Never
    // what to: a health answer may be among them, and the booking shows it.
    case NotificationType.BOOKING_CHOICES_CHANGED:
      return {
        subject: say(l, 'Choices changed: {serviceName}, {short}', { serviceName, short }),
        body:
          `${say(l, 'The customer changed their choices or their note for {serviceName}.', { serviceName })}\n\n` +
          `${booking}\n\n` +
          say(l, 'Open the booking to see what they would like now.'),
      };

    // A sign-in on a phone or browser not seen before (§298), named in the reader's language.
    case NotificationType.NEW_SIGN_IN: {
      const device = ctx.userAgent !== undefined ? describeDevice(ctx.userAgent, l) : serviceName;
      return {
        subject: say(l, 'New sign-in on {device}', { device }),
        body:
          `${say(l, 'Your account was just signed in to on {device}.', { device })}\n\n` +
          details([say(l, 'Device: {device}', { device }), short && say(l, DETAIL.when, { when: short })]) +
          `\n\n${say(l, 'Was it you? Then there is nothing to do.')}\n\n` +
          say(l, 'If it was not you, open "Where you are signed in" in your account, sign that one out, and write to us from Help.'),
      };
    }

    // Written by a person, not a template: the title and the words are theirs (§287).
    // A support update is composed where support acts (§297), the same way.
    case NotificationType.SUPPORT_UPDATE:
    case NotificationType.ANNOUNCEMENT:
    case NotificationType.SHOP_MESSAGE:
    case NotificationType.SHOP_DISCOUNT:
      return { subject: ctx.serviceName, body: ctx.reason ?? '' };

    case NotificationType.BUSINESS_INVITATION:
      return {
        subject: say(l, 'You are invited to join {businessName}', { businessName }),
        body:
          `${invitation(l, ctx.role, ctx.inviterEmail, businessName)}\n\n` +
          say(l, 'To accept, sign in with this email address — that is all.'),
      };
  }
}
