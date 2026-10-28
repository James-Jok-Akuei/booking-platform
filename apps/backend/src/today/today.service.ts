import { Injectable } from '@nestjs/common';
import { AnnouncementAudience, AnnouncementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessAccessService } from '../business/business-access.service';
import { mayReadMoney } from '../business/branch-scope';
import { KINDS_SELECT } from '../business/kinds';
import { BusinessDocumentStatus, BusinessMemberRole } from '@prisma/client';
import { EXPIRY_WARNING_DAYS, requiredPapers, ruleState } from '../business/document-rules';
import { fold } from '../categories/taxonomy-names.service';
import { readTyped, typedIn } from '../i18n/typed-words';
import type { Locale } from '../i18n/locales';
import { MomoHealthService } from '../payments/momo-health.service';
import { RATE_CODES, RatesService } from './rates.service';
import { WeatherService } from './weather.service';
import { UMUGANDA_HOURS, addDays, holidayOn, kigaliToday, kwibuka, nextHoliday, nextUmuganda, umugandaIn, weekday } from './rwanda-calendar';
import type { PublicTodayDto, TodayBranchDto, TodayDto, TodayItemDto } from './dto/today.dto';

/** Days before Umuganda and a holiday that the card starts showing. */
const UMUGANDA_AHEAD = 5;
const HOLIDAY_AHEAD = 7;
/** A term counts once enough different searches asked for it: a pattern, not one person. */
const MIN_SEARCHES = 5;
/** The shops whose day the weather changes (§310), by their category's icon word. */
const WEATHER_KINDS = new Set(['car', 'mountain', 'calendar-star']);
const NEWS_WORDS = ['title', 'body', 'linkLabel'] as const;

/**
 * "Rwanda today" for a shop's For you (§310): what changes its day — mobile
 * money slow, Umuganda or a holiday ahead while a branch would be open,
 * what customers near it searched for, heavy rain for a car wash, a tax date
 * for whoever sees the money, the rates, and what our team posted. Facts, in
 * the order they matter; the app says them in its language.
 */
