import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutsService } from './payouts.service';

/**
 * The scheduled payout run.
 *
 * Daily rather than hourly: entries become payable a week after an appointment
 * resolves (§34.3), so the difference between running at 02:00 and running at
 * 02:00 the next day is noise against a seven-day hold. A daily run also keeps
 * the number of separate transfers a human has to make manageable, which
 * matters while payouts are sent by hand (§35.1).
 *
 * The manual admin trigger stays regardless — a scheduled job nobody can run on
 * demand is a job nobody can test in production or use to fix a bad day.
 */
@Injectable()
export class PayoutsScheduler {
  private readonly logger = new Logger(PayoutsScheduler.name);

  constructor(private readonly payouts: PayoutsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'payout-run' })
  async runDaily() {
    const summary = await this.payouts.run();
    if (summary.payoutsCreated > 0) {
      this.logger.log(
        `Scheduled payout run created ${summary.payoutsCreated} payout(s) ` +
          `totalling ${summary.totalMinor} minor unit(s) of ` +
          `${summary.settlementCurrencies.join('/') || 'no currency'}, awaiting transfer.`,
      );
    }
    return summary;
  }

  /**
   * Asks the operator what happened to every transfer in flight (§64.4).
   *
   * Every minute, not every second: a mobile-money transfer settles in seconds
   * to minutes, and a payout sitting PROCESSING for an extra minute costs
   * nothing, while hammering the operator's status endpoint is how an
   * integration gets rate-limited.
   *
   * Deliberately separate from the daily run. A payout created today and sent
   * tomorrow still needs its outcome recorded, and tying that to the run would
   * leave it unanswered for a day.
   */
  @Cron('0 * * * * *', { name: 'payout-transfer-poll' })
  async pollTransfers() {
    const result = await this.payouts.pollInFlightTransfers();
    return result;
  }
}
