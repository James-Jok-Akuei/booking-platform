import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { AdminLedgerController } from './admin-ledger.controller';

@Module({
  controllers: [AdminLedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
