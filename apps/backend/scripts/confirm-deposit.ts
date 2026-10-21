/**
 * Confirms a deposit WITHOUT the payment provider (§53.4).
 *
 *   npm run dev:confirm-deposit -- <appointmentId> [chargedMinor]
 *
 * ## Why a script and not an endpoint
 *
 * An endpoint that marks money as received is one misconfiguration away from
 * being the worst bug in this system: a guard mis-wired, an environment
 * variable unset in the wrong place, and anyone can tell the platform they have
 * paid. There is no version of that risk worth the convenience.
 *
 * A script cannot be reached over the network at all. It runs where someone
 * already has the database credentials, which is a person who could have
 * written the row by hand anyway — so it adds convenience without adding
 * exposure.
 *
 * ## What it does
 *
 * Exactly what a real confirmation does, through the real service: writes the
 * provider charge as `initiateDepositPayment` would have, then calls
 * `applyPaymentResult(SUCCESSFUL)` — so the status change, `depositPaidAt` and
 * the ledger pair with their settlement amounts all happen through the code
 * that runs in production. It does not fabricate a BOOKED appointment; it
 * fabricates the provider's answer, which is the only part the sandbox owns.
 *
 * Guarded exactly as the demo seed is: all three of NODE_ENV, host and database
 * name must be right.
 */
import { NestFactory } from '@nestjs/core';
import { AppointmentStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';

/**
 * The same three conditions the demo seed uses, and for the same reason: any
 * one alone is too easy to satisfy by accident. This one writes money.
 */
function assertSafeDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set.');

  const parsed = new URL(url);
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '');

  const localHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];
  const allowedDatabases = [
    'booking_platform',
    'booking_platform_dev',
    'booking_platform_demo',
  ];

  const problems: string[] = [];
  if (process.env.NODE_ENV === 'production') problems.push('NODE_ENV is "production"');
  if (!localHosts.includes(host)) problems.push(`host "${host}" is not local`);
  if (!allowedDatabases.includes(database)) {
    problems.push(`database "${database}" is not one of ${allowedDatabases.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to confirm a deposit: ${problems.join('; ')}.\n` +
        'This marks money as RECEIVED without the provider having received it. ' +
        'It exists so the sandbox can be worked around locally, and nowhere else.',
    );
  }
}

async function main() {
  assertSafeDatabase(process.env.DATABASE_URL);

  const [appointmentId, chargedArg] = process.argv.slice(2);
  if (!appointmentId) {
    throw new Error(
      'Usage: npm run dev:confirm-deposit -- <appointmentId> [chargedMinor]',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const appointments = app.get(AppointmentsService);
  const settings = app.get(PlatformSettingsService);

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      depositAmountMinor: true,
      paymentProviderReferenceId: true,
      providerAmountMinor: true,
    },
  });
  if (!appointment) throw new Error(`No appointment ${appointmentId}.`);

  if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
    throw new Error(
      `Appointment ${appointmentId} is ${appointment.status}, not PENDING_PAYMENT. ` +
        'Only a pending deposit can be confirmed — this refuses rather than ' +
        'writing a second set of ledger entries.',
    );
  }

  // The money question, not the display one (§66.2): in a deployment that
  // charges in its own currency the display helper answers null — there is
  // nothing to approximate — which left this script refusing every deposit.
  const rate = await settings.getSettlementContext();
  if (!rate) {
    throw new Error(
      'No exchange rate is configured, so there is no charged amount to record. ' +
        'Set one first: PATCH /admin/settings/exchange-rate.',
    );
  }

  // What `initiateDepositPayment` would have written after the provider
  // accepted. Passing an explicit amount covers the case where the provider
  // charged something other than the straight conversion.
  const chargedMinor = chargedArg
    ? Number(chargedArg)
    : Math.round(appointment.depositAmountMinor * Number(rate.rate));
  if (!Number.isInteger(chargedMinor) || chargedMinor <= 0) {
    throw new Error(`chargedMinor must be a positive whole number, got "${chargedArg}".`);
  }

  const reference =
    appointment.paymentProviderReferenceId ?? `dev-confirm-${appointmentId.slice(0, 8)}`;

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      paymentProviderReferenceId: reference,
      paymentInitiatedAt: new Date(),
      providerCurrency: rate.settlementCurrency,
      providerAmountMinor: chargedMinor,
      exchangeRateUsed: rate.rate,
    },
  });

  // The REAL confirmation path. Everything downstream — status, depositPaidAt,
  // the ledger pair, the settlement split, the notifications — happens exactly
  // as it does in production.
  const status = await appointments.applyPaymentResult(
    appointmentId,
    reference,
    'SUCCESSFUL',
  );

  const entries = await prisma.ledgerEntry.findMany({
    where: { appointmentId },
    select: { type: true, amountMinor: true, settlementAmountMinor: true },
    orderBy: { type: 'asc' },
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `Appointment ${appointmentId} -> ${status}`,
      `  charged        ${chargedMinor} ${rate.settlementCurrency} minor units ` +
        `(rate ${rate.rate.toFixed(8)})`,
      `  reference      ${reference}`,
      '  ledger entries:',
      ...entries.map(
        (e) =>
          `    ${e.type.padEnd(22)} USD ${String(e.amountMinor).padStart(8)}c   ` +
          `${rate.settlementCurrency} ${String(e.settlementAmountMinor ?? 0).padStart(10)}`,
      ),
      '',
    ].join('\n'),
  );

  await app.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('\nConfirm failed:\n', error instanceof Error ? error.message : error);
  process.exit(1);
});
