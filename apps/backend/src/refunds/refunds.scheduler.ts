import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RefundsService } from './refunds.service';

/**
 * Every minute (§313): answers from the operator first, then what is owed —
 * so a refund that just failed waits a minute before its next try.
 */
@Injectable()
export class RefundsScheduler {
  constructor(private readonly refunds: RefundsService) {}

  @Cron('30 * * * * *', { name: 'refunds-send-and-check' })
  async tick() {
    const checked = await this.refunds.pollInFlight();
    const sent = await this.refunds.sendDue();
    return { ...checked, handedOver: sent };
  }
}
