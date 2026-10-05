import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OffersService } from './offers.service';

/**
 * The weekly "near you" email (§140).
 *
 * Friday at nine in the morning, Kigali time: the day people plan a weekend,
 * and an hour they are awake for. The zone is named here rather than left to
 * the server's clock, which is UTC wherever this is hosted.
 *
 * Running it more often would not send more — `OffersService.sendDue` skips
 * anyone written to in the last six days.
 */
@Injectable()
export class OffersScheduler {
  private readonly logger = new Logger(OffersScheduler.name);

  constructor(private readonly offers: OffersService) {}

  @Cron('0 0 9 * * 5', { name: 'offers-near-you', timeZone: 'Africa/Kigali' })
  async run(): Promise<void> {
    try {
      await this.offers.sendDue();
    } catch (error) {
      this.logger.error('The weekly offers run failed.', error as Error);
    }
  }
}
