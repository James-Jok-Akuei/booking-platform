import { UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { ChatService } from '../src/chat/chat.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Who a customer is allowed to learn about from a chat message (§112.1).
 *
 * Every message carried its sender's EMAIL to both sides. On the customer's
 * phone that is the personal login address of whichever member of staff typed
 * the reply — handed out to anyone who messages the shop.
 *
 * §92.2 had already settled this for reviews: "the byline is the display name
 * and nothing else — never an id or an email." Chat simply did not follow, and
 * nothing noticed because no client had ever called these endpoints.
 */
describe('A chat sender, as each side sees it (§112.1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chat: ChatService;
  let business: TestBusiness;
  let customer: { userId: string; email: string };
  let threadId: string;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ChatService,
      StorageService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    chat = moduleRef.get(ChatService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
    customer = await createCustomer(prisma);

    const thread = await chat.createInquiryThread(customer.userId, business.businessId);
    threadId = thread.id;
    await chat.sendMessage({
      userId: customer.userId,
      role: UserRole.CUSTOMER,
      threadId,
      body: 'Do you do wheel alignment?',
    });
    await chat.sendMessage({
      userId: business.userId,
      role: UserRole.BUSINESS,
      threadId,
      body: 'Yes, any weekday.',
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const read = (userId: string, role: UserRole) =>
    chat.listMessages(userId, threadId, role, 50, 0) as Promise<{
      messages: Array<{ sender: Record<string, unknown> }>;
    }>;

  it('a customer gets no email on ANY message, including the shop’s', async () => {
    const page = await read(customer.userId, UserRole.CUSTOMER);

    expect(page.messages).toHaveLength(2);
    for (const message of page.messages) {
      expect(Object.keys(message.sender).sort()).toEqual(['id', 'role']);
    }
    // Said twice on purpose: the keys assertion above is what catches a field
    // being added back, and this is what the bug actually was.
    expect(JSON.stringify(page.messages)).not.toContain(business.email);
  });

  it('a customer can still tell their own message from the shop’s', async () => {
    const page = await read(customer.userId, UserRole.CUSTOMER);

    // Which is all a customer needs. Which member of staff replied is not
    // theirs to know; the shop's NAME is on the thread.
    expect(page.messages.map((m) => m.sender.role)).toEqual(['CUSTOMER', 'BUSINESS']);
    expect(page.messages[0].sender.id).toBe(customer.userId);
  });

  it('a business keeps it, on both sides of the conversation', async () => {
    const page = await read(business.userId, UserRole.BUSINESS);

    // Entitled to the customer's address (§28.6), and it is how several members
    // of staff (§14) tell each other apart in one thread.
    expect(page.messages[0].sender.email).toBe(customer.email);
    expect(page.messages[1].sender.email).toBe(business.email);
  });

  it('the reply a sender gets back follows the same rule', async () => {
    const mine = (await chat.sendMessage({
      userId: customer.userId,
      role: UserRole.CUSTOMER,
      threadId,
      body: 'Thanks.',
    })) as { sender: Record<string, unknown> };

    expect(Object.keys(mine.sender).sort()).toEqual(['id', 'role']);
  });

  it('and so does the realtime push, which cannot be tailored per viewer', async () => {
    const pushed: unknown[] = [];
    chat.registerRealtimePublisher({
      emitNewMessage: (_threadId, message) => pushed.push(message),
    });

    await chat.sendMessage({
      userId: business.userId,
      role: UserRole.BUSINESS,
      threadId,
      body: 'Any time.',
    });

    // One room holds both sides, so the payload is the narrower shape. A
    // business wanting the address has it on the thread.
    const sender = (pushed[0] as { sender: Record<string, unknown> }).sender;
    expect(Object.keys(sender).sort()).toEqual(['id', 'role']);
  });
});
