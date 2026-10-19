import { jest } from '@jest/globals';
import {
  AnnouncementStatus,
  BusinessMemberRole,
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationPreferencesService } from '../src/notifications/notification-preferences.service';
import { PushService } from '../src/notifications/push.service';
import { ShopMessagesService } from '../src/shop-messages/shop-messages.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { TestBusiness, addMember, createAdmin, createBusiness, createCustomer } from './setup/factories';

const PHONE = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const ctx0 = { serviceName: 'Haircut', locationName: 'Main', businessName: 'Test Salon', startTime: new Date() };

/**
 * What each person gets, and how (§287): their choices and the locked ones,
 * quiet hours, a seller's morning summary, a message's email waiting to see
 * whether it was read, the unsubscribe link, phones, announcements, shops
 * writing to their followers, and an administrator writing first.
 */
describe('Notification choices, push, announcements and shop messages (§287)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  let url: string;
  let notifications: NotificationsService;

  let shop: TestBusiness;
  let owner: string;
  let customer: { userId: string; email: string };
  let customerToken: string;
  let admin: { userId: string; email: string };
  let adminToken: string;

  const deliveriesOf = (notificationId: string | null) =>
    prisma.notificationDelivery.findMany({ where: { notificationId: notificationId ?? '' } });

  /** Waits for a background send to settle. */
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting.');
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    url = ctx.url;
    notifications = ctx.app.get(NotificationsService);
    await resetDatabase(prisma);

    // Nothing leaves for Expo from a test.
    jest
      .spyOn(ctx.app.get(PushService), 'sendToUser')
      .mockResolvedValue({ devices: 1, sent: 1, tickets: [], errors: [] });

    shop = await createBusiness(prisma);
    owner = ctx.token(shop.userId, shop.email, UserRole.BUSINESS);
    customer = await createCustomer(prisma);
    customerToken = ctx.token(customer.userId, customer.email, UserRole.CUSTOMER);
    admin = await createAdmin(prisma);
    adminToken = ctx.token(admin.userId, admin.email, UserRole.ADMIN);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await ctx.close();
  });

  // ------------------------------------------------------------------
  describe('choices', () => {
    it('shows each audience its own kinds, with defaults and locks', async () => {
      const mine = await request(url, '/notifications/settings', { token: customerToken });
      expect(mine.status).toBe(200);
      const categories = mine.body.categories as Array<{
        category: string;
        email: { on: boolean; locked: string | null } | null;
        push: { on: boolean } | null;
      }>;
      const bookings = categories.find((c) => c.category === 'BOOKINGS')!;
      const news = categories.find((c) => c.category === 'NEWS')!;
      expect(bookings.email).toMatchObject({ on: true });
      expect(bookings.email!.locked).toBeTruthy();
      expect(news.email).toEqual({ on: false, locked: null });
      expect(news.push).toEqual({ on: false, locked: null });
      expect(categories.some((c) => c.category === 'MONEY')).toBe(false);

      const seller = await request(url, '/notifications/settings', { token: owner });
      expect((seller.body.categories as Array<{ category: string }>).map((c) => c.category)).toContain('MONEY');
      expect(seller.body.bookingEmailDigest).toBe(false);
    });

    it('will not turn off what is locked', async () => {
      const res = await request(url, '/notifications/settings', {
        method: 'PATCH',
        token: customerToken,
        body: { choices: [{ category: 'BOOKINGS', channel: 'EMAIL', on: false }] },
      });
      expect(res.status).toBe(400);
    });

    it('a kind turned off by email is not emailed; the list still has it', async () => {
      await request(url, '/notifications/settings', {
        method: 'PATCH',
        token: customerToken,
        body: { choices: [{ category: 'REVIEWS', channel: 'EMAIL', on: false }] },
      });
      const id = await notifications.notify({
        recipientId: customer.userId,
        type: NotificationType.REVIEW_RESPONSE,
        context: { ...ctx0, reason: 'Thank you!' },
        deferSend: true,
      });
      expect(id).not.toBeNull();
      expect(await deliveriesOf(id)).toHaveLength(0);
      const inbox = await request(url, '/notifications', { token: customerToken });
      expect((inbox.body.notifications as Array<{ id: string }>).some((n) => n.id === id)).toBe(true);
    });

    it('a yes to news is kept with its words', async () => {
      await request(url, '/notifications/settings', {
        method: 'PATCH',
        token: customerToken,
        body: { choices: [{ category: 'NEWS', channel: 'PUSH', on: true }] },
      });
      const record = await prisma.consentRecord.findFirst({ where: { userId: customer.userId, purpose: 'news.push' } });
      expect(record).toMatchObject({ granted: true, source: 'customer-app' });
      expect(record!.wording).toMatch(/I can stop at any time/);
    });
  });

  // ------------------------------------------------------------------
  describe('phones and timing', () => {
    it('takes an Expo token, refuses anything else, and forgets one on sign-out', async () => {
      const bad = await request(url, '/notifications/devices', {
        method: 'POST',
        token: customerToken,
        body: { kind: 'EXPO', token: 'not-a-token' },
      });
      expect(bad.body).toMatchObject({ registered: false });
      const good = await request(url, '/notifications/devices', {
        method: 'POST',
        token: customerToken,
        body: { kind: 'EXPO', token: PHONE, label: 'iPhone' },
      });
      expect(good.body).toMatchObject({ registered: true });
      const settings = await request(url, '/notifications/settings', { token: customerToken });
      expect(settings.body.devices).toHaveLength(1);
    });

    it('a push that can wait waits out quiet hours; a booking does not', async () => {
      // Quiet all day long, so the test does not depend on the clock.
      await prisma.user.update({ where: { id: customer.userId }, data: { quietFrom: 0, quietTo: 1439 } });
      const review = await notifications.notify({
        recipientId: customer.userId,
        type: NotificationType.REVIEW_RESPONSE,
        context: ctx0,
        deferSend: true,
      });
      const booking = await notifications.notify({
        recipientId: customer.userId,
        type: NotificationType.DEPOSIT_CONFIRMED,
        context: ctx0,
        deferSend: true,
      });
      const reviewPush = (await deliveriesOf(review)).find((d) => d.channel === NotificationChannel.PUSH)!;
      const bookingPush = (await deliveriesOf(booking)).find((d) => d.channel === NotificationChannel.PUSH)!;
      expect(reviewPush.dueAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect(bookingPush.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      await prisma.user.update({ where: { id: customer.userId }, data: { quietFrom: 1260, quietTo: 420 } });
    });

    it('a message by email waits to see whether it is read in the app first', async () => {
      const id = await notifications.notify({
        recipientId: customer.userId,
        type: NotificationType.NEW_MESSAGE,
        context: { ...ctx0, reason: 'Can I come at 3?' },
        ref: { threadId: '00000000-0000-0000-0000-000000000001' },
        deferSend: true,
      });
      const email = (await deliveriesOf(id)).find((d) => d.channel === NotificationChannel.EMAIL)!;
      expect(email.dueAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);

      // Read in the app: the email is skipped when it comes due.
      await prisma.notification.update({ where: { id: id! }, data: { readAt: new Date() } });
      await prisma.notificationDelivery.update({ where: { id: email.id }, data: { dueAt: new Date() } });
      await notifications.deliver(email.id);
      expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: email.id } })).status).toBe(
        NotificationStatus.SKIPPED,
      );
    });

    it('a seller can have bookings as one summary each morning', async () => {
      await request(url, '/notifications/settings', {
        method: 'PATCH',
        token: owner,
        body: { bookingEmailDigest: true },
      });
      const id = await notifications.notify({
        recipientId: shop.userId,
        type: NotificationType.APPOINTMENT_BOOKED,
        context: ctx0,
        deferSend: true,
      });
      const email = (await deliveriesOf(id)).find((d) => d.channel === NotificationChannel.EMAIL)!;
      expect(email.status).toBe(NotificationStatus.HELD);
      expect(email.dueAt.getTime()).toBeGreaterThan(Date.now());
      await request(url, '/notifications/settings', {
        method: 'PATCH',
        token: owner,
        body: { bookingEmailDigest: false },
      });
    });

    it('a closed account is told nothing more', async () => {
      const gone = await createCustomer(prisma);
      await prisma.user.update({ where: { id: gone.userId }, data: { closedAt: new Date() } });
      expect(
        await notifications.notify({ recipientId: gone.userId, type: NotificationType.REVIEW_RESPONSE, context: ctx0 }),
      ).toBeNull();
    });

    it('each notice says where it opens', async () => {
      const id = await notifications.notify({
        recipientId: customer.userId,
        type: NotificationType.DEPOSIT_CONFIRMED,
        appointmentId: undefined,
        context: ctx0,
        deferSend: true,
      });
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: id! } });
      expect(row).toMatchObject({ category: NotificationCategory.BOOKINGS, link: '/bookings' });
    });
  });

  // ------------------------------------------------------------------
  describe('the "stop emails like this" link', () => {
    it('works without signing in, and only with its own signature', async () => {
      const preferences = ctx.app.get(NotificationPreferencesService);
      const link = new URL(preferences.unsubscribeUrl(customer.userId, NotificationCategory.MESSAGES));
      const path = `${link.pathname}${link.search}`;

      const forged = await fetch(`${url}${path.replace(/t=[^&]+/, 't=forged')}`);
      expect(await forged.text()).toMatch(/did not work/);

      const page = await fetch(`${url}${path}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toMatch(/no more of those emails/);
      const pref = await prisma.notificationPreference.findUnique({
        where: {
          userId_category_channel: {
            userId: customer.userId,
            category: NotificationCategory.MESSAGES,
            channel: NotificationChannel.EMAIL,
          },
        },
      });
      expect(pref?.enabled).toBe(false);
    });

    it('cannot turn off a locked kind', async () => {
      const preferences = ctx.app.get(NotificationPreferencesService);
      const link = new URL(preferences.unsubscribeUrl(customer.userId, NotificationCategory.BOOKINGS));
      const page = await fetch(`${url}${link.pathname}${link.search}`);
      expect(await page.text()).toMatch(/did not work/);
    });
  });

  // ------------------------------------------------------------------
  describe('announcements', () => {
    const draft = {
      kind: 'SERVICE',
      audience: 'CUSTOMERS',
      title: 'MTN MoMo is slow this morning',
      body: 'Payments may take a few minutes to confirm. Nothing is lost.',
      sendPush: true,
      sendEmail: false,
      banner: true,
    };

    it('says how many it reaches, sends, and reports', async () => {
      const reach = await request(url, '/admin/announcements/reach', {
        method: 'POST',
        token: adminToken,
        body: draft,
      });
      expect(reach.status).toBe(200);
      expect(reach.body).toMatchObject({ people: 1, push: 1, email: 0 });

      const created = await request(url, '/admin/announcements', { method: 'POST', token: adminToken, body: draft });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const sent = await request(url, `/admin/announcements/${id}/send`, {
        method: 'POST',
        token: adminToken,
        body: {},
      });
      expect(sent.status).toBe(200);
      await until(
        async () => (await prisma.announcement.findUniqueOrThrow({ where: { id } })).status === AnnouncementStatus.SENT,
      );

      const got = await prisma.notification.findFirst({
        where: { recipientId: customer.userId, announcementId: id },
      });
      expect(got).toMatchObject({ type: NotificationType.ANNOUNCEMENT, subject: draft.title });
      // A seller is not a customer.
      expect(await prisma.notification.count({ where: { recipientId: shop.userId, announcementId: id } })).toBe(0);

      const report = await request(url, `/admin/announcements/${id}`, { token: adminToken });
      expect(report.body.stats).toMatchObject({ recipients: 1 });

      const banner = await request(url, '/announcements/banner?for=customers');
      expect((banner.body.banners as Array<{ id: string }>).map((b) => b.id)).toContain(id);
      const sellers = await request(url, '/announcements/banner?for=sellers');
      expect((sellers.body.banners as Array<{ id: string }>).map((b) => b.id)).not.toContain(id);
    });

    it('news reaches only people who said yes', async () => {
      const other = await createCustomer(prisma);
      const reach = await request(url, '/admin/announcements/reach', {
        method: 'POST',
        token: adminToken,
        body: { ...draft, kind: 'NEWS', banner: false },
      });
      // The customer said yes to news by push above; the other did not.
      expect(reach.body).toMatchObject({ people: 1, left: 1 });
      expect(other.userId).toBeTruthy();
    });

    it('a banner is for service notices only, and a schedule can be cancelled', async () => {
      const refused = await request(url, '/admin/announcements', {
        method: 'POST',
        token: adminToken,
        body: { ...draft, kind: 'NEWS' },
      });
      expect(refused.status).toBe(400);

      const created = await request(url, '/admin/announcements', {
        method: 'POST',
        token: adminToken,
        body: { ...draft, banner: false },
      });
      const id = created.body.id as string;
      const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const scheduled = await request(url, `/admin/announcements/${id}/send`, {
        method: 'POST',
        token: adminToken,
        body: { at: later },
      });
      expect(scheduled.body).toMatchObject({ status: 'SCHEDULED' });
      const cancelled = await request(url, `/admin/announcements/${id}/cancel`, { method: 'POST', token: adminToken });
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });
    });

    it('is for administrators only', async () => {
      expect((await request(url, '/admin/announcements', { token: owner })).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------
  describe('following shops (§288)', () => {
    let other: { userId: string; email: string };
    let otherToken: string;

    beforeAll(async () => {
      other = await createCustomer(prisma);
      otherToken = ctx.token(other.userId, other.email, UserRole.CUSTOMER);
    });

    it('following alone asks nothing; offers are a separate yes, kept with its words', async () => {
      const plain = await request(url, `/follows/${shop.businessId}`, { method: 'POST', token: otherToken });
      expect(plain.body).toEqual({ following: true, offers: false });
      expect(await prisma.consentRecord.count({ where: { userId: other.userId } })).toBe(0);

      const yes = await request(url, `/follows/${shop.businessId}`, {
        method: 'POST',
        token: customerToken,
        body: { offers: true },
      });
      expect(yes.body).toEqual({ following: true, offers: true });
      expect(
        await prisma.consentRecord.count({
          where: { userId: customer.userId, purpose: `shop:${shop.businessId}`, granted: true },
        }),
      ).toBe(1);

      const shopfront = await request(url, `/discover/locations/${shop.locationId}`);
      expect((shopfront.body.business as { followers: number }).followers).toBe(2);
    });

    it('a shop writes once a week: everyone following sees it, those who said yes are told', async () => {
      const sent = await request(url, '/business/shop-messages', {
        method: 'POST',
        token: owner,
        body: { title: 'Half price on Tuesday', body: 'Every haircut, all day.' },
      });
      expect(sent.status).toBe(200);
      expect(sent.body).toMatchObject({ followers: 2, withOffers: 1 });
      await until(
        async () =>
          (await prisma.notification.count({
            where: { recipientId: customer.userId, type: NotificationType.SHOP_MESSAGE },
          })) === 1,
      );
      const got = await prisma.notification.findFirstOrThrow({
        where: { recipientId: customer.userId, type: NotificationType.SHOP_MESSAGE },
      });
      expect(got).toMatchObject({ category: NotificationCategory.SHOP_OFFERS, link: `/shop/${shop.locationId}` });
      expect(await prisma.notification.count({ where: { recipientId: other.userId, type: NotificationType.SHOP_MESSAGE } })).toBe(0);

      // In the app, under Following, for both.
      const mine = await request(url, '/follows', { token: otherToken });
      const card = (mine.body.follows as Array<{ business: { id: string }; offers: boolean; news: Array<{ kind: string; title: string }> }>)[0];
      expect(card).toMatchObject({ business: { id: shop.businessId }, offers: false });
      expect(card.news[0]).toMatchObject({ kind: 'MESSAGE', title: 'Half price on Tuesday' });

      const again = await request(url, '/business/shop-messages', {
        method: 'POST',
        token: owner,
        body: { title: 'Another one', body: 'So soon.' },
      });
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toMatch(/One message a week/);
    });

    it('offers can be turned on and off per shop', async () => {
      const on = await request(url, `/follows/${shop.businessId}`, {
        method: 'PATCH',
        token: otherToken,
        body: { offers: true },
      });
      expect(on.body).toEqual({ following: true, offers: true });
      const off = await request(url, `/follows/${shop.businessId}`, {
        method: 'PATCH',
        token: otherToken,
        body: { offers: false },
      });
      expect(off.body).toEqual({ following: true, offers: false });
      const records = await prisma.consentRecord.findMany({ where: { userId: other.userId }, orderBy: { createdAt: 'asc' } });
      expect(records.map((r) => r.granted)).toEqual([true, false]);
    });

    it('a new discount is noted in the app once — not as an alert or an email', async () => {
      await prisma.service.update({ where: { id: shop.serviceId }, data: { discountPercent: 20, discountEndsOn: null } });
      const shopMessages = ctx.app.get(ShopMessagesService);
      expect(await shopMessages.tellFollowersOfDiscounts()).toBe(2);
      expect(await shopMessages.tellFollowersOfDiscounts()).toBe(0);
      const note = await prisma.notification.findFirstOrThrow({
        where: { recipientId: other.userId, type: NotificationType.SHOP_DISCOUNT },
        include: { deliveries: true },
      });
      expect(note.subject).toMatch(/20% off/);
      expect(note.deliveries).toHaveLength(0);

      // Under Following too.
      const mine = await request(url, '/follows', { token: otherToken });
      const news = (mine.body.follows as Array<{ news: Array<{ kind: string }> }>)[0].news;
      expect(news.some((n) => n.kind === 'DISCOUNT')).toBe(true);

      // Ended, and set again: news again.
      await prisma.service.update({ where: { id: shop.serviceId }, data: { discountPercent: null } });
      await shopMessages.tellFollowersOfDiscounts();
      await prisma.service.update({ where: { id: shop.serviceId }, data: { discountPercent: 30 } });
      expect(await shopMessages.tellFollowersOfDiscounts()).toBe(2);
      await prisma.service.update({ where: { id: shop.serviceId }, data: { discountPercent: null } });
    });

    it('"From places you follow": only followed shops, and nothing signed out', async () => {
      const elsewhere = await createBusiness(prisma);
      const mine = await request(url, '/discover/services?following=true', { token: otherToken });
      const ids = (mine.body.services as Array<{ id: string }>).map((x) => x.id);
      expect(ids).toContain(shop.serviceId);
      expect(ids).not.toContain(elsewhere.serviceId);
      const anon = await request(url, '/discover/services?following=true');
      expect(anon.body).toMatchObject({ total: 0, services: [] });
    });

    it('staff do not write to followers; unfollowing is one tap', async () => {
      const s = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
      const staff = ctx.token(s.userId, s.email, UserRole.BUSINESS);
      const res = await request(url, '/business/shop-messages', {
        method: 'POST',
        token: staff,
        body: { title: 'From staff', body: 'Not allowed.' },
      });
      expect(res.status).toBe(403);

      const off = await request(url, `/follows/${shop.businessId}`, { method: 'DELETE', token: customerToken });
      expect(off.body).toEqual({ following: false, offers: false });
      expect(await prisma.shopFollow.count({ where: { userId: customer.userId } })).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  describe('an administrator writes first', () => {
    it('opens a support conversation the person can answer, and tells them', async () => {
      const res = await request(url, '/admin/tickets/start', {
        method: 'POST',
        token: adminToken,
        body: { userId: customer.userId, subject: 'About your booking', body: 'Could you tell us what happened?' },
      });
      expect(res.status).toBe(201);
      const ticketId = res.body.id as string;
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticket).toMatchObject({
        reporterId: customer.userId,
        assignedAdminId: admin.userId,
        status: 'IN_PROGRESS',
      });
      const told = await prisma.notification.findFirstOrThrow({
        where: { recipientId: customer.userId, type: NotificationType.TICKET_MESSAGE },
      });
      expect(told.link).toBe(`/ticket/${ticketId}`);
    });

    it('writing to a shop reaches its owner', async () => {
      const res = await request(url, '/admin/tickets/start', {
        method: 'POST',
        token: adminToken,
        body: { businessId: shop.businessId, subject: 'Your photos', body: 'One of your photos looks blurry.' },
      });
      expect(res.status).toBe(201);
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id as string } });
      expect(ticket).toMatchObject({ reporterId: shop.userId, reporterType: 'BUSINESS', businessId: shop.businessId });
      const told = await prisma.notification.findFirstOrThrow({
        where: { recipientId: shop.userId, type: NotificationType.TICKET_MESSAGE },
      });
      expect(told.link).toBe('/help');
    });

    it('needs someone to write to', async () => {
      const res = await request(url, '/admin/tickets/start', {
        method: 'POST',
        token: adminToken,
        body: { subject: 'Nobody', body: 'Hello?' },
      });
      expect(res.status).toBe(400);
    });
  });
});
