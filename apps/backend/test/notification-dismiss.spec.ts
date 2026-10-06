import { NotificationType } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NOTIFICATION_CHANNEL } from '../src/notifications/notification-channel.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { createCustomer } from './setup/factories';

/**
 * Taking a notification off the list (§159). What is protected: a dismissed
 * one leaves the inbox and the badge but not the database; one person cannot
 * dismiss another's; "clear read" leaves the unread ones alone.
 */
describe('Dismissing notifications (§159)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let me: { userId: string };
  let other: { userId: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      NotificationsService,
      { provide: NOTIFICATION_CHANNEL, useValue: { send: async () => undefined } },
    ]);
    prisma = moduleRef.get(PrismaService);
    notifications = moduleRef.get(NotificationsService);
    await resetDatabase(prisma);
    me = await createCustomer(prisma);
    other = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => prisma.notification.deleteMany({}));

  const row = (recipientId: string, read = false) =>
    prisma.notification.create({
      data: {
        recipientId,
        type: NotificationType.DEPOSIT_CONFIRMED,
        subject: 'Confirmed',
        body: 'Your booking is confirmed.',
        ...(read ? { readAt: new Date() } : {}),
      },
    });

  it('takes one off the list and the badge, and keeps the row', async () => {
    const n = await row(me.userId);
    await row(me.userId);

    expect(await notifications.dismiss(me.userId, n.id)).toEqual({ id: n.id, dismissed: true });

    const page = await notifications.list(me.userId, false, 25, 0);
    expect(page.total).toBe(1);
    expect(page.unread).toBe(1);
    expect(page.notifications.map((x) => x.id)).not.toContain(n.id);
    expect(await prisma.notification.count({ where: { id: n.id } })).toBe(1);
  });

  it("will not dismiss someone else's, and says not found", async () => {
    const theirs = await row(other.userId);
    await expect(notifications.dismiss(me.userId, theirs.id)).rejects.toThrow(/not found/);
    expect((await notifications.list(other.userId, false, 25, 0)).total).toBe(1);
  });

  it('puts one back after an undo, and only one that was removed', async () => {
    const n = await row(me.userId);
    await notifications.dismiss(me.userId, n.id);

    expect(await notifications.restore(me.userId, n.id)).toEqual({ id: n.id, dismissed: false });
    const page = await notifications.list(me.userId, false, 25, 0);
    expect(page.notifications.map((x) => x.id)).toContain(n.id);
    // Back as read: it was seen, or it would not have been swiped.
    expect(page.unread).toBe(0);

    await expect(notifications.restore(me.userId, n.id)).rejects.toThrow(/not found/);
    await expect(notifications.restore(other.userId, n.id)).rejects.toThrow(/not found/);
  });

  it('clears the read ones and leaves the unread', async () => {
    await row(me.userId, true);
    await row(me.userId, true);
    const unread = await row(me.userId);

    expect(await notifications.dismissRead(me.userId)).toEqual({ dismissed: 2 });

    const page = await notifications.list(me.userId, false, 25, 0);
    expect(page.notifications.map((x) => x.id)).toEqual([unread.id]);
    // Twice is nothing.
    expect(await notifications.dismissRead(me.userId)).toEqual({ dismissed: 0 });
  });

  it('mark-all-read does not touch dismissed ones', async () => {
    const gone = await row(me.userId);
    await notifications.dismiss(me.userId, gone.id);
    await row(me.userId);

    expect((await notifications.markAllRead(me.userId)).updated).toBe(1);
  });
});
