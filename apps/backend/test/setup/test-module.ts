// In ESM mode Jest injects describe/it/expect as globals, but not `jest`
// itself — it has to be imported.
import { jest } from '@jest/globals';
import { Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MailService } from '../../src/mail/mail.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { ChatService } from '../../src/chat/chat.service';
import { PAYMENT_PROVIDER } from '../../src/payments/payment-provider.interface';
import { CHAT_REALTIME, NOOP_CHAT_REALTIME } from '../../src/chat/chat-realtime.interface';

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
    providers: [PrismaService, ...providers],
  }).compile();
}

/** Records calls so a test can assert a notification was raised, without SMTP. */
export const notificationsStub = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  notifyBusiness: jest.fn().mockResolvedValue(undefined),
  notifyUnregisteredEmail: jest.fn().mockResolvedValue(undefined),
});

export const mailStub = () => ({
  isConfigured: () => false,
  sendGenericEmail: jest.fn().mockResolvedValue(undefined),
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  sendAppointmentVerificationEmail: jest.fn().mockResolvedValue(undefined),
});

/** Never contacted. Payment behaviour is verified by hand against the sandbox. */
export const paymentProviderStub = () => ({
  name: 'stub',
  initiatePayment: jest.fn(),
  checkPaymentStatus: jest.fn().mockResolvedValue({ status: 'PENDING' }),
});

export const chatStub = () => ({
  createAppointmentThread: jest.fn().mockResolvedValue(undefined),
});

export const commonStubs = {
  mail: (): Provider => ({ provide: MailService, useValue: mailStub() }),
  notifications: (): Provider => ({
    provide: NotificationsService,
    useValue: notificationsStub(),
  }),
  payments: (): Provider => ({ provide: PAYMENT_PROVIDER, useValue: paymentProviderStub() }),
  chat: (): Provider => ({ provide: ChatService, useValue: chatStub() }),
  realtime: (): Provider => ({ provide: CHAT_REALTIME, useValue: NOOP_CHAT_REALTIME }),
};

/**
 * Empties every table.
 *
 * TRUNCATE ... CASCADE rather than ordered deletes: it ignores foreign-key
 * ordering, so adding a model later cannot silently break cleanup. Run before
 * each suite so no suite's state depends on what ran before it.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}
