import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessAccessService } from '../business/business-access.service';
import { ALL_BRANCHES_ONLY, assertBranch, branchIn } from '../business/branch-scope';
import { PUBLIC_BUSINESS } from '../business/business-status';
import { PostStoryDto } from './dto/story-request.dto';
import type {
  AdminStoriesDto,
  AdminStoryDto,
  BusinessStoryDto,
  MyStoriesDto,
  StoryFeedDto,
  StoryShopDto,
} from './dto/story-response.dto';

const HOUR = 60 * 60 * 1000;

/** How long a story is up (§285). */
export const STORY_HOURS = 24;
/** How many a shop may post in any 24 hours. Enough for a busy day; not a feed to scroll. */
export const STORIES_PER_DAY = 10;
/** How long after it ends a story's row and picture are kept, then cleared. */
export const STORY_KEEP_DAYS = 3;

const BUSINESS_STORY_SELECT = {
  id: true,
  imageUrl: true,
  caption: true,
  views: true,
  createdAt: true,
  expiresAt: true,
  removedAt: true,
  removedReason: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { email: true } },
} satisfies Prisma.StorySelect;

type BusinessStoryRow = Prisma.StoryGetPayload<{ select: typeof BUSINESS_STORY_SELECT }>;

const toBusinessDto = (row: BusinessStoryRow): BusinessStoryDto => ({
  id: row.id,
  imageUrl: row.imageUrl,
  caption: row.caption,
  location: row.location,
  postedBy: row.createdBy?.email ?? null,
  views: row.views,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  removedAt: row.removedAt?.toISOString() ?? null,
  removedReason: row.removedReason,
});

/**
 * Shops' stories (§285): one photo and a few words, for everyone to see for
 * 24 hours — today's braids, two slots free this afternoon, new colours in.
 *
 * Images only: small to upload on mobile data and quick to check. Live as
 * soon as posted — a story that waited for approval would be over before it
 * was seen — so customers can report one and an administrator can take it
 * down, and the shop is told why.
 */
