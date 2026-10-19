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
import { StoriesModule } from './stories/stories.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { ShopMessagesModule } from './shop-messages/shop-messages.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { LedgerModule } from './ledger/ledger.module';
import { PayoutsModule } from './payouts/payouts.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { FavouritesModule } from './favourites/favourites.module';
import { LegalModule } from './legal/legal.module';
import { SupportLogModule } from './support/support-log.module';
import { SupportModule } from './support/support.module';
import { WellKnownModule } from './well-known/well-known.module';
import { OffersModule } from './offers/offers.module';
import { RoutingModule } from './routing/routing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),


    // Drives the appointment auto-transition sweep (see AppointmentsScheduler).
    ScheduleModule.forRoot(),

    // Serves the local-disk upload fallback at /uploads. Harmless when R2 is
    // configured — nothing is written to the folder in that case. See
    // StorageService for why the fallback exists at all.
    ServeStaticModule.forRoot(
      {
        rootPath: join(process.cwd(), 'uploads'),
        serveRoot: '/uploads',
        serveStaticOptions: { index: false, fallthrough: false },
      },
      // The emails' own pictures — the mark (§292). Loaded by mail apps from
      // APP_BASE_URL, so they are kept with the server that sends the emails.
      {
        rootPath: join(process.cwd(), 'assets', 'email'),
        serveRoot: '/email',
        serveStaticOptions: {
          index: false,
          fallthrough: false,
          maxAge: '30d',
          // The font (§299) is read by webmail on another address, which a browser allows only when told.
          setHeaders: (res: { setHeader: (name: string, value: string) => void }, path: string) => {
            if (path.endsWith('.woff2')) res.setHeader('Access-Control-Allow-Origin', '*');
          },
        },
      },
    ),

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
    StoriesModule,
    AnnouncementsModule,
    ShopMessagesModule,
    AnalyticsModule,
    LedgerModule,
    PayoutsModule,
    DiscoveryModule,
    FavouritesModule,
    LegalModule,
    OffersModule,
    RoutingModule,
    SupportLogModule,
    SupportModule,
    WellKnownModule,
  ],
})
export class AppModule {}
