import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationCategory, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { formatDateIn, say } from '../i18n/say';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessAccessService } from '../business/business-access.service';
import { ALL_BRANCHES_ONLY } from '../business/branch-scope';
import { PUBLIC_BUSINESS } from '../business/business-status';
import { liveDiscount, platformToday } from '../business/discount';
import {
  FollowListDto,
  FollowNewsDto,
  FollowStateDto,
  SendShopMessageDto,
  ShopMessageDto,
  ShopMessagesDto,
} from './dto/shop-message.dto';
import { CountriesService } from '../countries/countries.service';

/** One message a week per shop (§287). */
export const SHOP_MESSAGE_EVERY_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
/** A service is "new" at a shop you follow for this long (§288). */
const NEW_DAYS = 14;

/** The words a customer agrees to by following a shop, kept with the yes. */
/**
 * The words a yes to a shop's offers agrees to, kept with it — the same the
 * app shows. "Offers from {shop}": a possessive built in English code cannot
 * be translated (§308).
 */
export const followWording = (shop: string) => `Yes, send me offers from ${shop.trim()}. I can stop at any time.`;

/**
 * Following shops, and shops writing to their followers (§287, §288) — the
 * way Booksy and Fresha let a business reach its own clients, but only those
 * who asked.
 *
 * Following brings a shop's news into the app: its discounts, new services,
 * stories and messages, gathered under Saved → Following. Its offers as
 * notifications are a separate yes, kept with its words; turning them off, or
 * unfollowing, is one tap. A shop may write once a week: everyone following
 * sees it in the app, and those who said yes are told the ways they chose for
 * "Offers from places you follow", with quiet hours and the weekly limit on
 * marketing pushes kept.
 */
@Injectable()
export class ShopMessagesService {
  private readonly logger = new Logger(ShopMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly notifications: NotificationsService,
    private readonly countries: CountriesService,
  ) {}

  // ---------- Customers ----------

  /**
   * The shops this customer follows, with what is new at each (§288): a
   * discount running, a service added in the last fortnight, the shop's
   * message this week, a story up now. Shops not open on the app are left out
   * until they are again.
   */
  async follows(userId: string): Promise<FollowListDto> {
    const now = new Date();
    const rows = await this.prisma.shopFollow.findMany({
      where: { userId, business: PUBLIC_BUSINESS },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        offersAt: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            coverImageUrl: true,
            countryCode: true,
            category: { select: { icon: true } },
            locations: {
              where: { isActive: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: {
                id: true,
                name: true,
                ratingAvg: true,
                ratingCount: true,
                district: { select: { name: true } },
              },
            },
            stories: { where: { expiresAt: { gt: now }, removedAt: null }, select: { id: true }, take: 1 },
            services: {
              where: {
                isActive: true,
                OR: [{ discountPercent: { not: null } }, { createdAt: { gte: new Date(now.getTime() - NEW_DAYS * DAY) } }],
              },
              orderBy: { createdAt: 'desc' },
              take: 12,
              select: { id: true, name: true, createdAt: true, discountPercent: true, discountEndsOn: true },
            },
            shopMessages: {
              where: { createdAt: { gte: new Date(now.getTime() - SHOP_MESSAGE_EVERY_DAYS * DAY) } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { title: true, body: true, createdAt: true },
            },
          },
        },
      },
    });

