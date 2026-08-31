import { NotificationType } from '@prisma/client';

export interface AppointmentContext {
  serviceName: string;
  locationName: string;
  businessName: string;
  startTime: Date;
  depositAmountCents?: number;
  currency?: string;
  reason?: string;
}

const money = (cents?: number, currency = 'USD') =>
  cents === undefined ? '' : `${currency} ${(cents / 100).toFixed(2)}`;

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
          `Deposit: ${money(ctx.depositAmountCents, ctx.currency)}\n\n` +
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
