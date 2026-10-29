import { AnnouncementAudience, AnnouncementKind, AnnouncementStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AnnouncementsService } from '../src/announcements/announcements.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { MomoHealthService } from '../src/payments/momo-health.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RatesService } from '../src/today/rates.service';
import {
  easter,
  holidayOn,
  holidays,
  kwibuka,
  nextHoliday,
  nextUmuganda,
  umugandaIn,
} from '../src/today/rwanda-calendar';
import { TodayScheduler } from '../src/today/today.scheduler';
import { TodayService } from '../src/today/today.service';
import { rwandaTaxDue as taxDue } from '../src/countries/packs/rwanda';
import { WeatherService } from '../src/today/weather.service';
import { createAdmin, createBusiness } from './setup/factories';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';

/** Noon in Kigali on a calendar day. */
const kigaliNoon = (date: string) => new Date(`${date}T10:00:00.000Z`);

describe('Rwanda today (§310)', () => {
  describe('the calendar', () => {
    it('finds Easter, and the holidays that move with it', () => {
      expect(easter(2026)).toBe('2026-04-05');
      expect(easter(2027)).toBe('2027-03-28');
      const of2026 = holidays(2026);
      expect(of2026.find((h) => h.key === 'good-friday')?.date).toBe('2026-04-03');
      expect(of2026.find((h) => h.key === 'easter-monday')?.date).toBe('2026-04-06');
    });

    it('puts Umuganura on the first Friday of August and Umuganda on the last Saturday of the month', () => {
      expect(holidays(2026).find((h) => h.key === 'umuganura')?.date).toBe('2026-08-07');
      expect(umugandaIn(2026, 10)).toBe('2026-10-31');
      expect(umugandaIn(2026, 12)).toBe('2026-12-26');
      expect(nextUmuganda('2026-10-23')).toBe('2026-10-31');
      expect(nextUmuganda('2026-11-01')).toBe('2026-11-28');
    });

    it('knows the fixed holidays, the next one coming, and the week of Kwibuka', () => {
      expect(holidayOn('2026-07-04')?.key).toBe('liberation');
      expect(holidayOn('2026-12-26')?.key).toBe('boxing');
      expect(holidayOn('2026-10-23')).toBeNull();
      expect(nextHoliday('2026-12-20', 7)?.key).toBe('christmas');
      expect(nextHoliday('2026-12-28', 7)?.date).toBe('2027-01-01');
      expect(kwibuka('2026-04-09')).toEqual({ number: 32, from: '2026-04-07', to: '2026-04-13' });
      expect(kwibuka('2026-04-14')).toBeNull();
    });

    it('reminds of tax dates only in their weeks', () => {
      expect(taxDue('2026-10-10')).toEqual({ tax: 'vat-paye', date: '2026-10-15' });
      expect(taxDue('2026-10-16')).toBeNull();
      expect(taxDue('2026-01-20')).toEqual({ tax: 'licence', date: '2026-01-31' });
      expect(taxDue('2026-03-20')).toEqual({ tax: 'annual', date: '2026-03-31' });
    });
  });

  describe("mobile money's health", () => {
    it('is down when MoMo does not answer, slow when deposits mostly fail, ok otherwise', () => {
      const momo = new MomoHealthService();
      const t = Date.now();
      expect(momo.state(t)).toBe('ok');
      ['unreachable', 'unreachable', 'unreachable', 'started'].forEach((e) => momo.record(e as never, t));
      expect(momo.state(t)).toBe('down');

      const slow = new MomoHealthService();
      ['paid', 'failed', 'failed', 'expired', 'failed'].forEach((e) => slow.record(e as never, t));
      expect(slow.state(t)).toBe('slow');
      // Twenty minutes later it has forgotten.
      expect(slow.state(t + 21 * 60_000)).toBe('ok');

      const fine = new MomoHealthService();
      ['paid', 'paid', 'paid', 'failed', 'paid'].forEach((e) => fine.record(e as never, t));
      expect(fine.state(t)).toBe('ok');
    });
  });

  describe("a shop's today", () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let today: TodayService;
    let discovery: DiscoveryService;
    let momo: MomoHealthService;

    beforeAll(async () => {
      moduleRef = await createTestModule([
        TodayService,
        TodayScheduler,
        BusinessAccessService,
        WeatherService,
        RatesService,
        DiscoveryService,
        FavouritesService,
        PlatformSettingsService,
        AnnouncementsService,
        commonStubs.notifications(),
      ]);
      prisma = moduleRef.get(PrismaService);
      today = moduleRef.get(TodayService);
      discovery = moduleRef.get(DiscoveryService);
      momo = moduleRef.get(MomoHealthService);
    });
    beforeEach(() => resetDatabase(prisma));
    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    it('asks to block Umuganda morning for a branch open then, and stops once it is blocked', async () => {
      const shop = await createBusiness(prisma);
      const before = await today.forShop(shop.userId, 'en', kigaliNoon('2026-10-28'));
      const card = before.items.find((i) => i.kind === 'umuganda');
      expect(card).toMatchObject({ date: '2026-10-31', branches: [{ id: shop.locationId, covered: false }] });

      await prisma.locationTimeBlock.create({
        data: { locationId: shop.locationId, date: new Date('2026-10-31T00:00:00.000Z'), startTime: '08:00', endTime: '11:00' },
      });
      const after = await today.forShop(shop.userId, 'en', kigaliNoon('2026-10-28'));
      expect(after.items.find((i) => i.kind === 'umuganda')).toBeUndefined();
      // Too early: nothing a week ahead of it.
      const early = await today.forShop(shop.userId, 'en', kigaliNoon('2026-10-20'));
      expect(early.items.find((i) => i.kind === 'umuganda')).toBeUndefined();
    });

    it('asks about a holiday in the week ahead until the day is set, and keeps quiet during Kwibuka', async () => {
      const shop = await createBusiness(prisma);
      const ahead = await today.forShop(shop.userId, 'en', kigaliNoon('2026-12-21'));
      expect(ahead.items.find((i) => i.kind === 'holiday')).toMatchObject({ holiday: 'christmas', date: '2026-12-25' });
      await prisma.locationScheduleException.create({
        data: { locationId: shop.locationId, date: new Date('2026-12-25T00:00:00.000Z'), isClosed: true },
      });
      const set = await today.forShop(shop.userId, 'en', kigaliNoon('2026-12-21'));
      expect(set.items.find((i) => i.kind === 'holiday' && i.holiday === 'christmas')).toBeUndefined();

      const april = await today.forShop(shop.userId, 'en', kigaliNoon('2026-04-08'));
      expect(april.calm).toBe(true);
      expect(april.items[0]).toMatchObject({ kind: 'kwibuka', number: 32 });
    });

    it('says what customers near it searched for — the finished word, a pattern only, not its own name', async () => {
      const shop = await createBusiness(prisma);
      const district = await prisma.district.findFirstOrThrow({ select: { id: true, name: true } });
      await prisma.location.update({ where: { id: shop.locationId }, data: { districtId: district.id } });
      const at = kigaliNoon('2026-10-23');
      const searches = (term: string, n: number) =>
        prisma.searchQuery.createMany({ data: Array.from({ length: n }, () => ({ term, districtId: district.id, results: 0, createdAt: at })) });
      await searches('bra', 9);
      await searches('braids', 6);
      await searches('test salon', 12);
      await searches('manicure', 3);

      const result = await today.forShop(shop.userId, 'en', new Date(at.getTime() + 3_600_000));
      expect(result.items.find((i) => i.kind === 'searches')).toEqual({
        kind: 'searches',
        term: 'braids',
        count: 6,
        district: district.name,
        offered: false,
      });
    });

    it('writes down a search as words and a count — only the first page, never who', async () => {
      await createBusiness(prisma);
      await discovery.search({ q: '  Braids ', limit: 20, offset: 0 } as never);
      await discovery.search({ q: 'braids', limit: 20, offset: 20 } as never);
      await discovery.search({ q: 'a', limit: 20, offset: 0 } as never);
      await new Promise((r) => setTimeout(r, 200));
      const rows = await prisma.searchQuery.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ term: 'braids', results: 0, districtId: null });
      expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'districtId', 'id', 'results', 'term']);

      // Kept 90 days.
      await prisma.searchQuery.update({ where: { id: rows[0].id }, data: { createdAt: new Date(Date.now() - 91 * 86_400_000) } });
      expect(await moduleRef.get(TodayScheduler).forgetOldSearches()).toBe(1);
    });

    it('puts slow mobile money first, and shows our team’s news in the reader’s language', async () => {
      const shop = await createBusiness(prisma);
      ['unreachable', 'unreachable', 'unreachable'].forEach((e) => momo.record(e as never));
      await prisma.announcement.create({
        data: {
          kind: AnnouncementKind.SERVICE,
          audience: AnnouncementAudience.SELLERS,
          title: 'New fuel prices',
          body: 'RURA set new prices from 1 November.',
          translations: { fr: { title: 'Nouveaux prix du carburant', body: 'La RURA a fixé de nouveaux prix.' } },
          status: AnnouncementStatus.SENT,
          sentAt: new Date(),
          forYouUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const result = await today.forShop(shop.userId, 'fr');
      expect(result.items[0]).toEqual({ kind: 'momo', momo: 'down' });
      expect(result.items.find((i) => i.kind === 'news')).toMatchObject({ title: 'Nouveaux prix du carburant' });
      expect((await today.publicToday(undefined)).momo).toBe('down');
      expect(await today.publicToday('2026-10-31')).toMatchObject({ umuganda: true, holiday: null });
      expect(await today.publicToday('2026-12-25')).toMatchObject({ umuganda: false, holiday: 'christmas' });
    });

    it('keeps an announcement’s For you date only for audiences shops are in', async () => {
      const admin = await createAdmin(prisma);
      const announcements = moduleRef.get(AnnouncementsService);
      const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const base = { kind: AnnouncementKind.SERVICE, title: 'New fuel prices', body: 'From 1 November.', sendPush: false, sendEmail: false, banner: false, forYouUntil: until };
      const sellers = await announcements.create(admin.userId, { ...base, audience: AnnouncementAudience.SELLERS } as never);
      expect(sellers.forYouUntil).toBe(until);
      const customers = await announcements.create(admin.userId, { ...base, audience: AnnouncementAudience.CUSTOMERS } as never);
      expect(customers.forYouUntil).toBeNull();
    });
  });
});
