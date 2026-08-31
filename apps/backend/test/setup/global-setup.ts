/**
 * Creates the test database if absent, then migrates it. Runs once per `npm test`.
 *
 * WHY A SEPARATE DATABASE ON THE SAME INSTANCE, rather than a second container:
 *
 * - `docker compose up` stays the only manual setup step, as required. A second
 *   compose service would be one more thing to remember and to keep in sync.
 * - It is the same Postgres server and version, so tests exercise the real
 *   engine behaviour these modules depend on — partial unique indexes (§15,
 *   §21.2) and CHECK constraints do not behave identically everywhere.
 * - Isolation that matters here is at the database level: `booking_platform_test`
 *   shares no tables, rows or sequences with `booking_platform`.
 * - It is cheaper on a laptop already running Colima.
 *
 * The trade-off is that a wrong DATABASE_URL could point tests at the dev
 * database; env.ts refuses to run unless the URL names the test database.
 */
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { TEST_DATABASE_NAME, toTestDatabaseUrl } from './env';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

  const devUrl = process.env.DATABASE_URL!;
  const testUrl = toTestDatabaseUrl(devUrl);
  // CREATE DATABASE cannot run from inside the database being created, so it is
  // issued against the always-present maintenance database.
  const adminUrl = devUrl.replace(/\/([^/?]+)(\?|$)/, '/postgres$2');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      `SELECT datname FROM pg_database WHERE datname = '${TEST_DATABASE_NAME}'`,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
      console.log(`\n  [test] created database ${TEST_DATABASE_NAME}`);
    }
  } finally {
    await admin.$disconnect();
  }

  // migrate deploy, not migrate dev: applies the committed migrations exactly,
  // so the schema under test is the schema that ships — including the
  // hand-written partial indexes and CHECK constraints Prisma cannot express.
  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
  console.log(`  [test] migrations applied to ${TEST_DATABASE_NAME}\n`);
}
