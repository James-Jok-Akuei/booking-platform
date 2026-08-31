import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { NOTIFICATION_CHANNEL } from './notification-channel.interface';
import { MailModule } from '../mail/mail.module';

/**
 * Global, because notifications are raised from the appointments, payments and
 * business modules — anywhere something happens that a person should hear about.
 *
 * The channel is resolved through a factory for the same reason §17 resolves
 * its payment provider that way: swapping email for SMS should be one case
 * here, not an edit to every service that raises a notification.
 */
@Global()
@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsScheduler,
    EmailNotificationChannel,
    {
      provide: NOTIFICATION_CHANNEL,
      inject: [EmailNotificationChannel],
      useFactory: (email: EmailNotificationChannel) => email,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
