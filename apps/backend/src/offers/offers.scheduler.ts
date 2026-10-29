import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CountriesService } from '../countries/countries.service';
import { isLocalTime } from '../countries/local-time';
import { OffersService } from './offers.service';

/**
 * The weekly "near you" email (§140).
 *
 * Friday at nine in the morning on each country's own clock (§315): the day
 * people plan a weekend, and an hour they are awake for. So the job wakes on
 * the hour and writes to the countries where it is now nine on a Friday —
 * Kigali at 07:00 UTC, Nairobi an hour earlier — rather than naming one zone.
 *
 * Running it more often would not send more — `OffersService.sendDue` skips
 * anyone written to in the last six days.
 */
@Injectable()
export class OffersScheduler {
  private readonly logger = new Logger(OffersScheduler.name);

  constructor(
    private readonly offers: OffersService,
    private readonly countries: CountriesService,
  ) {}

  @Cron('0 0 * * * *', { name: 'offers-near-you' })
  async run(now = new Date()): Promise<void> {
    for (const country of await this.countries.live()) {
      if (!isLocalTime(now, country.timeZone, { weekday: 5, hour: 9 })) continue;
      try {
        await this.offers.sendDue(now, country.code);
      } catch (error) {
        this.logger.error(`The weekly offers run failed for ${country.name}.`, error as Error);
      }
    }
  }
}
