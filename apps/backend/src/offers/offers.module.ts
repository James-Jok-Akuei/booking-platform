import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module';
import { MailModule } from '../mail/mail.module';
import {
  OffersPreferenceController,
  OffersUnsubscribeController,
} from './offers.controller';
import { OffersScheduler } from './offers.scheduler';
import { OffersService } from './offers.service';

/** Emails about services near a customer, for those who asked (§140). */
@Module({
  imports: [DiscoveryModule, MailModule],
  controllers: [OffersPreferenceController, OffersUnsubscribeController],
  providers: [OffersService, OffersScheduler],
  exports: [OffersService],
})
export class OffersModule {}
