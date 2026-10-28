// In ESM mode Jest injects describe/it/expect as globals, but not `jest`
// itself — it has to be imported.
import { jest } from '@jest/globals';
import { Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SupportLogService } from '../../src/support/support-log.service';
import { HealthChoices } from '../../src/appointments/health-choices';
import { LedgerService } from '../../src/ledger/ledger.service';
import { PlatformSettingsService } from '../../src/settings/platform-settings.service';
import { MailService } from '../../src/mail/mail.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { ChatService } from '../../src/chat/chat.service';
import { PaymentProviderRegistry } from '../../src/payments/payment-provider.registry';
import { DisbursementProviderRegistry } from '../../src/payments/disbursement-provider.registry';
import { MobileMoneyProvider } from '@prisma/client';
import { TaxonomyNamesService } from '../../src/categories/taxonomy-names.service';
import { MomoHealthService } from '../../src/payments/momo-health.service';
import { RefundsService } from '../../src/refunds/refunds.service';
import { DocumentsService } from '../../src/business/documents.service';
import { StorageService } from '../../src/storage/storage.service';
import {
  InitiatePaymentParams,
  InitiatePaymentResult,
  PaymentStatusResult,
} from '../../src/payments/payment-provider.interface';

/**
 * Builds a testing module from an explicit provider list, rather than importing
 * the whole AppModule.
 *
 * Not a stylistic preference — booting AppModule under Jest's ESM loader hangs
 * indefinitely at `.compile()` (blocked, at ~2% CPU, so not slow type-checking).
 * A targeted set compiles in well under a second. It is also better testing:
 * each suite states exactly which collaborators the behaviour under test needs.
 *
 * Everything reaching the network or an external service is stubbed. Per the
 * brief, the MTN sandbox stays a manual check — an automated suite that depends
 * on someone else's server and real test phone numbers is a suite that fails
 * for reasons unrelated to this code.
 */
export async function createTestModule(providers: Provider[]): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    // LedgerService sits alongside PrismaService rather than in each suite's
    // list, and REAL rather than stubbed. It reaches nothing outside the
    // database, and "money was recorded" is an invariant that should hold in
    // every suite that books an appointment — not only the one testing it
    // (§34). A stub here would let a missing ledger write pass unnoticed
    // everywhere except the ledger suite.
    // PlatformSettingsService joins them: LedgerService reads the payout hold
    // from it (§38), and like LedgerService it reaches nothing but the
    // database, so the real one is both cheaper and more honest than a stub.
    // DisbursementProviderRegistry joins them, EMPTY by default: PayoutsService
    // requires it, so without this every suite that touches payouts fails to
    // resolve (the §23.3 / inventory-#11 cascade, again). An empty registry is
    // the honest default — a test database has no operator credentials, so
    // "cannot pay out" is exactly true, and any suite testing the send path
    // supplies its own populated one.
    // SupportLogService too (§297): the booking service writes to it, and it
    // reaches nothing but the database. HealthChoices (§300.6) reaches nothing
    // at all — it seals and opens with the configured key.
    providers: [
      PrismaService,
      LedgerService,
      PlatformSettingsService,
      SupportLogService,
      HealthChoices,
      // Category names in each language, which search reads too (§308.7); the database only.
      TaxonomyNamesService,
      // MoMo's health (§310): a count in memory, nothing reached.
      MomoHealthService,
      RefundsService,
      // Business papers (§314): the local-disk storage, nothing reached.
      StorageService,
      DocumentsService,
      { provide: DisbursementProviderRegistry, useValue: new DisbursementProviderRegistry([]) },
      ...providers,
    ],
  }).compile();
}

/**
 * Stubs are declared with an implementation rather than `jest.fn()` alone.
 *
 * `jest.fn()` from `@jest/globals` infers an untyped function, which makes
 * `mockResolvedValue` take `never` — so every override was a type error, and
 * every one of them was invisible because `test/` was never typechecked
 * (§59.1). Giving each mock a real signature restores both: the overrides
 * typecheck, and a stub that drifts from the interface it stands in for now
 * fails to compile.
 */

/** Records calls so a test can assert a notification was raised, without SMTP. */
export const notificationsStub = () => ({
  notify: jest.fn(async (_params: unknown): Promise<void> => undefined),
  notifyBusiness: jest.fn(async (_params: unknown): Promise<void> => undefined),
  notifyUnregisteredEmail: jest.fn(async (_params: unknown): Promise<void> => undefined),
});

export const mailStub = () => ({
  isConfigured: () => false,
  sendGenericEmail: jest.fn(async (..._args: unknown[]): Promise<void> => undefined),
  sendOtpEmail: jest.fn(async (..._args: unknown[]): Promise<void> => undefined),
  sendAppointmentVerificationEmail: jest.fn(
    async (..._args: unknown[]): Promise<void> => undefined,
  ),
});

/** Never contacted. Payment behaviour is verified by hand against the sandbox. */
export const paymentProviderStub = () => ({
  key: MobileMoneyProvider.MTN_MOMO,
  name: 'stub',
  isConfigured: () => true,
  initiatePayment: jest.fn(
    async (_params: InitiatePaymentParams): Promise<InitiatePaymentResult> => ({
      providerReferenceId: 'stub-reference',
      status: 'PENDING',
    }),
  ),
  checkPaymentStatus: jest.fn(
    async (_reference: string): Promise<PaymentStatusResult> => ({ status: 'PENDING' }),
  ),
});

export const chatStub = () => ({
  createAppointmentThread: jest.fn(async (_params: unknown): Promise<void> => undefined),
});

export const commonStubs = {
  mail: (): Provider => ({ provide: MailService, useValue: mailStub() }),
  notifications: (): Provider => ({
    provide: NotificationsService,
    useValue: notificationsStub(),
  }),
  // A REAL registry over a stubbed provider, not a stubbed registry: the
  // resolution logic — which operator issued this reference — is exactly what
  // §57 added, so stubbing it out would test nothing. Reach the stub itself
  // with `registry.require(MobileMoneyProvider.MTN_MOMO)`.
  payments: (): Provider => ({
    provide: PaymentProviderRegistry,
    useValue: new PaymentProviderRegistry([paymentProviderStub() as never]),
  }),
  chat: (): Provider => ({ provide: ChatService, useValue: chatStub() }),
};

/**
 * Empties every table.
 *
 * TRUNCATE ... CASCADE rather than ordered deletes: it ignores foreign-key
 * ordering, so adding a model later cannot silently break cleanup. Run before
 * each suite so no suite's state depends on what ran before it.
 */
/**
 * Reference data, which is part of the country rather than of a test (§104).
 *
 * Seeded by a migration and never written by the application, so truncating it
 * would only make every test assert against a Rwanda with no provinces in it —
 * a state no deployment is ever in. Left standing, exactly as in production.
 */
const REFERENCE_TABLES = ['provinces', 'districts'];

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
      AND tablename <> ALL(${REFERENCE_TABLES}::text[])
  `;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}
