/**
 * Redirects every test worker to the test database.
 *
 * Runs via jest `setupFiles`, which executes before the test framework and
 * before the test file's imports — so it lands before PrismaClient reads
 * DATABASE_URL at construction.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// process.cwd(), not __dirname: the suite runs as ESM (see jest.config.js) and
// __dirname does not exist there. Jest's rootDir is this package, so cwd is
// apps/backend.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

export const TEST_DATABASE_NAME = 'booking_platform_test';

/** Swaps the database name in the dev URL, keeping host/port/credentials. */
export function toTestDatabaseUrl(url: string): string {
  return url.replace(/\/([^/?]+)(\?|$)/, `/${TEST_DATABASE_NAME}$2`);
}

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error('DATABASE_URL is not set — is apps/backend/.env present?');
}

process.env.DATABASE_URL = toTestDatabaseUrl(devUrl);

// A guard, not a formality: pointing the suite at the dev database would let
// its truncations delete real data.
if (!process.env.DATABASE_URL.includes(TEST_DATABASE_NAME)) {
  throw new Error(
    `Refusing to run: DATABASE_URL does not point at ${TEST_DATABASE_NAME}. Got ${process.env.DATABASE_URL}`,
  );
}

process.env.NODE_ENV = 'test';
// Keep the suite off the network. No SMTP host means MailService reports itself
// unconfigured, so notifications are recorded and marked FAILED rather than
// attempting delivery — which is all these tests need.
process.env.SMTP_HOST = '';
