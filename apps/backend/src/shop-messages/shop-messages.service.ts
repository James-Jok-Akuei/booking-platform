import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationCategory, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessAccessService } from '../business/business-access.service';
import { ALL_BRANCHES_ONLY } from '../business/branch-scope';
import { PUBLIC_BUSINESS } from '../business/business-status';
import { SendShopMessageDto, ShopMessageDto, ShopMessagesDto } from './dto/shop-message.dto';

/** One message a week per shop (§287). */
export const SHOP_MESSAGE_EVERY_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** The words a customer agrees to by following a shop, kept with the yes. */
export const followWording = (shop: string) => `Yes, send me ${shop}'s offers. I can stop at any time.`;

/**
 * Shops writing to the customers who follow them (§287) — the way Booksy and
 * Fresha let a business reach its own clients, but only those who asked.
 *
 * Following IS the yes, recorded with its words; unfollowing is the no, one
 * tap, anywhere. A shop may write once a week, and each message arrives the
 * ways its follower chose for "Offers from places you follow", with quiet
 * hours and the weekly limit on marketing pushes kept.
 */
@Injectable()
export class ShopMessagesService {
  private readonly logger = new Logger(ShopMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Customers ----------

  async follows(userId: string) {
    const rows = await this.prisma.shopFollow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            locations: {
              where: { isActive: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { id: true, name: true },
            },
          },
        },
      },
    });
    return {
      follows: rows.map((r) => ({
        business: { id: r.business.id, name: r.business.name ?? 'A shop', logoUrl: r.business.logoUrl },
        bookAt: r.business.locations[0] ?? null,
        followedAt: r.createdAt.toISOString(),
      })),
    };
  }

  async follow(userId: string, businessId: string) {
    const shop = await this.prisma.businessProfile.findFirst({
      where: { id: businessId, ...PUBLIC_BUSINESS },
      select: { id: true, name: true },
    });
    if (!shop) throw new NotFoundException('That shop is not open on the app.');
    const existing = await this.prisma.shopFollow.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { userId: true },
    });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.shopFollow.create({ data: { userId, businessId } }),
        this.prisma.consentRecord.create({
          data: {
            userId,
            purpose: `shop:${businessId}`,
            granted: true,
            wording: followWording(shop.name ?? 'this shop'),
            source: 'customer-app',
          },
        }),
      ]);
    }
    return { following: true };
  }

  async unfollow(userId: string, businessId: string) {
    const { count } = await this.prisma.shopFollow.deleteMany({ where: { userId, businessId } });
    if (count > 0) {
      await this.prisma.consentRecord.create({
        data: { userId, purpose: `shop:${businessId}`, granted: false, wording: 'Unfollowed.', source: 'customer-app' },
      });
    }
    return { following: false };
  }

  // ---------- Shops ----------

  async listForShop(userId: string): Promise<ShopMessagesDto> {
    const { businessId } = await this.access.requireBusinessScope(userId);
    const [followers, rows] = await Promise.all([
      this.prisma.shopFollow.count({ where: { businessId } }),
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
      everyDays: SHOP_MESSAGE_EVERY_DAYS,
      nextAt: next && next.getTime() > Date.now() ? next.toISOString() : null,
      messages: rows.map(
        (r): ShopMessageDto => ({
          id: r.id,
          title: r.title,
          body: r.body,
          location: r.location,
          recipients: r.recipients,
          read: r._count.notifications,
          sentBy: r.sentBy?.email ?? null,
          createdAt: r.createdAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Writes to every follower. For those who look after every branch: a shop's
   * followers follow the whole shop (§277).
   */
  async send(userId: string, dto: SendShopMessageDto): Promise<ShopMessagesDto> {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    if (!scope.allLocations) throw new ForbiddenException(ALL_BRANCHES_ONLY);

    const shop = await this.prisma.businessProfile.findFirst({
      where: { id: businessId, ...PUBLIC_BUSINESS },
      select: { id: true, name: true },
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
      throw new BadRequestException(
        `One message a week keeps people following. The next can go on ${next.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.`,
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

    const followers = await this.prisma.shopFollow.findMany({ where: { businessId }, select: { userId: true } });
    if (followers.length === 0) {
      throw new BadRequestException('Nobody follows your shop yet. Customers can follow it from your page in the app.');
    }

    const message = await this.prisma.shopMessage.create({
      data: {
        businessId,
        locationId: dto.locationId ?? null,
        sentById: userId,
        title: dto.title.trim(),
        body: dto.body.trim(),
        recipients: followers.length,
      },
      select: { id: true },
    });

    // In the background: the shop should not wait on a spinning button.
    void this.deliver(message.id, shop.name ?? 'A shop', dto, location, followers.map((f) => f.userId));
    this.logger.log(`Shop ${businessId} wrote to ${followers.length} follower(s): ${message.id}.`);
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
