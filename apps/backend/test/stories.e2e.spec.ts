import { BusinessMemberRole, BusinessStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { StoriesService } from '../src/stories/stories.service';
import { StorageService } from '../src/storage/storage.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { TestBusiness, addMember, createAdmin, createBusiness, createCustomer } from './setup/factories';

const HOUR = 60 * 60 * 1000;

/** A tiny real PNG, so the upload is a picture and not just a label. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Shops' stories (§285), over HTTP: who may post, how many, what customers
 * see and for how long, and taking one down.
 */
describe('Stories (§285)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  let url: string;

  let shop: TestBusiness;
  let hidden: TestBusiness;
  let branchB: string;
  let owner: string;
  let staff: string;
  let branchManager: string;
  let customer: string;
  let admin: string;

  const post = (token: string, fields: Record<string, string> = {}, withFile = true) => {
    const form = new FormData();
    if (withFile) form.set('file', new Blob([PNG], { type: 'image/png' }), 'story.png');
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return fetch(`${url}/business/stories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }));
  };

  /** Every story gone, and the pictures the posted ones uploaded with them. */
  const wipe = async () => {
    const storage = ctx.app.get(StorageService);
    for (const story of await prisma.story.findMany({ select: { imageUrl: true } })) {
      await storage.remove(story.imageUrl);
    }
    await prisma.story.deleteMany({});
  };

  /** A story written straight to the database, for states a request cannot make quickly. */
  const seed = (
    business: TestBusiness,
    data: { createdAt?: Date; expiresAt?: Date; locationId?: string | null } = {},
  ) =>
    prisma.story.create({
      data: {
        businessId: business.businessId,
        imageUrl: 'http://localhost/uploads/stories/seed.png',
        caption: 'Seeded',
        createdAt: data.createdAt ?? new Date(),
        expiresAt: data.expiresAt ?? new Date(Date.now() + 24 * HOUR),
        locationId: data.locationId ?? null,
      },
    });

  beforeAll(async () => {
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    url = ctx.url;
    await resetDatabase(prisma);

    shop = await createBusiness(prisma);
    hidden = await createBusiness(prisma, { status: BusinessStatus.PENDING });
    branchB = (
      await prisma.location.create({ data: { businessId: shop.businessId, name: 'Branch B', address: 'Second Road' } })
    ).id;
    owner = ctx.token(shop.userId, shop.email, UserRole.BUSINESS);
    const s = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
    staff = ctx.token(s.userId, s.email, UserRole.BUSINESS);
    const m = await addMember(prisma, shop.businessId, BusinessMemberRole.MANAGER, [shop.locationId]);
    branchManager = ctx.token(m.userId, m.email, UserRole.BUSINESS);
    const c = await createCustomer(prisma);
    customer = ctx.token(c.userId, c.email, UserRole.CUSTOMER);
    const a = await createAdmin(prisma);
    admin = ctx.token(a.userId, a.email, UserRole.ADMIN);
  });

  afterAll(async () => {
    await wipe();
    await resetDatabase(prisma);
    await ctx.close();
  });

  beforeEach(wipe);

  // ------------------------------------------------------------------
  describe('posting', () => {
    it('the owner posts a photo and a few words; it lasts 24 hours', async () => {
      const res = await post(owner, { caption: 'Two slots free this afternoon' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ caption: 'Two slots free this afternoon', location: null, views: 0 });
      const lasts = new Date(res.body.expiresAt).getTime() - new Date(res.body.createdAt).getTime();
      expect(Math.abs(lasts - 24 * HOUR)).toBeLessThan(5000);

      const mine = await request(url, '/business/stories', { token: owner });
      expect(mine.body).toMatchObject({ postedToday: 1, dailyLimit: 10 });
    });

    it('needs a photo', async () => {
      expect((await post(owner, { caption: 'Words only' }, false)).status).toBe(400);
    });

    it('staff see the stories but do not post them', async () => {
      expect((await post(staff)).status).toBe(403);
      expect((await request(url, '/business/stories', { token: staff })).status).toBe(200);
    });

    it('a manager of some branches posts for one of theirs, and only theirs (§277)', async () => {
      expect((await post(branchManager)).status).toBe(400);
      expect((await post(branchManager, { locationId: branchB })).status).toBe(404);
      const ok = await post(branchManager, { locationId: shop.locationId });
      expect(ok.status).toBe(201);
      expect(ok.body.location).toMatchObject({ id: shop.locationId });
    });

    it('ten a day', async () => {
      for (let i = 0; i < 10; i += 1) await seed(shop);
      const res = await post(owner);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/10 stories in a day/);
    });
  });

  // ------------------------------------------------------------------
  describe('what customers see', () => {
    it('live stories of live shops, a shop at a time, each saying where to book', async () => {
      const whole = await seed(shop);
      const branch = await seed(shop, { locationId: branchB });
      await seed(shop, { expiresAt: new Date(Date.now() - HOUR) });
      await seed(hidden);

      const feed = await request(url, '/stories');
      const shops = feed.body.shops as Array<{
        business: { id: string };
        stories: Array<{ id: string; bookAt: { id: string } }>;
      }>;

      expect(shops.map((s) => s.business.id)).toEqual([shop.businessId]);
      expect(shops[0].stories.map((s) => s.id)).toEqual([whole.id, branch.id]);
      expect(shops[0].stories[0].bookAt.id).toBe(shop.locationId);
      expect(shops[0].stories[1].bookAt.id).toBe(branchB);
    });

    it('is open to anyone, and counts a view', async () => {
      const story = await seed(shop);
      expect((await request(url, `/stories/${story.id}/view`, { method: 'POST' })).status).toBe(200);
      await request(url, `/stories/${story.id}/view`, { method: 'POST' });
      expect((await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).views).toBe(2);
    });

    it('a signed-in customer can report one, once', async () => {
      const story = await seed(shop);
      const body = { reason: 'Not appropriate' };

      expect((await request(url, `/stories/${story.id}/report`, { method: 'POST', body })).status).toBe(401);
      expect(
        (await request(url, `/stories/${story.id}/report`, { method: 'POST', token: customer, body })).status,
      ).toBe(200);
      await request(url, `/stories/${story.id}/report`, { method: 'POST', token: customer, body: { reason: 'Spam' } });

      expect(await prisma.storyReport.count({ where: { storyId: story.id } })).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  describe('taking one down', () => {
    it('an administrator sees the reported ones and takes one down; the shop is told why', async () => {
      const story = await seed(shop);
      await request(url, `/stories/${story.id}/report`, {
        method: 'POST',
        token: customer,
        body: { reason: 'Misleading' },
      });

      const reported = await request(url, '/admin/stories?view=reported', { token: admin });
      expect(reported.body.reported).toBe(1);
      expect((reported.body.stories as Array<{ id: string; reportCount: number }>)[0]).toMatchObject({
        id: story.id,
        reportCount: 1,
      });

      const removed = await request(url, `/admin/stories/${story.id}/remove`, {
        method: 'POST',
        token: admin,
        body: { reason: 'The photo is not of the shop.' },
      });
      expect(removed.status).toBe(200);

      const feed = await request(url, '/stories');
      expect(feed.body.shops).toEqual([]);
      const mine = await request(url, '/business/stories', { token: owner });
      expect((mine.body.stories as Array<{ removedReason: string }>)[0].removedReason).toBe(
        'The photo is not of the shop.',
      );
      expect(
        await prisma.notification.count({ where: { recipientId: shop.userId, type: NotificationType.STORY_REMOVED } }),
      ).toBe(1);
    });

    it('an administrator who finds it fine keeps it up, and it leaves the queue', async () => {
      const story = await seed(shop);
      const ended = await seed(shop, { expiresAt: new Date(Date.now() - HOUR) });
      for (const s of [story, ended]) {
        await request(url, `/stories/${s.id}/report`, { method: 'POST', token: customer, body: { reason: 'Spam' } });
      }

      // Only the one still up is waiting for a decision.
      const before = await request(url, '/admin/stories?view=reported', { token: admin });
      expect(before.body.reported).toBe(1);

      const kept = await request(url, `/admin/stories/${story.id}/keep`, { method: 'POST', token: admin });
      expect(kept.status).toBe(200);

      const after = await request(url, '/admin/stories?view=reported', { token: admin });
      expect(after.body.reported).toBe(0);
      expect((await request(url, '/stories')).body.shops).toHaveLength(1);
      expect((await request(url, `/admin/stories/${story.id}/keep`, { method: 'POST', token: customer })).status).toBe(
        403,
      );
    });

    it('the shop takes its own down early; a manager of some branches only theirs', async () => {
      const whole = await seed(shop);
      expect(
        (await request(url, `/business/stories/${whole.id}`, { method: 'DELETE', token: branchManager })).status,
      ).toBe(403);
      expect((await request(url, `/business/stories/${whole.id}`, { method: 'DELETE', token: owner })).status).toBe(
        200,
      );
      expect(await prisma.story.count({ where: { id: whole.id } })).toBe(0);
    });

    it('a few days after they end, stories are cleared', async () => {
      const old = await seed(shop, {
        createdAt: new Date(Date.now() - 5 * 24 * HOUR),
        expiresAt: new Date(Date.now() - 4 * 24 * HOUR),
      });
      const recent = await seed(shop, { expiresAt: new Date(Date.now() - HOUR) });

      await ctx.app.get(StoriesService).clearOld();

      expect(await prisma.story.count({ where: { id: old.id } })).toBe(0);
      expect(await prisma.story.count({ where: { id: recent.id } })).toBe(1);
    });
  });
});
