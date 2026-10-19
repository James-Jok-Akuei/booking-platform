import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import {
  NotificationChannelDriver,
  OutboundMessage,
} from '../notification-channel.interface';

/**
 * Email delivery, on top of the existing MailService transport.
 *
 * Deliberately thin. MailService owns the nodemailer transport and its
 * dev-vs-production error behaviour; this adds only the generic
 * subject/body send that notifications need, so the two OTP/appointment
 * methods keep their bespoke copy rather than being bent into a template
 * engine.
 */
@Injectable()
export class EmailNotificationChannel implements NotificationChannelDriver {
  readonly channel = NotificationChannel.EMAIL;

  constructor(private readonly mail: MailService) {}

  isConfigured(): boolean {
    return this.mail.isConfigured();
  }

  async send(message: OutboundMessage): Promise<void> {
    // In the platform's design, with why it came and how to stop it (§287, §292).
    if (message.email) {
      await this.mail.sendNotificationEmail(message.destination, {
        subject: message.subject,
        email: message.email.design,
        unsubscribeUrl: message.email.unsubscribeUrl,
        calendar: message.email.calendar,
      });
      return;
    }
    await this.mail.sendGenericEmail(message.destination, message.subject, message.body);
  }
}
