import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { AdminLedgerController } from './admin-ledger.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // PaymentsModule, for the balance provider: reconciliation is the one place
  // that reads the ledger and asks the operator what it holds (§87).
  imports: [PaymentsModule],
  controllers: [AdminLedgerController],
  providers: [LedgerService, ReconciliationService],
  exports: [LedgerService],
})
export class LedgerModule {}
