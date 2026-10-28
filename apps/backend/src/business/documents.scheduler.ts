import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentsService } from './documents.service';

/** Papers running out (§314): looked at once a morning, Kigali time. */
@Injectable()
export class DocumentsScheduler {
  private readonly logger = new Logger(DocumentsScheduler.name);

  constructor(private readonly documents: DocumentsService) {}

  @Cron('0 15 8 * * *', { name: 'business-documents-expiry', timeZone: 'Africa/Kigali' })
  async remind() {
    const told = await this.documents.expiryReminders();
    if (told > 0) this.logger.log(`Told ${told} shop(s) about a paper running out.`);
    return told;
  }
}
