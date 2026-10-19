import { Global, Module } from '@nestjs/common';
import { SupportLogService } from './support-log.service';
import { SupportController } from './support.controller';

/** What support did (§297). Global: bookings, shops and people all write here. */
@Global()
@Module({
  controllers: [SupportController],
  providers: [SupportLogService],
  exports: [SupportLogService],
})
export class SupportLogModule {}
