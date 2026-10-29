import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CountriesService } from '../countries/countries.service';
import { isLocalTime } from '../countries/local-time';
import { DocumentsService } from './documents.service';

/**
 * Papers running out (§314): looked at once a morning, at a quarter past
 * eight on each country's own clock (§315). The job wakes at a quarter past
 * every hour and reminds the countries where it is now eight.
 */
@Injectable()
export class DocumentsScheduler {
  private readonly logger = new Logger(DocumentsScheduler.name);

  constructor(
    private readonly documents: DocumentsService,
    private readonly countries: CountriesService,
  ) {}

  @Cron('0 15 * * * *', { name: 'business-documents-expiry' })
  async remind(now = new Date()) {
    let told = 0;
    for (const country of await this.countries.live()) {
      if (!isLocalTime(now, country.timeZone, { hour: 8 })) continue;
      told += await this.documents.expiryReminders(now, country.code);
    }
    if (told > 0) this.logger.log(`Told ${told} shop(s) about a paper running out.`);
    return told;
  }
}
