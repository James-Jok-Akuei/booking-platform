import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// Global for the same reason as PrismaModule and AuthModule: gallery uploads
// today, and business logos / verification documents / chat attachments later,
// all want the same single storage client rather than one per feature module.
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
