import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsScheduler } from './appointments.scheduler';
import { PaymentsScheduler } from './payments.scheduler';
import {
  AppointmentsBusinessController,
  AppointmentsCustomerController,
  AppointmentsSharedController,
} from './appointments.controller';
import { AdminAppointmentsController } from './admin-appointments.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { BusinessModule } from '../business/business.module';
import { MailModule } from '../mail/mail.module';
import { ChatModule } from '../chat/chat.module';
import { LedgerModule } from '../ledger/ledger.module';

// AvailabilityModule for the booking-time slot re-check, BusinessModule for
// BusinessRolesGuard, MailModule for the verification email.
@Module({
  imports: [AvailabilityModule, BusinessModule, MailModule, ChatModule, LedgerModule],
  controllers: [
    AppointmentsCustomerController,
    AppointmentsBusinessController,
    AppointmentsSharedController,
    AdminAppointmentsController,
  ],
  providers: [AppointmentsService, AppointmentsScheduler, PaymentsScheduler],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
