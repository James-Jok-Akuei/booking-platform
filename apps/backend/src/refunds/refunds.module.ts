import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { RefundsScheduler } from './refunds.scheduler';
import { AdminRefundsController } from './refunds.controller';

@Module({
  controllers: [AdminRefundsController],
  providers: [RefundsService, RefundsScheduler],
  exports: [RefundsService],
})
export class RefundsModule {}
