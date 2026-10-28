import { BusinessStatus, NotificationType, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { ApproveBusinessDto } from '../src/business/dto/approve-business.dto';
import { ADVICE_LEAD, adviceItems, adviceToSend } from '../src/business/shop-advice';
import { NotificationsService } from '../src/notifications/notifications.service';
import { noticeEmail } from '../src/notifications/notification-email';
import { renderNotification, type AppointmentContext } from '../src/notifications/notification-templates';
import { renderEmail } from '../src/mail/email-kit';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, notificationsStub, resetDatabase } from './setup/test-module';
import { createAdmin, createBusiness } from './setup/factories';

/**
 * §303. An approval can carry advice: of the things that would make the shop
 * easier to book, the ones still missing that the reviewer chose, and a note
 * in their own words — sent with the approval and kept for the dashboard.
 */
describe('Advice sent with an approval (§303)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let profiles: BusinessProfileService;
  let moderation: BusinessModerationService;
  let notifications: ReturnType<typeof notificationsStub>;
  let admin: { userId: string; email: string };

  const AS_ADMIN = () => ({ userId: admin.userId, role: UserRole.ADMIN });

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessProfileService,
      BusinessModerationService,
      { provide: StorageService, useValue: {} },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    profiles = moduleRef.get(BusinessProfileService);
    moderation = moduleRef.get(BusinessModerationService);
    notifications = moduleRef.get(NotificationsService) as never;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    notifications.notifyBusiness.mockClear();
  });

  /** A shop that can go live, and nothing more: no cover, logo, words, photos or pin. */
  const waiting = () => createBusiness(prisma, { status: BusinessStatus.PENDING });

  const sentContext = () => {
    const call = notifications.notifyBusiness.mock.calls.find(
      ([params]) => (params as { type: NotificationType }).type === NotificationType.BUSINESS_APPROVED,
    );
    return (call?.[0] as { context: AppointmentContext } | undefined)?.context;
  };
  const sentAdvice = () => sentContext()?.advice;

  it('lists what a bare shop is missing, in the words the shop reads', async () => {
    const shop = await waiting();
    const { advice } = await profiles.readiness(shop.businessId);
    const missing = advice.filter((item) => !item.done);

    expect(missing.map((item) => item.key)).toEqual([
      'cover',
      'logo',
      'about',
      'type',
      'phone',
      'gallery',
      'where',
      'service-photos',
      'service-words',
      'papers',
    ]);
    expect(missing.find((item) => item.key === 'gallery')?.title).toBe('Photos of Test Branch');
    expect(missing.find((item) => item.key === 'service-words')?.title).toBe('A description on 1 service');
    // It has hours and a payout number.
    expect(advice.filter((item) => item.done).map((item) => item.key)).toEqual(['hours', 'payout']);
  });

  it('counts a few real lines, photos at the branch and on services as done', async () => {
    const shop = await waiting();
    await prisma.businessProfile.update({
      where: { id: shop.businessId },
      data: { coverImageUrl: 'https://x/cover.jpg', description: 'Short.' },
    });
    await prisma.locationMedia.create({ data: { locationId: shop.locationId, url: 'https://x/1.jpg' } });
    await prisma.serviceMedia.create({ data: { serviceId: shop.serviceId, url: 'https://x/s.jpg' } });

    const { advice } = await profiles.readiness(shop.businessId);
    const done = (key: string) => advice.find((item) => item.key === key)?.done;
    expect(done('cover')).toBe(true);
    expect(done('about')).toBe(false); // "Short." is not a few lines
    expect(done('gallery')).toBe(true);
    expect(done('service-photos')).toBe(true);
    expect(advice.find((item) => item.key === 'gallery')?.title).toBe('Photos of every branch');
  });

  it('sends the chosen things still missing, and the note, with the approval — and keeps them on the shop', async () => {
    const shop = await waiting();
    await moderation.approve(AS_ADMIN(), shop.businessId, {
      // "payout" is done already, so it is dropped rather than asked for.
      keys: ['cover', 'gallery', 'service-words', 'payout'],
      note: 'Lovely cuts!\n\n  A photo of the shop front would help people find you.  ',
    });

    // The shop and the items, not their words: each member's notice writes
    // them out in that member's language (§308).
    const advice = sentAdvice();
    expect(advice?.keys).toEqual(['cover', 'gallery', 'service-words']);
    const { body } = renderNotification(NotificationType.BUSINESS_APPROVED, {
      ...sentContext()!,
      timeZone: 'Africa/Kigali',
      audience: 'BUSINESS',
    });
    const lines = body.split('\n').filter((line) => line.startsWith('• '));
    expect(lines.map((line) => line.slice(2).split(' — ')[0])).toEqual([
      'A cover photo',
      'Photos of Test Branch',
      'A description on 1 service',
    ]);
    // One paragraph, tidied, so the notice keeps it whole.
    expect(advice?.note).toBe('Lovely cuts!\nA photo of the shop front would help people find you.');

    const readiness = await profiles.readiness(shop.businessId);
    expect(readiness.status).toBe(BusinessStatus.APPROVED);
    expect(readiness.approvalAdvice?.keys).toEqual(['cover', 'gallery', 'service-words']);
    expect(readiness.approvalAdvice?.note).toContain('shop front');
    expect(readiness.approvalAdvice?.at).toBeTruthy();
  });

  it('approves plainly without advice, and a later plain approval clears an old one', async () => {
    const shop = await waiting();
    await moderation.approve(AS_ADMIN(), shop.businessId);
    expect(sentAdvice()).toBeUndefined();
    expect((await profiles.readiness(shop.businessId)).approvalAdvice).toBeNull();

    // Suspended, then reinstated: reinstating sends no advice and keeps what was said.
    const other = await waiting();
    await moderation.approve(AS_ADMIN(), other.businessId, { keys: ['logo'] });
    await moderation.suspend(AS_ADMIN(), other.businessId, 'Checking a complaint.');
    notifications.notifyBusiness.mockClear();
    await moderation.reinstate(AS_ADMIN(), other.businessId);
    expect(sentAdvice()).toBeUndefined();
    expect((await profiles.readiness(other.businessId)).approvalAdvice?.keys).toEqual(['logo']);
  });

  it('keeps only items still missing, in the checklist order, and a blank note is no note', () => {
    const items = adviceItems({
      coverImageUrl: null,
      logoUrl: 'https://x/logo.png',
      description: null,
      phone: '0788',
      subcategoryId: 'x',
      locations: [],
      services: [],
      payoutDestinations: [],
        documents: [],
    });
    const sent = adviceToSend(items, ['payout', 'logo', 'cover', 'nonsense'], '   ');
    expect(sent.items.map((item) => item.key)).toEqual(['cover', 'payout']);
    expect(sent.note).toBeNull();
  });

  it('refuses an unknown item or a note too long to be advice', async () => {
    const check = (body: object) => validate(plainToInstance(ApproveBusinessDto, body));
    expect(await check({})).toHaveLength(0);
    expect(await check({ advice: ['cover', 'gallery'], note: 'Well done.' })).toHaveLength(0);
    expect(await check({ advice: ['cover', 'confetti'] })).not.toHaveLength(0);
    expect(await check({ advice: ['cover', 'cover'] })).not.toHaveLength(0);
    expect(await check({ note: 'x'.repeat(601) })).not.toHaveLength(0);
  });

  it('writes the advice into the approval, and the email draws it as a checklist with the note last', () => {
    const { subject, body } = renderNotification(NotificationType.BUSINESS_APPROVED, {
      serviceName: 'Account status',
      locationName: 'your business',
      businessName: 'your business',
      startTime: undefined as unknown as Date,
      timeZone: 'Africa/Kigali',
      audience: 'BUSINESS',
      advice: {
        shop: {
          coverImageUrl: null,
          logoUrl: null,
          description: null,
          phone: null,
          subcategoryId: null,
          locations: [],
          // Two services on sale with no photo.
          services: [
            { description: 'Wash and cut.', _count: { images: 0 }, locations: [{}] },
            { description: 'Beard trim.', _count: { images: 0 }, locations: [{}] },
          ],
          payoutDestinations: [],
        documents: [],
        },
        keys: ['cover', 'service-photos'],
        note: 'Lovely cuts — add a photo of the shop front.',
      },
    });
    expect(body).toContain(ADVICE_LEAD);
    expect(body).toContain('• A cover photo — the first thing customers see on your page.');
    expect(body.trim().endsWith('“Lovely cuts — add a photo of the shop front.”')).toBe(true);

    const { email } = noticeEmail({
      type: NotificationType.BUSINESS_APPROVED,
      audience: 'BUSINESS',
      subject,
      body,
      button: { label: 'Open your dashboard', url: 'http://localhost:5174/' },
      footer: { reason: 'You always get emails about your shop.', manage: { label: 'Change what we send' } },
      booking: null,
      arrivalCode: null,
      author: null,
      timeZone: 'Africa/Kigali',
    });
    const { html, text } = renderEmail(email, { assetBase: 'http://localhost:4100', subject });
    expect(text).toContain('[ ] A cover photo — the first thing customers see on your page');
    expect(text).toContain('[ ] Photos on 2 services');
    // The note closes it, after the list, and says who it is from.
    expect(text.indexOf('Lovely cuts')).toBeGreaterThan(text.indexOf('Photos on 2 services'));
    expect(text).toContain('— Our review team');
    expect(html).not.toContain('• ');
  });
});
