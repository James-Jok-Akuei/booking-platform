import { NotificationType } from '@prisma/client';
import { INTERNAL_CURRENCY, formatMajorUnits } from '../payments/currency';

export interface AppointmentContext {
  serviceName: string;
  locationName: string;
  businessName: string;
  startTime: Date;
  depositAmountMinor?: number;
  currency?: string;
  reason?: string;
}

/**
 * Minor units rendered for a person to read.
 *
 * Goes through `formatMajorUnits` rather than dividing by 100, so a currency
 * with no minor unit reads as "RWF 11700" instead of "RWF 117.00" (§55.2).
 */
const money = (minor?: number, currency = INTERNAL_CURRENCY) =>
  minor === undefined ? '' : `${currency} ${formatMajorUnits(minor, currency)}`;

/**
 * Copy for each notification type, rendered once at send time.
 *
 * Rendered text is stored on the row rather than re-rendered on read, so the
 * inbox always shows what was actually sent. Re-rendering against live data
 * would let a later cancellation silently rewrite the message that announced
 * the booking.
 *
 * `when` is formatted in the platform timezone rather than UTC — a business
 * reading "14:00" needs it to mean their 14:00.
 */
export function renderNotification(
  type: NotificationType,
  ctx: AppointmentContext & { timeZone: string; inviterEmail?: string; role?: string },
): { subject: string; body: string } {
  const when = ctx.startTime
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: ctx.timeZone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(ctx.startTime)
    : '';

  switch (type) {
    case NotificationType.APPOINTMENT_BOOKED:
      return {
        subject: `New booking: ${ctx.serviceName} on ${when}`,
        body:
          `You have a new booking at ${ctx.locationName}.\n\n` +
          `Service: ${ctx.serviceName}\nWhen: ${when}\n\n` +
          'The slot is held while the customer pays their deposit. You will be ' +
          'notified again once the deposit is confirmed.',
      };

    case NotificationType.DEPOSIT_CONFIRMED:
      return {
        subject: `Confirmed: ${ctx.serviceName} on ${when}`,
        body:
          `The deposit for this appointment has been paid and the booking is confirmed.\n\n` +
          `Service: ${ctx.serviceName}\nWhere: ${ctx.locationName}\nWhen: ${when}\n` +
          `Deposit: ${money(ctx.depositAmountMinor, ctx.currency)}\n\n` +
          'The customer will give their arrival code on the day. The appointment ' +
          'cannot be completed without it.',
      };

    case NotificationType.APPOINTMENT_CANCELLED:
      return {
        subject: `Cancelled: ${ctx.serviceName} on ${when}`,
        body:
          `This appointment has been cancelled.\n\n` +
          `Service: ${ctx.serviceName}\nWhere: ${ctx.locationName}\nWhen: ${when}\n` +
          (ctx.reason ? `Reason: ${ctx.reason}\n` : '') +
          '\nThe slot is now available for other bookings.',
      };

    case NotificationType.APPOINTMENT_NO_SHOW:
      return {
        subject: `Marked as missed: ${ctx.serviceName} on ${when}`,
        body:
          `${ctx.businessName} has recorded this appointment as a no-show.\n\n` +
          `Service: ${ctx.serviceName}\nWhere: ${ctx.locationName}\nWhen: ${when}\n\n` +
          'As set out at booking, the deposit is not refundable. If you believe ' +
          'this is a mistake, contact the business directly.',
      };

    case NotificationType.DEPOSIT_FAILED:
      return {
        subject: `Payment failed: ${ctx.serviceName} on ${when}`,
        body:
          `The deposit payment for this appointment did not go through.\n\n` +
          `Service: ${ctx.serviceName}\nWhere: ${ctx.locationName}\nWhen: ${when}\n` +
          (ctx.reason ? `Reason: ${ctx.reason}\n` : '') +
          '\nYour slot is still held for a short time. Try the payment again to ' +
          'confirm the booking.',
      };

    case NotificationType.APPOINTMENT_REMINDER:
      return {
        subject: `Tomorrow: ${ctx.serviceName} at ${ctx.locationName}`,
        body:
          `A reminder about your appointment tomorrow.\n\n` +
          `Service: ${ctx.serviceName}\nWhere: ${ctx.locationName}\nWhen: ${when}\n\n` +
          'Bring the arrival code from your booking email — the business needs it ' +
          'to start your appointment.',
      };

    case NotificationType.NEW_MESSAGE:
      return {
        subject: `New message from ${ctx.businessName}`,
        body:
          `You have a new message in your conversation with ${ctx.businessName}.\n\n` +
          (ctx.reason ? `"${ctx.reason}"\n\n` : '') +
          'Open the app to read it and reply. Further messages in this ' +
          'conversation will not email you again straight away.',
      };

    // Ticket notifications reuse the shared context: serviceName carries the
    // reference and locationName the subject, so no new context shape is needed
    // for what is essentially a title and a line of detail.
    case NotificationType.TICKET_CREATED:
      return {
        subject: `New support ticket ${ctx.serviceName}: ${ctx.locationName}`,
        body:
          `A support ticket has been raised.\n\n` +
          `Reference: ${ctx.serviceName}\nSubject: ${ctx.locationName}\n\n` +
          'Open the admin ticket queue to review it.',
      };

    case NotificationType.TICKET_MESSAGE:
      return {
        subject: `New reply on ${ctx.serviceName}`,
        body:
          `There is a new reply on support ticket ${ctx.serviceName}.\n\n` +
          `Subject: ${ctx.locationName}\n\n` +
          'Open the ticket to read it and respond.',
      };

    case NotificationType.TICKET_STATUS_CHANGED:
      return {
        subject: `Update on ${ctx.serviceName}: ${ctx.locationName}`,
        body:
          `The status of your support ticket has changed.\n\n` +
          `Reference: ${ctx.serviceName}\nSubject: ${ctx.locationName}\n` +
          (ctx.reason ? `${ctx.reason}\n` : '') +
          '\nOpen the ticket to see the full history.',
      };

    case NotificationType.REVIEW_CREATED:
      return {
        subject: 'You have a new review',
        body:
          `A customer has reviewed one of your locations.\n\n` +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Open the location to read it. You can post one public reply.',
      };

    case NotificationType.REVIEW_RESPONSE:
      return {
        subject: 'The business replied to your review',
        body:
          `${ctx.reason ?? 'The business has replied to your review.'}\n\n` +
          'Open the location to read their reply.',
      };

    case NotificationType.REVIEW_HIDDEN:
      return {
        subject: 'A review was hidden by moderation',
        body:
          `A review has been hidden by an administrator and is no longer public.\n\n` +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'If you believe this is a mistake, raise a support ticket.',
      };

    case NotificationType.DISPLAY_NAME_CLEARED:
      return {
        subject: 'Your review display name was removed',
        body:
          'An administrator has removed the name shown beside your reviews. ' +
          'They now appear as "Anonymous".\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'You can set a new one the next time you write or edit a review. ' +
          'If you believe this is a mistake, raise a support ticket.',
      };

    case NotificationType.EXCHANGE_RATE_STALE:
      return {
        subject: 'The exchange rate needs checking',
        body:
          'The manual USD to provider-currency exchange rate has not been ' +
          'updated recently.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Deposits are STILL BEING CHARGED at the stored rate, so nothing is ' +
          'blocked and no customer is affected yet. Check it against the ' +
          'market rate and update it if it has moved.',
      };

    case NotificationType.BUSINESS_SUBMITTED:
      return {
        subject: 'A shop is ready for review',
        body:
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'It cannot take bookings until it is approved. Review it in the admin ' +
          'console, under Businesses — approve it, or reject it with a reason the ' +
          'shop can act on.',
      };

    case NotificationType.BUSINESS_KIND_WRITTEN:
      return {
        subject: 'A live shop wrote in what it is',
        body:
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Check that it is a fair description in a few words. If many shops ' +
          'write the same thing, add it as a type in Categories — the console ' +
          'can move those shops into it.',
      };

    case NotificationType.BUSINESS_APPROVED:
      return {
        subject: 'Your shop is approved — post it when you are ready',
        body:
          'Your shop has been approved. Customers cannot see it yet: open your ' +
          'dashboard and press "Post my shop" when you are ready, and from then ' +
          'they can find your branches, see your times and book with you.\n\n' +
          'Anything you would like to change first, you can change now.',
      };

    case NotificationType.BUSINESS_REJECTED:
      return {
        subject: 'Your business application was not approved',
        body:
          'An administrator has reviewed your application and not approved it.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'Your account and everything in it is intact. Fix what the reason ' +
          'describes, then send your shop back for review from your dashboard — ' +
          'or raise a support ticket if you would like to talk it through.',
      };

    case NotificationType.BUSINESS_SUSPENDED:
      return {
        subject: 'Your business has been suspended',
        body:
          'An administrator has suspended your business. New customers cannot ' +
          'find or book with you while this lasts, and payouts are paused.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'IMPORTANT: appointments customers have ALREADY booked are unaffected ' +
          'and you are still expected to honour them. Nothing has been written ' +
          'off — any balance owed to you is held and paid out once this is ' +
          'resolved. Raise a support ticket to discuss it.',
      };

    case NotificationType.BUSINESS_REINSTATED:
      return {
        subject: 'Your business has been reinstated',
        body:
          'The suspension has been lifted. Customers can find and book with you ' +
          'again, and any balance held while you were suspended goes out on the ' +
          'next payout run.',
      };

    case NotificationType.PAYOUT_DESTINATION_SUBMITTED:
      return {
        subject: 'A payout number needs verifying',
        body:
          'A business has submitted a mobile-money number for payouts.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'Their payouts are PAUSED until it is verified — nothing is lost, but ' +
          'the money is not moving. Verify or reject it in the admin queue.',
      };

    case NotificationType.PAYOUT_DESTINATION_VERIFIED:
      return {
        subject: 'Your payout number has been verified',
        body:
          'The mobile-money number you submitted has been verified. Any balance ' +
          'held while it was pending goes out on the next payout run.\n\n' +
          'If you ever lose control of that number, submit a new one straight ' +
          'away — payouts pause again until the new one is verified, which is ' +
          'the point.',
      };

    case NotificationType.PAYOUT_DESTINATION_REJECTED:
      return {
        subject: 'Your payout number was not accepted',
        body:
          'The mobile-money number you submitted has not been accepted, so ' +
          'payouts remain paused.\n\n' +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          'Nothing has been written off — your balance is held. Submit a ' +
          'corrected number to start again.',
      };

    case NotificationType.PAYMENT_PROVIDER_MISCONFIGURED:
      return {
        subject: 'URGENT: deposits are failing — payment provider misconfigured',
        body:
          'A customer tried to pay a deposit and the payment provider refused ' +
          'the request for a reason that will not fix itself.\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'This is a PLATFORM fault, not the customer\'s. Every deposit will ' +
          'keep failing until it is corrected — check the provider currency, ' +
          'the credentials and the target environment.\n\n' +
          'No customer has been charged.',
      };

    case NotificationType.APPOINTMENT_MANUALLY_VERIFIED:
      return {
        subject: `Arrival verified WITHOUT a code — ${ctx.serviceName} at ${ctx.locationName}`,
        body:
          `${ctx.businessName} marked a customer as arrived for ${ctx.serviceName} ` +
          `at ${ctx.locationName}${when ? ` on ${when}` : ''} without entering the ` +
          'arrival code (§54.3).\n\n' +
          (ctx.reason ? `${ctx.reason}\n\n` : '') +
          'This is a permitted path, not an error: a customer with no phone and ' +
          'no email still has to be served. It is reported because it is the one ' +
          'way an appointment can be completed on the business\'s word alone, so ' +
          'a business that uses it often is worth a look.',
      };

    case NotificationType.BUSINESS_INVITATION:
      return {
        subject: `You have been invited to join ${ctx.businessName}`,
        body:
          `${ctx.inviterEmail ?? 'A business owner'} has invited you to join ` +
          `${ctx.businessName}${ctx.role ? ` as ${ctx.role}` : ''}.\n\n` +
          'To accept, simply sign in with this email address. Verifying your ' +
          'login code is all that is needed — there is no separate invitation ' +
          'to accept.',
      };
  }
}