@Injectable()
export class TodayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly momo: MomoHealthService,
    private readonly weather: WeatherService,
    private readonly rates: RatesService,
  ) {}

  async forShop(userId: string, locale: Locale, now = new Date()): Promise<TodayDto> {
    const membership = await this.access.requireActiveMembership(userId);
    const today = kigaliToday(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', hour12: false }).format(now));
    const shop = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: membership.businessProfileId },
      select: {
        name: true,
        kinds: KINDS_SELECT,
        services: { where: { isActive: true }, select: { name: true, title: true } },
        locations: {
          where: {
            isActive: true,
            ...(membership.scope.allLocations ? {} : { id: { in: membership.scope.locationIds } }),
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            district: { select: { id: true, name: true } },
            hours: { select: { dayOfWeek: true, openTime: true, closeTime: true, isClosed: true } },
          },
        },
      },
    });
    const items: TodayItemDto[] = [];

    const momo = this.momo.state(now.getTime());
    if (momo !== 'ok') items.push({ kind: 'momo', momo });

    const remembrance = kwibuka(today);
    if (remembrance) items.push({ kind: 'kwibuka', number: remembrance.number, until: remembrance.to });

    items.push(...(await this.news(membership.businessProfileId, shop.kinds.map((k) => k.category.id), locale, now)));

    // Umuganda, from a few days before until it ends that Saturday morning.
    const umuganda = nextUmuganda(today);
    if (addDays(umuganda, -UMUGANDA_AHEAD) <= today && (umuganda > today || hour < 11)) {
      const branches = await this.openAt(shop.locations, umuganda, UMUGANDA_HOURS.from, UMUGANDA_HOURS.to);
      if (branches.some((b) => !b.covered)) items.push({ kind: 'umuganda', date: umuganda, branches });
    }

    const holiday = nextHoliday(today, HOLIDAY_AHEAD);
    if (holiday) {
      const branches = await this.openAt(shop.locations, holiday.date, '00:00', '23:59');
      if (branches.some((b) => !b.covered)) items.push({ kind: 'holiday', date: holiday.date, holiday: holiday.key, branches });
    }

    // A paper missing, refused, run out or running out (§314) — for those who run the business.
    if (membership.role === BusinessMemberRole.OWNER || (membership.role === BusinessMemberRole.MANAGER && membership.scope.allLocations)) {
      const paper = await this.papers(membership.businessProfileId, now);
      if (paper) items.push(paper);
    }

    // Heavy rain, for the shops it changes the day of.
    const outdoors = shop.kinds.some((k) => WEATHER_KINDS.has(k.category.icon ?? ''));
    const placed = shop.locations.find((l) => l.latitude !== null && l.longitude !== null);
    if (outdoors && placed) {
      const rain = await this.weather.rainAhead(placed.latitude!, placed.longitude!, now);
      if (rain) items.push({ kind: 'rain', from: rain.from, district: placed.district?.name ?? placed.name });
    }

    const asked = await this.searched(shop, now);
    if (asked) items.push(asked);

    if (mayReadMoney(membership.role, membership.scope)) {
      const tax = taxDue(today);
      if (tax) items.push({ kind: 'tax', ...tax });
    }

    const rates = await this.rates.today(now.getTime());
    if (rates) {
      items.push({
        kind: 'rates',
        date: rates.date,
        rates: RATE_CODES.map((code) => ({ code, rwf: rates.rwf[code], change: rates.change[code] })),
        source: rates.source,
        sourceUrl: rates.sourceUrl,
      });
    }

    return { calm: Boolean(remembrance), items };
  }

  /** For the customer app: what changes booking on `date` (today when not given). */
  publicToday(date: string | undefined, now = new Date()): PublicTodayDto {
    const today = kigaliToday(now);
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
    return {
      calm: Boolean(kwibuka(today)),
      momo: this.momo.state(now.getTime()),
      date: day,
      umuganda: umugandaIn(Number(day.slice(0, 4)), Number(day.slice(5, 7))) === day,
      holiday: holidayOn(day)?.key ?? null,
    };
  }

  /**
   * The branches that would be open between `from` and `to` on `date` by
   * their usual week, and whether each is already set for it — closed that
   * day, opening at or after `to`, or with a break over the time.
   */
  private async openAt(
    locations: Array<{ id: string; name: string; hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }> }>,
    date: string,
    from: string,
    to: string,
  ): Promise<TodayBranchDto[]> {
    const day = weekday(date);
    const open = locations.filter((l) =>
      l.hours.some((h) => h.dayOfWeek === day && !h.isClosed && h.openTime < to && h.closeTime > from),
    );
    if (!open.length) return [];
    const at = new Date(`${date}T00:00:00.000Z`);
    const [exceptions, blocks] = await Promise.all([
      this.prisma.locationScheduleException.findMany({
        where: { locationId: { in: open.map((l) => l.id) }, date: at },
        select: { locationId: true, isClosed: true, customOpenTime: true },
      }),
      this.prisma.locationTimeBlock.findMany({
        where: { locationId: { in: open.map((l) => l.id) }, date: at },
        select: { locationId: true, startTime: true, endTime: true },
      }),
    ]);
    return open.map((l) => {
      const exception = exceptions.find((e) => e.locationId === l.id);
      // For a whole day (a holiday) any change set for it counts: the shop has decided.
      const wholeDay = from === '00:00';
      const covered =
        Boolean(exception && (wholeDay || exception.isClosed || (exception.customOpenTime ?? '') >= to)) ||
        blocks.some((b) => b.locationId === l.id && b.startTime <= from && b.endTime >= to);
      return { id: l.id, name: l.name, covered };
    });
  }

  /**
   * The thing customers near this shop searched for most this week — the
   * finished word, not the letters typed on the way to it — and whether the
   * shop offers it. Never a search for the shop's own name.
   */
  private async searched(
    shop: {
      name: string | null;
      services: Array<{ name: string; title: string | null }>;
      kinds: Array<{ subcategory: { name: string } }>;
      locations: Array<{ district: { id: string; name: string } | null }>;
    },
    now: Date,
  ): Promise<TodayItemDto | null> {
    const districts = new Map(shop.locations.filter((l) => l.district).map((l) => [l.district!.id, l.district!.name]));
    if (!districts.size) return null;
    const rows = await this.prisma.searchQuery.groupBy({
      by: ['term', 'districtId'],
      where: { districtId: { in: [...districts.keys()] }, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      _count: { _all: true },
    });
    // A shop with no name yet has no name to be searched for.
    const own = shop.name ? fold(shop.name) : null;
    let best: { term: string; count: number; district: string } | null = null;
    for (const [districtId, districtName] of districts) {
      const here = rows.filter((r) => r.districtId === districtId).sort((a, b) => b.term.length - a.term.length);
      const kept: Array<{ term: string; count: number }> = [];
      for (const row of here) {
        // "bra", "brai" … on the way to "braids": the same searches, not more of them.
        if (kept.some((k) => k.term.startsWith(row.term))) continue;
        if (own && (own.includes(row.term) || row.term.includes(own))) continue;
        kept.push({ term: row.term, count: row._count._all });
      }
      for (const k of kept) {
        if (k.count >= MIN_SEARCHES && (!best || k.count > best.count)) best = { ...k, district: districtName };
      }
    }
    if (!best) return null;
    const term = best.term;
    const names = [...shop.services.flatMap((s) => [s.name, s.title ?? '']), ...shop.kinds.map((k) => k.subcategory.name)]
      .map(fold)
      .filter(Boolean);
    const offered = names.some((name) => name.includes(term) || term.includes(name));
    return { kind: 'searches', term, count: best.count, district: best.district, offered };
  }

  /** The most pressing thing about the shop's papers (§314), if any. */
  private async papers(businessId: string, now: Date): Promise<TodayItemDto | null> {
    const shop = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        kinds: { select: { category: { select: { name: true } }, subcategory: { select: { name: true } } } },
        documents: {
          where: { status: { in: [BusinessDocumentStatus.SUBMITTED, BusinessDocumentStatus.VERIFIED, BusinessDocumentStatus.REFUSED] } },
          orderBy: { createdAt: 'desc' },
          select: { kind: true, status: true, expiresAt: true },
        },
      },
    });
    const docs = shop.documents;
    const missing = requiredPapers(shop.kinds).find((rule) => ruleState(rule, docs, now) === 'missing');
    if (missing) return { kind: 'papers', state: 'missing', paper: missing.kinds[0] };
    const refused = docs.find((d) => d.status === BusinessDocumentStatus.REFUSED);
    if (refused) return { kind: 'papers', state: 'refused', paper: refused.kind };
    const standing = docs.filter((d) => d.status !== BusinessDocumentStatus.REFUSED && d.expiresAt !== null);
    const expired = standing.find((d) => d.expiresAt!.getTime() <= now.getTime());
    if (expired) return { kind: 'papers', state: 'expired', paper: expired.kind, date: expired.expiresAt!.toISOString().slice(0, 10) };
    const soon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
    const expiring = standing.find((d) => d.expiresAt!.getTime() <= soon.getTime());
    if (expiring) return { kind: 'papers', state: 'expiring', paper: expiring.kind, date: expiring.expiresAt!.toISOString().slice(0, 10) };
    return null;
  }

  /** What our team posted for shops to see in For you (§310), in the reader's language. */
  private async news(businessId: string, categoryIds: string[], locale: Locale, now: Date): Promise<TodayItemDto[]> {
    const posts = await this.prisma.announcement.findMany({
      where: {
        status: AnnouncementStatus.SENT,
        cancelledAt: null,
        forYouUntil: { gt: now },
        OR: [
          { audience: { in: [AnnouncementAudience.SELLERS, AnnouncementAudience.EVERYONE] }, categoryId: null },
          { audience: { in: [AnnouncementAudience.SELLERS, AnnouncementAudience.EVERYONE] }, categoryId: { in: categoryIds } },
          { audience: AnnouncementAudience.ONE_SHOP, businessId },
        ],
      },
      orderBy: { sentAt: 'desc' },
      take: 2,
      select: { id: true, title: true, body: true, linkPath: true, linkLabel: true, translations: true },
    });
    return posts.map((p) => {
      const words = typedIn(locale, { title: p.title, body: p.body, linkLabel: p.linkLabel }, readTyped(p.translations, NEWS_WORDS));
      return { kind: 'news', newsId: p.id, title: words.title, body: words.body, linkPath: p.linkPath, linkLabel: words.linkLabel };
    });
  }
}

/**
 * Tax dates for whoever sees the money (§310), from the Rwanda Revenue
 * Authority's calendar: monthly VAT and PAYE by the 15th (shown from the 8th),
 * the trading licence by 31 January, the annual income tax return by 31
 * March. A reminder with RRA's link, never advice.
 */
export function taxDue(today: string): { tax: string; date: string } | null {
  const [y, m, d] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (m === 1) return { tax: 'licence', date: `${y}-01-31` };
  if (m === 3 && d > 15) return { tax: 'annual', date: `${y}-03-31` };
  if (d >= 8 && d <= 15) return { tax: 'vat-paye', date: `${y}-${pad(m)}-15` };
  return null;
}
