import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { BusinessDocumentKind as K, BusinessDocumentStatus as S, BusinessStatus, NotificationType } from '@prisma/client';
import { BusinessAccessService } from '../src/business/business-access.service';
import { DocumentsService } from '../src/business/documents.service';
import { isRegistered, requiredPapers } from '../src/business/document-rules';
import { RWANDA } from '../src/countries/packs/rwanda';
import { canSubmit, goLiveGaps, readinessItems, READINESS_SELECT } from '../src/business/readiness';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { RatesService } from '../src/today/rates.service';
import { TodayService } from '../src/today/today.service';
import { WeatherService } from '../src/today/weather.service';
import { MomoHealthService } from '../src/payments/momo-health.service';
import { asUser, createAdmin, createBusiness } from './setup/factories';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 10);

/** A small PDF, as multer hands a file to the route. */
const pdf = (name = 'paper.pdf'): Express.Multer.File =>
  ({ buffer: Buffer.from('%PDF-1.4\n%fake\n'), mimetype: 'application/pdf', originalname: name, size: 15 }) as never;

/**
 * Business papers (§314): what a kind of shop must hold, uploading and
 * replacing, our team's check, the mark customers see, and the reminders.
 */
describe('Business papers (§314)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let documents: DocumentsService;
  let storage: StorageService;
  let notifications: { notify: jest.Mock; notifyBusiness: jest.Mock };
  let admin: { userId: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessAccessService,
      DiscoveryService,
      FavouritesService,
      TodayService,
      WeatherService,
      RatesService,
      DocumentsService,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    documents = moduleRef.get(DocumentsService);
    storage = moduleRef.get(StorageService);
    notifications = moduleRef.get(NotificationsService) as never;
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
  });

  afterAll(async () => {
    // The files on local disk go with the rows.
    const rows = await prisma.businessDocument.findMany({ select: { fileKey: true } });
    await Promise.all(rows.map((r) => storage.removePrivate(r.fileKey)));
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => {
    notifications.notify.mockClear();
    notifications.notifyBusiness.mockClear();
  });

  /** The taxonomy as the seed writes it (§266) — read from the file, which runs itself when imported. */
  const seeded = (() => {
    const text = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');
    const out: Record<string, string[]> = {};
    for (const match of text.matchAll(/name: '([^']+)',\s*icon:[\s\S]*?subcategories: \[([\s\S]*?)\]/g)) {
      out[match[1]] = [...match[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
    }
    return out;
  })();

  /** Gives a shop a kind, by the seed's names — made here, since a test database starts with none. */
  const kind = async (businessId: string, category: string, subcategory: string) => {
    const cat =
      (await prisma.category.findFirst({ where: { name: category }, select: { id: true } })) ??
      (await prisma.category.create({ data: { name: category }, select: { id: true } }));
    const sub =
      (await prisma.subcategory.findFirst({ where: { name: subcategory, categoryId: cat.id }, select: { id: true } })) ??
      (await prisma.subcategory.create({ data: { name: subcategory, categoryId: cat.id }, select: { id: true } }));
    await prisma.businessKind.create({ data: { businessId, categoryId: cat.id, subcategoryId: sub.id, position: 0 } });
    await prisma.businessProfile.update({ where: { id: businessId }, data: { categoryId: cat.id, subcategoryId: sub.id } });
  };

  const readiness = (businessId: string) =>
    prisma.businessProfile.findUniqueOrThrow({ where: { id: businessId }, select: READINESS_SELECT });

  describe('the rules', () => {
    it('name only categories and types the seed has', () => {
      expect(Object.keys(seeded)).toHaveLength(16);
      for (const entry of RWANDA.papers.rules) {
        expect(seeded[entry.category]).toBeDefined();
        for (const type of entry.types ?? []) expect(seeded[entry.category]).toContain(type);
      }
    });

    it('ask a licence of a clinic, a tour operator and a lawyer — nothing of a barber', () => {
      const of = (category: string, subcategory: string) => requiredPapers('RW', [{ category: { name: category }, subcategory: { name: subcategory } }]);
      expect(of('Health & Medical', 'Dental').map((r) => r.key)).toEqual(['health']);
      expect(of('Tours & Experiences', 'City & Cultural Tours').map((r) => r.key)).toEqual(['tourism']);
      expect(of('Services', 'Legal Consultation').map((r) => r.key)).toEqual(['legal']);
      expect(of('Beauty & Spa', 'Barbershop')).toEqual([]);
      expect(of('Wellness', 'Meditation & Yoga')).toEqual([]);
      // Two kinds under the same rule: asked once.
      expect(
        requiredPapers('RW', [
          { category: { name: 'Health & Medical' }, subcategory: { name: 'Dental' } },
          { category: { name: 'Wellness' }, subcategory: { name: 'Physiotherapy & Rehab' } },
        ]).map((r) => r.key),
      ).toEqual(['health']);
    });
  });

  describe('a licensed trade', () => {
    it('cannot be sent for review without its licence, nor approved until our team checked it', async () => {
      const clinic = await createBusiness(prisma, { status: BusinessStatus.PENDING });
      await prisma.businessProfile.update({ where: { id: clinic.businessId }, data: { submittedAt: null } });
      await kind(clinic.businessId, 'Health & Medical', 'General Clinic');

      let shop = await readiness(clinic.businessId);
      const stillNeeded = () => readinessItems(shop).filter((i) => i.required && !i.done).map((i) => i.key);
      expect(readinessItems(shop).find((i) => i.key === 'papers')).toMatchObject({ required: true, done: false });
      expect(stillNeeded()).toContain('papers');
      expect(canSubmit(shop)).toBe(false);

      const doc = await documents.upload(clinic.businessId, clinic.userId, { kind: K.HEALTH_FACILITY_LICENCE, number: 'MOH/2026/0042' }, pdf());
      expect(doc.status).toBe(S.SUBMITTED);
      shop = await readiness(clinic.businessId);
      expect(readinessItems(shop).find((i) => i.key === 'papers')?.done).toBe(true);
      expect(stillNeeded()).not.toContain('papers');
      // The test shop has no phone or pin; what is left to send it for review is theirs, not the paper.
      expect(canSubmit({ ...shop, phone: shop.phone ?? '0788', locations: shop.locations.map((l) => ({ ...l, districtId: l.districtId ?? 'd', latitude: l.latitude ?? 1, longitude: l.longitude ?? 1 })) })).toBe(true);
      // Uploaded is not checked: approval still waits.
      expect(goLiveGaps(shop)).toContain('papers');

      await documents.verify(asUser(admin.userId, 'ADMIN'), clinic.businessId, doc.id);
      shop = await readiness(clinic.businessId);
      expect(goLiveGaps(shop)).not.toContain('papers');
      expect(notifications.notifyBusiness).toHaveBeenCalledWith(expect.objectContaining({ type: NotificationType.BUSINESS_DOCUMENT_VERIFIED }));
    });

    it('a barber needs no paper, and its checklist only invites one', async () => {
      const barber = await createBusiness(prisma, { status: BusinessStatus.PENDING });
      await kind(barber.businessId, 'Beauty & Spa', 'Barbershop');
      const shop = await readiness(barber.businessId);
      expect(readinessItems(shop).find((i) => i.key === 'papers')).toMatchObject({ required: false, done: false });
      expect(goLiveGaps(shop)).not.toContain('papers');
    });
  });

  describe('uploading', () => {
    it('replaces the previous paper of the same kind, keeps "another paper" several, and needs a name for it', async () => {
      const shop = await createBusiness(prisma);
      const first = await documents.upload(shop.businessId, shop.userId, { kind: K.TRADING_LICENCE, expiresAt: ymd(200 * DAY) }, pdf('old.pdf'));
      const second = await documents.upload(shop.businessId, shop.userId, { kind: K.TRADING_LICENCE, expiresAt: ymd(500 * DAY) }, pdf('new.pdf'));
      expect((await prisma.businessDocument.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(S.REPLACED);
      const listed = await documents.list(shop.businessId);
      expect(listed.documents.map((d) => d.id)).toEqual([second.id]);

      await expect(documents.upload(shop.businessId, shop.userId, { kind: K.OTHER }, pdf())).rejects.toBeInstanceOf(BadRequestException);
      await documents.upload(shop.businessId, shop.userId, { kind: K.OTHER, label: 'District permit' }, pdf());
      await documents.upload(shop.businessId, shop.userId, { kind: K.OTHER, label: 'Fire certificate' }, pdf());
      expect((await documents.list(shop.businessId)).documents.filter((d) => d.kind === K.OTHER)).toHaveLength(2);

      // Nothing without a file; nothing already run out.
      await expect(documents.upload(shop.businessId, shop.userId, { kind: K.RDB_CERTIFICATE }, undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        documents.upload(shop.businessId, shop.userId, { kind: K.RDB_CERTIFICATE, expiresAt: ymd(-DAY) }, pdf()),
      ).rejects.toThrow(/already run out/);
    });

    it('tells our team when a shop in front of them uploads, not one still setting up', async () => {
      const settingUp = await createBusiness(prisma, { status: BusinessStatus.PENDING });
      await prisma.businessProfile.update({ where: { id: settingUp.businessId }, data: { submittedAt: null } });
      await documents.upload(settingUp.businessId, settingUp.userId, { kind: K.RDB_CERTIFICATE }, pdf());
      expect(notifications.notify).not.toHaveBeenCalled();

      const live = await createBusiness(prisma);
      await documents.upload(live.businessId, live.userId, { kind: K.RDB_CERTIFICATE }, pdf());
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: admin.userId, type: NotificationType.BUSINESS_DOCUMENT_SUBMITTED, link: `/businesses?status=ALL&open=${live.businessId}` }),
      );
    });

    it('keeps the file private: the shop reads its own, another shop finds nothing', async () => {
      const shop = await createBusiness(prisma);
      const other = await createBusiness(prisma);
      const doc = await documents.upload(shop.businessId, shop.userId, { kind: K.TIN_CERTIFICATE }, pdf('tin.pdf'));
      const file = await documents.file(shop.businessId, doc.id);
      expect(file.mimeType).toBe('application/pdf');
      expect(file.fileName).toBe('tin.pdf');
      expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
      await expect(documents.file(other.businessId, doc.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(documents.remove(other.businessId, doc.id)).rejects.toBeInstanceOf(NotFoundException);
      // The row never carries where the file is.
      expect(doc).not.toHaveProperty('fileKey');
    });
  });

  describe('our team', () => {
    it('refuses with a reason the shop is told, and a checked paper stays until replaced', async () => {
      const shop = await createBusiness(prisma);
      const blurry = await documents.upload(shop.businessId, shop.userId, { kind: K.RDB_CERTIFICATE }, pdf());
      const refused = await documents.refuse(asUser(admin.userId, 'ADMIN'), shop.businessId, blurry.id, 'The photo is too blurry to read the company code.');
      expect(refused).toMatchObject({ status: S.REFUSED, refusalReason: 'The photo is too blurry to read the company code.' });
      expect(notifications.notifyBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.BUSINESS_DOCUMENT_REFUSED, context: expect.objectContaining({ reason: 'The photo is too blurry to read the company code.' }) }),
      );
      // Decided once.
      await expect(documents.verify(asUser(admin.userId, 'ADMIN'), shop.businessId, blurry.id)).rejects.toBeInstanceOf(BadRequestException);
      // The shop may take a refused one back …
      await documents.remove(shop.businessId, blurry.id);

      // … but not a checked one.
      const clear = await documents.upload(shop.businessId, shop.userId, { kind: K.RDB_CERTIFICATE, number: '102345678' }, pdf());
      await documents.verify(asUser(admin.userId, 'ADMIN'), shop.businessId, clear.id);
      await expect(documents.remove(shop.businessId, clear.id)).rejects.toThrow(/has been checked/);
      // Nobody but an administrator decides.
      await expect(documents.verify(asUser(shop.userId, 'BUSINESS'), shop.businessId, clear.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a checked registration earns the mark customers see; a refused or run-out one does not', async () => {
      const shop = await createBusiness(prisma);
      const discovery = moduleRef.get(DiscoveryService);
      expect((await discovery.findOne(shop.locationId)).business.registeredBusiness).toBe(false);

      const cert = await documents.upload(shop.businessId, shop.userId, { kind: K.RDB_CERTIFICATE }, pdf());
      expect((await documents.list(shop.businessId)).registered).toBe(false);
      await documents.verify(asUser(admin.userId, 'ADMIN'), shop.businessId, cert.id);
      expect((await documents.list(shop.businessId)).registered).toBe(true);
      expect((await discovery.findOne(shop.locationId)).business.registeredBusiness).toBe(true);

      // Run out: the mark goes.
      await prisma.businessDocument.update({ where: { id: cert.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
      expect((await discovery.findOne(shop.locationId)).business.registeredBusiness).toBe(false);
      expect(isRegistered('RW', [{ kind: K.TRADING_LICENCE, status: S.REFUSED, expiresAt: null }])).toBe(false);
    });
  });

  describe('running out', () => {
    it('reminds a month before, once, and again once it has run out', async () => {
      // Only this shop's papers: the earlier tests left some running out too.
      await Promise.all((await prisma.businessDocument.findMany({ select: { fileKey: true } })).map((r) => storage.removePrivate(r.fileKey)));
      await prisma.businessDocument.deleteMany({});
      const shop = await createBusiness(prisma);
      const licence = await documents.upload(shop.businessId, shop.userId, { kind: K.TRADING_LICENCE, expiresAt: ymd(10 * DAY) }, pdf());
      await documents.verify(asUser(admin.userId, 'ADMIN'), shop.businessId, licence.id);
      notifications.notifyBusiness.mockClear();

      expect(await documents.expiryReminders()).toBe(1);
      expect(notifications.notifyBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.BUSINESS_DOCUMENT_EXPIRING, context: expect.objectContaining({ document: expect.objectContaining({ expired: false }) }) }),
      );
      expect(await documents.expiryReminders()).toBe(0);

      await prisma.businessDocument.update({ where: { id: licence.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
      expect(await documents.expiryReminders()).toBe(1);
      expect(notifications.notifyBusiness).toHaveBeenLastCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ document: expect.objectContaining({ expired: true }) }) }),
      );
      expect(await documents.expiryReminders()).toBe(0);

      // And the For you card says so (§310, §314).
      const today = moduleRef.get(TodayService);
      const card = (await today.forShop(shop.userId, 'en')).items.find((i) => i.kind === 'papers');
      expect(card).toMatchObject({ state: 'expired', paper: K.TRADING_LICENCE });
    });
  });
});