@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: BusinessAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- The shop ----------

  /**
   * Posts a story. The owner and managers may; someone who looks after some
   * branches only must say which of theirs it is about (§277), and the whole
   * shop's are for those who look after every branch.
   */
  async post(userId: string, file: Express.Multer.File | undefined, dto: PostStoryDto): Promise<BusinessStoryDto> {
    if (!file) {
      throw new BadRequestException('Choose a photo for the story.');
    }
    const membership = await this.access.requireActiveMembership(userId);
    const businessId = membership.businessProfileId;

    const locationId = dto.locationId ?? null;
    if (locationId) {
      const location = await this.access.requireOwnedLocation(businessId, locationId);
      assertBranch(membership.scope, locationId);
      if (!location.isActive) throw new BadRequestException('That branch is closed, so it cannot have a story.');
    } else if (!membership.scope.allLocations) {
      throw new BadRequestException('Choose which of your branches this story is about.');
    }

    const posted = await this.prisma.story.count({
      where: { businessId, createdAt: { gte: new Date(Date.now() - STORY_HOURS * HOUR) } },
    });
    if (posted >= STORIES_PER_DAY) {
      throw new BadRequestException(
        `A shop can post ${STORIES_PER_DAY} stories in a day. The next one can go up as the first of today's ends.`,
      );
    }

    // Stored first: an orphaned picture costs a few KB; a story pointing at a
    // picture that was never written is a broken one for a day.
    const imageUrl = await this.storage.upload(file.buffer, file.mimetype, `stories/${businessId}`);
    const story = await this.prisma.story.create({
      data: {
        businessId,
        locationId,
        createdById: userId,
        imageUrl,
        caption: dto.caption?.trim() || null,
        expiresAt: new Date(Date.now() + STORY_HOURS * HOUR),
      },
      select: BUSINESS_STORY_SELECT,
    });
    return toBusinessDto(story);
  }

  /**
   * The shop's stories of the last two days — live, ended, taken down — for
   * the seller app, with how many have been posted in the last 24 hours. Of a
   * branch's, someone with some branches sees only theirs (§277).
   */
  async listMine(userId: string): Promise<MyStoriesDto> {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    const only = branchIn(scope);
    const now = Date.now();
    const [stories, postedToday] = await Promise.all([
      this.prisma.story.findMany({
        where: {
          businessId,
          createdAt: { gte: new Date(now - 2 * STORY_HOURS * HOUR) },
          ...(only && { OR: [{ locationId: null }, { locationId: only }] }),
        },
        orderBy: { createdAt: 'desc' },
        select: BUSINESS_STORY_SELECT,
      }),
      this.prisma.story.count({ where: { businessId, createdAt: { gte: new Date(now - STORY_HOURS * HOUR) } } }),
    ]);
    return { stories: stories.map(toBusinessDto), postedToday, dailyLimit: STORIES_PER_DAY };
  }

  /** Takes a story down early. Its picture goes with it. */
  async remove(userId: string, storyId: string) {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, businessId },
      select: { id: true, imageUrl: true, locationId: true },
    });
    if (!story) throw new NotFoundException('Story not found.');
    if (story.locationId) assertBranch(scope, story.locationId);
    else if (!scope.allLocations) throw new ForbiddenException(ALL_BRANCHES_ONLY);

    await this.prisma.story.delete({ where: { id: storyId } });
    await this.storage.remove(story.imageUrl);
    return { message: 'Story deleted.' };
  }

  // ---------- Customers ----------

  /**
   * Every live story of every shop customers can find (§268), a shop at a
   * time: the shop that posted most recently first, and its stories in the
   * order they went up. Each story says where its "Book" button leads — its
   * branch, or the shop's first open one.
   */
  async feed(): Promise<StoryFeedDto> {
    const rows = await this.prisma.story.findMany({
      where: { expiresAt: { gt: new Date() }, removedAt: null, business: PUBLIC_BUSINESS },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        imageUrl: true,
        caption: true,
        createdAt: true,
        expiresAt: true,
        location: { select: { id: true, name: true, isActive: true } },
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

    const shops = new Map<string, StoryShopDto & { latest: number }>();
    for (const row of rows) {
      const first = row.business.locations[0];
      const bookAt = row.location?.isActive ? { id: row.location.id, name: row.location.name } : first;
      if (!bookAt) continue;
      const shop = shops.get(row.business.id) ?? {
        business: {
          id: row.business.id,
          name: row.business.name ?? first?.name ?? bookAt.name,
          logoUrl: row.business.logoUrl,
        },
        stories: [],
        latest: 0,
      };
      shop.stories.push({
        id: row.id,
        imageUrl: row.imageUrl,
        caption: row.caption,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        bookAt,
      });
      shop.latest = Math.max(shop.latest, row.createdAt.getTime());
      shops.set(row.business.id, shop);
    }
    return {
      shops: [...shops.values()].sort((a, b) => b.latest - a.latest).map(({ latest: _latest, ...shop }) => shop),
    };
  }

  /** Someone opened a story. A count only — never who (§285). */
  async view(storyId: string) {
    await this.prisma.story.updateMany({
      where: { id: storyId, removedAt: null, expiresAt: { gt: new Date() } },
      data: { views: { increment: 1 } },
    });
  }

  /** A customer says a story should not be there. Once each; a second time changes the reason. */
  async report(userId: string, storyId: string, reason: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, removedAt: null }, select: { id: true } });
    if (!story) throw new NotFoundException('Story not found.');
    await this.prisma.storyReport.upsert({
      where: { storyId_reporterId: { storyId, reporterId: userId } },
      create: { storyId, reporterId: userId, reason: reason.trim() },
      update: { reason: reason.trim() },
    });
    return { message: 'Thank you. Our team will look at it.' };
  }

  // ---------- Administrators ----------

  /**
   * Stories to look at: the reported ones still up (the last week's), most
   * reported first — or every live one.
   */
  async adminList(view: 'reported' | 'live'): Promise<AdminStoriesDto> {
    const now = new Date();
    // Reported and still up: the ones waiting for a decision. One that has
    // ended is no longer in front of anyone, so it leaves the queue by itself.
    const reportedWhere: Prisma.StoryWhereInput = {
      removedAt: null,
      expiresAt: { gt: now },
      reports: { some: {} },
    };
    const liveWhere: Prisma.StoryWhereInput = { removedAt: null, expiresAt: { gt: now } };
    const [rows, reported, live] = await Promise.all([
      this.prisma.story.findMany({
        where: view === 'reported' ? reportedWhere : liveWhere,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          imageUrl: true,
          caption: true,
          views: true,
          createdAt: true,
          expiresAt: true,
          removedAt: true,
          removedReason: true,
          business: { select: { id: true, name: true, logoUrl: true } },
          location: { select: { id: true, name: true } },
          _count: { select: { reports: true } },
          reports: { orderBy: { createdAt: 'desc' }, take: 5, select: { reason: true, createdAt: true } },
        },
      }),
      this.prisma.story.count({ where: reportedWhere }),
      this.prisma.story.count({ where: liveWhere }),
    ]);

    const stories: AdminStoryDto[] = rows.map((row) => ({
      id: row.id,
      imageUrl: row.imageUrl,
      caption: row.caption,
      business: { id: row.business.id, name: row.business.name ?? 'Unnamed shop', logoUrl: row.business.logoUrl },
      location: row.location,
      views: row.views,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      removedAt: row.removedAt?.toISOString() ?? null,
      removedReason: row.removedReason,
      reportCount: row._count.reports,
      reports: row.reports.map((r) => ({ reason: r.reason, createdAt: r.createdAt.toISOString() })),
    }));
    if (view === 'reported') stories.sort((a, b) => b.reportCount - a.reportCount);
    return { stories, reported, live };
  }

  /** Takes a story down, and tells the shop why. */
  async adminRemove(adminId: string, storyId: string, reason: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, removedAt: null },
      select: { id: true, businessId: true, locationId: true, location: { select: { name: true } } },
    });
    if (!story) throw new NotFoundException('Story not found, or already taken down.');

    await this.prisma.story.update({
      where: { id: storyId },
      data: { removedAt: new Date(), removedById: adminId, removedReason: reason.trim() },
    });
    await this.notifications.notifyBusiness({
      businessId: story.businessId,
      type: NotificationType.STORY_REMOVED,
      locationId: story.locationId ?? null,
      context: {
        serviceName: '',
        locationName: story.location?.name ?? '',
        businessName: '',
        startTime: undefined as unknown as Date,
        reason: reason.trim(),
      },
    });
    this.logger.log(`Story ${storyId} taken down by admin ${adminId}: ${reason.trim()}`);
    return { message: 'Story taken down. The shop has been told why.' };
  }

  /**
   * Looked at, and fine: its reports are cleared, so it leaves the queue and
   * stays up. Someone who reports it again puts it back.
   */
  async adminKeep(adminId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, removedAt: null }, select: { id: true } });
    if (!story) throw new NotFoundException('Story not found, or already taken down.');
    const cleared = await this.prisma.storyReport.deleteMany({ where: { storyId } });
    this.logger.log(`Story ${storyId} kept up by admin ${adminId}; ${cleared.count} report(s) cleared`);
    return { message: 'The story stays up. Its reports are cleared.' };
  }

  // ---------- Housekeeping ----------

  /** Clears stories, and their pictures, a few days after they end. */
  async clearOld(): Promise<number> {
    const old = await this.prisma.story.findMany({
      where: { expiresAt: { lt: new Date(Date.now() - STORY_KEEP_DAYS * 24 * HOUR) } },
      select: { id: true, imageUrl: true },
      take: 500,
    });
    for (const story of old) {
      await this.storage.remove(story.imageUrl);
    }
    if (old.length > 0) {
      await this.prisma.story.deleteMany({ where: { id: { in: old.map((s) => s.id) } } });
    }
    return old.length;
  }
}
