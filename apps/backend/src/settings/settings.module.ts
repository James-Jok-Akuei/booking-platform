import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { AdminSettingsController } from './admin-settings.controller';

// Global: the platform fee is read when booking an appointment and when
// validating a service's deposit percentage, in two different feature modules.
@Global()
@Module({
  controllers: [AdminSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class SettingsModule {}