    const day = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
    // Each shop's sale is judged on its own clock (§315): followed shops can be in any country.
    const zones = new Map<string, string>();
    for (const code of new Set(rows.map((r) => r.business.countryCode))) zones.set(code, await this.countries.zoneOf(code));
    const follows = rows.map((r) => {
      const b = r.business;
      const zone = zones.get(b.countryCode)!;
      const today = platformToday(zone, now);
      const branch = b.locations[0] ?? null;
      const news: FollowNewsDto[] = [];
      for (const service of b.services) {
        const discount = liveDiscount(service, today, zone);
        if (discount) {
          news.push({
            kind: 'DISCOUNT',
            title: `${discount.percent}% off ${service.name}`,
            detail: service.discountEndsOn ? `until ${day(service.discountEndsOn)}` : null,
            serviceId: service.id,
            at: service.createdAt.toISOString(),
          });
        }
      }
      for (const service of b.services) {
        if (service.createdAt.getTime() >= now.getTime() - NEW_DAYS * DAY && !news.some((n) => n.serviceId === service.id)) {
          news.push({ kind: 'NEW_SERVICE', title: service.name, detail: 'New', serviceId: service.id, at: service.createdAt.toISOString() });
        }
      }
      const message = b.shopMessages[0];
      if (message) {
        news.unshift({ kind: 'MESSAGE', title: message.title, detail: message.body, serviceId: null, at: message.createdAt.toISOString() });
      }
      return {
        business: {
          id: b.id,
          name: b.name ?? 'A shop',
          logoUrl: b.logoUrl,
          coverImageUrl: b.coverImageUrl,
          categoryIcon: b.category?.icon ?? null,
        },
        bookAt: branch ? { id: branch.id, name: branch.name } : null,
        district: branch?.district?.name ?? null,
        ratingAvg: branch?.ratingAvg !== null && branch?.ratingAvg !== undefined ? Number(branch.ratingAvg) : null,
        ratingCount: branch?.ratingCount ?? 0,
        followedAt: r.createdAt.toISOString(),
        offers: r.offersAt !== null,
        hasStory: b.stories.length > 0,
        news: news.slice(0, 4),
      };
    });
    // Something new first, then newest followed.
    follows.sort((a, b) => Number(b.news.length > 0) - Number(a.news.length > 0));
    return { follows };
  }

  /**
   * Follows a shop. Its offers as notifications only with `offers` — a yes
   * kept with its words; following alone brings its news into the app.
   */
  async follow(userId: string, businessId: string, offers = false): Promise<FollowStateDto> {
    const shop = await this.prisma.businessProfile.findFirst({
      where: { id: businessId, ...PUBLIC_BUSINESS },
      select: { id: true, name: true },
    });
    if (!shop) throw new NotFoundException('That shop is not open on the app.');
    const existing = await this.prisma.shopFollow.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { offersAt: true },
    });
    if (!existing) await this.prisma.shopFollow.create({ data: { userId, businessId } });
    if (offers && !existing?.offersAt) return this.setOffers(userId, businessId, true);
    return { following: true, offers: Boolean(existing?.offersAt) };
  }

  /** Its offers as notifications, yes or no. Each answer kept with its words. */
  async setOffers(userId: string, businessId: string, offers: boolean): Promise<FollowStateDto> {
    const follow = await this.prisma.shopFollow.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { offersAt: true, business: { select: { name: true } } },
    });
    if (!follow) throw new NotFoundException('You do not follow that shop.');
    if (offers !== (follow.offersAt !== null)) {
      await this.prisma.$transaction([
        this.prisma.shopFollow.update({
          where: { userId_businessId: { userId, businessId } },
          data: { offersAt: offers ? new Date() : null },
        }),
        this.prisma.consentRecord.create({
          data: {
            userId,
            purpose: `shop:${businessId}`,
            granted: offers,
            wording: offers ? followWording(follow.business.name ?? 'this shop') : 'Offers turned off.',
            source: 'customer-app',
          },
        }),
      ]);
    }
    return { following: true, offers };
  }

  async unfollow(userId: string, businessId: string): Promise<FollowStateDto> {
    const follow = await this.prisma.shopFollow.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { offersAt: true },
    });
    if (follow) {
      await this.prisma.shopFollow.delete({ where: { userId_businessId: { userId, businessId } } });
      if (follow.offersAt) {
        await this.prisma.consentRecord.create({
          data: { userId, purpose: `shop:${businessId}`, granted: false, wording: 'Unfollowed.', source: 'customer-app' },
        });
      }
    }
    return { following: false, offers: false };
  }

  /**
   * A discount at a shop you follow (§288): a note in the app — not an alert,
   * not an email — once per discount, and one note per shop however many of
   * its services it covers. Run every 15 minutes; a discount ended or removed
   * is forgotten, so the next one is news again.
   */
  async tellFollowersOfDiscounts(): Promise<number> {
    // A sale's last day is a day on its shop's clock (§315), so each country is looked at on its own.
    let told = 0;
    for (const country of await this.countries.live()) {
      told += await this.tellFollowersOfDiscountsIn(country.code, platformToday(country.timeZone));
    }
    return told;
  }

  private async tellFollowersOfDiscountsIn(countryCode: string, today: Date): Promise<number> {
    // Ended or removed: forgotten.
    await this.prisma.discountNote.deleteMany({
      where: {
        service: {
          business: { countryCode },
          OR: [{ discountPercent: null }, { discountEndsOn: { lt: today } }, { isActive: false }],
        },
      },
    });
    const candidates = await this.prisma.service.findMany({
      where: {
        isActive: true,
        discountPercent: { not: null },
        OR: [{ discountEndsOn: null }, { discountEndsOn: { gte: today } }],
        business: { ...PUBLIC_BUSINESS, countryCode, followers: { some: {} } },
      },
      select: {
        id: true,
        name: true,
        businessId: true,
        discountPercent: true,
        discountEndsOn: true,
        discountNote: { select: { percent: true, endsOn: true } },
        business: { select: { name: true } },
        locations: { where: { isOffered: true, location: { isActive: true } }, take: 1, select: { locationId: true } },
      },
    });
    const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
    const fresh = candidates.filter(
      (s) => !s.discountNote || s.discountNote.percent !== s.discountPercent || !same(s.discountNote.endsOn, s.discountEndsOn),
    );
    if (fresh.length === 0) return 0;

    const byShop = new Map<string, typeof fresh>();
    for (const s of fresh) byShop.set(s.businessId, [...(byShop.get(s.businessId) ?? []), s]);

    let told = 0;
    for (const [businessId, services] of byShop) {
      const shop = services[0].business.name ?? 'A shop you follow';
      const first = services[0];
      const title =
        services.length === 1
          ? `${shop}: ${first.discountPercent}% off ${first.name}`
          : `${shop}: discounts on ${services.length} services`;
      const body =
        services.map((s) => `${s.name} — ${s.discountPercent}% off`).join('\n') +
        '\n\nYou follow this shop, so its news comes here. Book in the app — the discount is already applied.';
      const followers = await this.prisma.shopFollow.findMany({ where: { businessId }, select: { userId: true } });
      for (const f of followers) {
        await this.notifications.notify({
          recipientId: f.userId,
          type: NotificationType.SHOP_DISCOUNT,
          category: NotificationCategory.SHOP_OFFERS,
          context: { serviceName: title, reason: body, locationName: '', businessName: shop, startTime: undefined as unknown as Date },
          ref: { locationId: first.locations[0]?.locationId ?? null },
          // In the app only: news, not a push or an email (§288).
          channels: { push: false, email: false },
        });
        told++;
      }
      for (const s of services) {
        const note = { percent: s.discountPercent!, endsOn: s.discountEndsOn, toldAt: new Date() };
        await this.prisma.discountNote.upsert({
          where: { serviceId: s.id },
          create: { serviceId: s.id, ...note },
          update: note,
        });
      }
    }
    if (told > 0) this.logger.log(`Discount notes: ${told} follower(s) told across ${byShop.size} shop(s).`);
    return told;
  }

  // ---------- Shops ----------

  async listForShop(userId: string): Promise<ShopMessagesDto> {
    const { businessId } = await this.access.requireBusinessScope(userId);
    const [followers, withOffers, rows] = await Promise.all([
      this.prisma.shopFollow.count({ where: { businessId } }),
      this.prisma.shopFollow.count({ where: { businessId, offersAt: { not: null } } }),
      this.prisma.shopMessage.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          title: true,
          body: true,
          recipients: true,
          createdAt: true,
          location: { select: { id: true, name: true } },
          sentBy: { select: { email: true } },
          _count: { select: { notifications: { where: { readAt: { not: null } } } } },
        },
      }),
    ]);
    const last = rows[0]?.createdAt;
    const next = last ? new Date(last.getTime() + SHOP_MESSAGE_EVERY_DAYS * DAY) : null;
    return {
      followers,
      withOffers,
      everyDays: SHOP_MESSAGE_EVERY_DAYS,
      nextAt: next && next.getTime() > Date.now() ? next.toISOString() : null,
      messages: rows.map((r): ShopMessageDto => ({
        id: r.id,
        title: r.title,
        body: r.body,
        location: r.location,
        recipients: r.recipients,
        read: r._count.notifications,
        sentBy: r.sentBy?.email ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Writes to every follower. For those who look after every branch: a shop's
   * followers follow the whole shop (§277).
   */
  async send(userId: string, dto: SendShopMessageDto, locale: Locale = DEFAULT_LOCALE): Promise<ShopMessagesDto> {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    if (!scope.allLocations) throw new ForbiddenException(ALL_BRANCHES_ONLY);

    const shop = await this.prisma.businessProfile.findFirst({
      where: { id: businessId, ...PUBLIC_BUSINESS },
      select: { id: true, name: true, countryCode: true },
    });
    if (!shop) {
      throw new BadRequestException('Your shop needs to be live on the app to write to its followers.');
    }

    const last = await this.prisma.shopMessage.findFirst({
      where: { businessId, createdAt: { gte: new Date(Date.now() - SHOP_MESSAGE_EVERY_DAYS * DAY) } },
      select: { createdAt: true },
    });
    if (last) {
      const next = new Date(last.createdAt.getTime() + SHOP_MESSAGE_EVERY_DAYS * DAY);
      // Said here, in the sender's language: the date is not a word the error filter could translate.
      throw new BadRequestException(
        say(locale, 'One message a week keeps people following. The next can go on {day}.', {
          day: formatDateIn(locale, next, { weekday: 'long', day: 'numeric', month: 'long', timeZone: await this.countries.zoneOf(shop.countryCode) }),
        }),
      );
    }

    let location: { id: string; name: string } | null = null;
    if (dto.locationId) {
      const owned = await this.access.requireOwnedLocation(businessId, dto.locationId);
      if (!owned.isActive) throw new BadRequestException('That branch is closed.');
      location = { id: owned.id, name: owned.name };
    } else {
      location = await this.prisma.location.findFirst({
        where: { businessId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      });
    }

    const followers = await this.prisma.shopFollow.findMany({ where: { businessId }, select: { userId: true, offersAt: true } });
    if (followers.length === 0) {
      throw new BadRequestException('Nobody follows your shop yet. Customers can follow it from your page in the app.');
    }
    // Every follower sees it in the app; those who said yes are told (§288).
    const told = followers.filter((f) => f.offersAt !== null);

    const message = await this.prisma.shopMessage.create({
      data: {
        businessId,
        locationId: dto.locationId ?? null,
        sentById: userId,
        title: dto.title.trim(),
        body: dto.body.trim(),
        recipients: told.length,
      },
      select: { id: true },
    });

    // In the background: the shop should not wait on a spinning button.
    void this.deliver(
      message.id,
      shop.name ?? 'A shop',
      dto,
      location,
      told.map((f) => f.userId),
    );
    this.logger.log(
      `Shop ${businessId} wrote to ${followers.length} follower(s), ${told.length} told by notification: ${message.id}.`,
    );
    return this.listForShop(userId);
  }

  private async deliver(
    messageId: string,
    shopName: string,
    dto: SendShopMessageDto,
    location: { id: string; name: string } | null,
    userIds: string[],
  ) {
    try {
      for (let i = 0; i < userIds.length; i += 100) {
        await Promise.all(
          userIds.slice(i, i + 100).map((recipientId) =>
            this.notifications.notify({
              recipientId,
              type: NotificationType.SHOP_MESSAGE,
              category: NotificationCategory.SHOP_OFFERS,
              context: {
                serviceName: `${shopName}: ${dto.title.trim()}`,
                reason: dto.body.trim(),
                locationName: location?.name ?? '',
                businessName: shopName,
                startTime: undefined as unknown as Date,
              },
              ref: { locationId: location?.id ?? null },
              shopMessageId: messageId,
              deferSend: true,
            }),
          ),
        );
      }
      for (let round = 0; round < 20; round++) {
        const { attempted } = await this.notifications.deliverDue(500);
        if (attempted === 0) break;
      }
    } catch (error) {
      this.logger.error(`Shop message ${messageId} did not finish: ${error instanceof Error ? error.message : error}`);
    }
  }
}
