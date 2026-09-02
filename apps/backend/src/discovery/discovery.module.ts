import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';

// SettingsModule is @Global(), so PlatformSettingsService needs no import.
@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
