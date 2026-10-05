import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OffersService } from '../src/offers/offers.service';

/**
 * Sends the weekly "near you" email NOW, without waiting for Friday (§140).
 *
 *   npm run dev:send-offers
 *
 * It is the same call the Friday job makes, so it obeys the same rules: only
 * customers who turned it on, and nobody written to in the last six days. To
 * see an email again inside that window, opt out and in again in the app.
 *
 * Refuses in production. It could not email anyone who had not asked — the
 * service will not — but an email "this week" belongs on the schedule, and a
 * person running it by hand on live data is a person about to send two.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production: the Friday job sends these.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(OffersService).sendDue();
    console.log(`Offers near you: ${result.sent} sent, ${result.skipped} skipped.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`\nSend failed:\n ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
