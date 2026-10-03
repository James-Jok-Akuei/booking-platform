import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';
import { FavouritesModule } from '../favourites/favourites.module';

// SettingsModule is @Global(), so PlatformSettingsService needs no import.
@Module({
  // Each result says whether this customer saved it (§120).
  imports: [FavouritesModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
