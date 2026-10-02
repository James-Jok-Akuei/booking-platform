import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StorageModule } from './storage/storage.module';
import { CategoriesModule } from './categories/categories.module';
import { PlacesModule } from './places/places.module';
import { BusinessModule } from './business/business.module';
import { AvailabilityModule } from './availability/availability.module';
import { SettingsModule } from './settings/settings.module';
import { PaymentsModule } from './payments/payments.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatModule } from './chat/chat.module';
import { TicketsModule } from './tickets/tickets.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { LedgerModule } from './ledger/ledger.module';
import { PayoutsModule } from './payouts/payouts.module';
import { DiscoveryModule } from './discovery/discovery.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),


    // Drives the appointment auto-transition sweep (see AppointmentsScheduler).
    ScheduleModule.forRoot(),

    // Serves the local-disk upload fallback at /uploads. Harmless when R2 is
    // configured — nothing is written to the folder in that case. See
    // StorageService for why the fallback exists at all.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false, fallthrough: false },
    }),

    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    PlacesModule,
    BusinessModule,
    AvailabilityModule,
    SettingsModule,
    PaymentsModule,
    AppointmentsModule,
    NotificationsModule,
    ChatModule,
    TicketsModule,
    ReviewsModule,
    AnalyticsModule,
    LedgerModule,
    PayoutsModule,
    DiscoveryModule,
  ],
})
export class AppModule {}
