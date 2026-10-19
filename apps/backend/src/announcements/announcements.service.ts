import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnnouncementAudience,
  AnnouncementKind,
  AnnouncementStatus,
  BusinessMemberStatus,
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnnouncementAudienceDto, SaveAnnouncementDto, SendAnnouncementDto } from './dto/announcement-request.dto';
import {
  AnnouncementDto,
  AnnouncementReachDto,
  AnnouncementStatsDto,
  BannersDto,
} from './dto/announcement-response.dto';

/** Above this many people, sending asks for the number typed back (§287). */
export const CONFIRM_ABOVE = 100;
/** A banner with no end date shows for a week. */
const BANNER_DAYS = 7;
const CHUNK = 100;

const SELECT = {
  id: true,
  kind: true,
  audience: true,
  district: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  user: { select: { id: true, email: true, displayName: true } },
  business: { select: { id: true, name: true } },
  title: true,
  body: true,
  linkPath: true,
  linkLabel: true,
  sendPush: true,
  sendEmail: true,
  banner: true,
  bannerUntil: true,
  status: true,
  scheduledFor: true,
  sentAt: true,
  recipients: true,
  createdBy: { select: { email: true } },
  sentBy: { select: { email: true } },
  createdAt: true,
  districtId: true,
  categoryId: true,
  userId: true,
  businessId: true,
} as const satisfies Prisma.AnnouncementSelect;

type Row = Prisma.AnnouncementGetPayload<{ select: typeof SELECT }>;

/**
 * Announcements (§287): one message from the platform's team to many people
 * — every customer, every seller, customers in a district, sellers of a
 * category, one shop's team, one person.
 *
 * Two kinds, and the difference is consent. A SERVICE notice ("MTN MoMo is
 * down this morning") reaches everyone it is for. NEWS — offers, new places,
 * tips — reaches only people who said yes to news, and every one carries a way
 * to stop. Each recipient then gets it the ways they chose, with quiet hours
 * kept: the notifications engine does the sending.
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Who ----------

  /** Everyone an audience means, before consent. Never administrators. */
  private async everyoneIn(a: AnnouncementAudienceDto): Promise<string[]> {
    const open = { closedAt: null };
    const customers = (districtId?: string | null) =>
      this.prisma.user.findMany({
        where: {
          ...open,
          role: UserRole.CUSTOMER,
          ...(districtId
            ? {
                OR: [{ homeDistrictId: districtId }, { appointments: { some: { location: { districtId } } } }],
              }
            : {}),
        },
        select: { id: true },
      });
    const sellers = (where: Prisma.BusinessMembershipWhereInput) =>
      this.prisma.businessMembership.findMany({
        where: { status: BusinessMemberStatus.ACTIVE, user: open, ...where },
        select: { userId: true },
        distinct: ['userId'],
      });

    switch (a.audience) {
      case AnnouncementAudience.CUSTOMERS:
        return (await customers(a.districtId)).map((u) => u.id);
      case AnnouncementAudience.SELLERS:
        return (await sellers(a.categoryId ? { businessProfile: { categoryId: a.categoryId } } : {})).map(
          (m) => m.userId,
        );
      case AnnouncementAudience.EVERYONE: {
        const [c, s] = await Promise.all([customers(null), sellers({})]);
        return [...new Set([...c.map((u) => u.id), ...s.map((m) => m.userId)])];
      }
      case AnnouncementAudience.ONE_PERSON: {
        if (!a.userId) return [];
        const user = await this.prisma.user.findFirst({
          where: { id: a.userId, ...open, role: { not: UserRole.ADMIN } },
          select: { id: true },
        });
        return user ? [user.id] : [];
      }
      case AnnouncementAudience.ONE_SHOP:
        return a.businessId ? (await sellers({ businessProfileId: a.businessId })).map((m) => m.userId) : [];
    }
  }

  /** News goes only to people who said yes to it, on some channel. */
  private async consenting(ids: string[]): Promise<string[]> {
    const yes = new Set<string>();
    for (let i = 0; i < ids.length; i += 5000) {
      const rows = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: ids.slice(i, i + 5000) }, category: NotificationCategory.NEWS, enabled: true },
        select: { userId: true },
      });
      rows.forEach((r) => yes.add(r.userId));
    }
    return ids.filter((id) => yes.has(id));
  }

  private async recipients(a: AnnouncementAudienceDto) {
    const all = await this.everyoneIn(a);
    const ids = a.kind === AnnouncementKind.NEWS ? await this.consenting(all) : all;
    return { ids, left: all.length - ids.length };
  }

  private categoryFor(kind: AnnouncementKind) {
    return kind === AnnouncementKind.NEWS ? NotificationCategory.NEWS : NotificationCategory.ACCOUNT;
  }

  /** How many it reaches, and how — before anything is sent. */
  async reach(a: AnnouncementAudienceDto & { sendPush: boolean; sendEmail: boolean }): Promise<AnnouncementReachDto> {
    this.assertAudience(a);
    const { ids, left } = await this.recipients(a);
    const category = this.categoryFor(a.kind);
    const offPush = new Set<string>();
    const onPush = new Set<string>();
    const onEmail = new Set<string>();
    const offEmail = new Set<string>();
    const withDevice = new Set<string>();
    for (let i = 0; i < ids.length; i += 5000) {
      const part = ids.slice(i, i + 5000);
      const [prefs, devices] = await Promise.all([
        this.prisma.notificationPreference.findMany({
          where: { userId: { in: part }, category },
          select: { userId: true, channel: true, enabled: true },
        }),
        this.prisma.pushDevice.findMany({
          where: { userId: { in: part }, disabledAt: null },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ]);
      for (const p of prefs) {
        const set =
          p.channel === NotificationChannel.PUSH ? (p.enabled ? onPush : offPush) : p.enabled ? onEmail : offEmail;
        set.add(p.userId);
      }
      devices.forEach((d) => withDevice.add(d.userId));
    }
    // A service notice's push is on unless turned off; its email cannot be.
    // News is on only where the person said yes.
    const news = a.kind === AnnouncementKind.NEWS;
    const push = a.sendPush
      ? ids.filter((id) => withDevice.has(id) && (news ? onPush.has(id) : !offPush.has(id))).length
      : 0;
    const email = a.sendEmail ? (news ? ids.filter((id) => onEmail.has(id)).length : ids.length) : 0;
    return { people: ids.length, push, email, left, confirmAbove: CONFIRM_ABOVE };
  }

  private assertAudience(a: AnnouncementAudienceDto & { banner?: boolean }) {
    if (a.audience === AnnouncementAudience.ONE_PERSON && !a.userId) {
      throw new BadRequestException('Choose the person to send it to.');
    }
    if (a.audience === AnnouncementAudience.ONE_SHOP && !a.businessId) {
      throw new BadRequestException('Choose the shop to send it to.');
    }
    if (a.banner && a.kind !== AnnouncementKind.SERVICE) {
      throw new BadRequestException('A banner is for service notices — news reaches only people who said yes.');
    }
  }

  // ---------- Writing ----------

  async list() {
    const rows = await this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: SELECT });
    return { announcements: rows.map((r) => this.toDto(r, null)) };
  }

  async get(id: string) {
    const row = await this.prisma.announcement.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new NotFoundException('Announcement not found.');
    return this.toDto(row, row.status === AnnouncementStatus.DRAFT ? null : await this.stats(id));
  }

  async create(adminId: string, dto: SaveAnnouncementDto) {
    this.assertAudience(dto);
    const row = await this.prisma.announcement.create({
      data: { ...this.fields(dto), createdById: adminId },
      select: SELECT,
    });
    return this.toDto(row, null);
  }

  async update(id: string, dto: SaveAnnouncementDto) {
    this.assertAudience(dto);
    const current = await this.require(id);
    if (current.status !== AnnouncementStatus.DRAFT && current.status !== AnnouncementStatus.SCHEDULED) {
      throw new BadRequestException('It has been sent; it cannot be changed now.');
    }
    const row = await this.prisma.announcement.update({ where: { id }, data: this.fields(dto), select: SELECT });
    return this.toDto(row, null);
  }

  private fields(dto: SaveAnnouncementDto) {
    const narrow = (on: boolean, value?: string | null) => (on ? (value ?? null) : null);
    return {
      kind: dto.kind,
      audience: dto.audience,
      districtId: narrow(dto.audience === AnnouncementAudience.CUSTOMERS, dto.districtId),
      categoryId: narrow(dto.audience === AnnouncementAudience.SELLERS, dto.categoryId),
      userId: narrow(dto.audience === AnnouncementAudience.ONE_PERSON, dto.userId),
      businessId: narrow(dto.audience === AnnouncementAudience.ONE_SHOP, dto.businessId),
      title: dto.title.trim(),
      body: dto.body.trim(),
      linkPath: dto.linkPath?.trim() || null,
      linkLabel: dto.linkLabel?.trim() || null,
      sendPush: dto.sendPush,
      sendEmail: dto.sendEmail,
      banner: dto.banner,
      bannerUntil: dto.banner && dto.bannerUntil ? new Date(dto.bannerUntil) : null,
    };
  }

  /** The same message to the administrator alone, to see it as people will. */
  async test(adminId: string, id: string) {
    const a = await this.require(id);
    await this.notifications.notify({
      recipientId: adminId,
      type: NotificationType.ANNOUNCEMENT,
      context: this.content(a),
      category: NotificationCategory.ACCOUNT,
      link: null,
      channels: { email: true, push: a.sendPush },
    });
    return { message: 'Sent to you, by email and in your notifications.' };
  }

  /** Sends now, or later. A large audience needs its number typed back. */
  async send(adminId: string, id: string, dto: SendAnnouncementDto) {
    const a = await this.require(id);
    if (a.status !== AnnouncementStatus.DRAFT && a.status !== AnnouncementStatus.SCHEDULED) {
      throw new BadRequestException('It has already been sent.');
    }
    const reach = await this.reach(a);
    if (reach.people === 0) {
      throw new BadRequestException(
        a.kind === AnnouncementKind.NEWS
          ? 'Nobody in that audience has said yes to news yet.'
          : 'Nobody is in that audience.',
      );
    }
    if (reach.people > CONFIRM_ABOVE && dto.confirmCount !== reach.people) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'CONFIRM_COUNT',
        message: `This reaches ${reach.people.toLocaleString('en')} people. Type ${reach.people} to confirm.`,
      });
    }

    const at = dto.at ? new Date(dto.at) : null;
    if (at && at.getTime() > Date.now() + 60_000) {
      await this.prisma.announcement.update({
        where: { id },
        data: { status: AnnouncementStatus.SCHEDULED, scheduledFor: at, sentById: adminId },
      });
      this.logger.log(`Announcement ${id} scheduled for ${at.toISOString()} by ${adminId}.`);
    } else {
      await this.prisma.announcement.update({
        where: { id },
        data: { status: AnnouncementStatus.SENDING, scheduledFor: null, sentById: adminId },
      });
      // In the background: a large audience takes a while, and nobody should
      // wait on a spinning button for it. The sweep picks up an interrupted one.
      void this.run(id);
    }
    return this.get(id);
  }

  async cancel(id: string) {
    const a = await this.require(id);
    if (a.status !== AnnouncementStatus.DRAFT && a.status !== AnnouncementStatus.SCHEDULED) {
      throw new BadRequestException('It has already gone out.');
    }
    await this.prisma.announcement.update({
      where: { id },
      data: { status: AnnouncementStatus.CANCELLED, cancelledAt: new Date() },
    });
    return this.get(id);
  }

  /**
   * Makes each recipient's notification, then lets the engine send them.
   * Safe to run again: whoever already has it is skipped, so a send cut short
   * by a restart finishes where it stopped.
   */
  async run(id: string): Promise<number> {
    if (this.running.has(id)) return 0;
    this.running.add(id);
    try {
      const a = await this.require(id);
      const { ids } = await this.recipients(a);
      const done = new Set(
        (await this.prisma.notification.findMany({ where: { announcementId: id }, select: { recipientId: true } })).map(
          (n) => n.recipientId,
        ),
      );
      const todo = ids.filter((uid) => !done.has(uid));
      const category = this.categoryFor(a.kind);
      for (let i = 0; i < todo.length; i += CHUNK) {
        await Promise.all(
          todo.slice(i, i + CHUNK).map((recipientId) =>
            this.notifications.notify({
              recipientId,
              type: NotificationType.ANNOUNCEMENT,
              context: this.content(a),
              category,
              link: a.linkPath,
              linkLabel: a.linkLabel,
              announcementId: id,
              channels: { email: a.sendEmail, push: a.sendPush },
              deferSend: true,
            }),
          ),
        );
        // Still alive: the sweep leaves a send that is moving alone.
        await this.prisma.announcement.update({ where: { id }, data: { updatedAt: new Date() } });
      }
      const recipients = await this.prisma.notification.count({ where: { announcementId: id } });
      await this.prisma.announcement.update({
        where: { id },
        data: { status: AnnouncementStatus.SENT, sentAt: new Date(), recipients },
      });
      this.logger.log(`Announcement ${id} sent to ${recipients} people.`);

      // Out now, rather than on the next minute's sweep.
      for (let round = 0; round < 50; round++) {
        const { attempted } = await this.notifications.deliverDue(500);
        if (attempted === 0) break;
      }
      return recipients;
    } catch (error) {
      this.logger.error(`Announcement ${id} did not finish: ${error instanceof Error ? error.message : error}`);
      return 0;
    } finally {
      this.running.delete(id);
    }
  }

  /** The minute's work: what is scheduled for now, and any send cut short. */
  async sendDue(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.announcement.findMany({
      where: {
        OR: [
          { status: AnnouncementStatus.SCHEDULED, scheduledFor: { lte: now } },
          { status: AnnouncementStatus.SENDING, updatedAt: { lt: new Date(now.getTime() - 2 * 60 * 1000) } },
        ],
      },
      select: { id: true },
    });
    for (const a of due) {
      await this.prisma.announcement.updateMany({
        where: { id: a.id, status: { in: [AnnouncementStatus.SCHEDULED, AnnouncementStatus.SENDING] } },
        data: { status: AnnouncementStatus.SENDING },
      });
      await this.run(a.id);
    }
    return due.length;
  }

  // ---------- Banners ----------

  /** Service notices shown across the top of an app, while they last. */
  async banners(forWho: 'customers' | 'sellers'): Promise<BannersDto> {
    const now = Date.now();
    const rows = await this.prisma.announcement.findMany({
      where: {
        status: AnnouncementStatus.SENT,
        kind: AnnouncementKind.SERVICE,
        banner: true,
        districtId: null,
        categoryId: null,
        audience: {
          in: [
            AnnouncementAudience.EVERYONE,
            forWho === 'customers' ? AnnouncementAudience.CUSTOMERS : AnnouncementAudience.SELLERS,
          ],
        },
        sentAt: { gte: new Date(now - 60 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { sentAt: 'desc' },
      select: { id: true, title: true, body: true, linkPath: true, linkLabel: true, bannerUntil: true, sentAt: true },
    });
    return {
      banners: rows
        .map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          linkPath: r.linkPath,
          linkLabel: r.linkLabel,
          until: (r.bannerUntil ?? new Date(r.sentAt!.getTime() + BANNER_DAYS * 86_400_000)).toISOString(),
        }))
        .filter((b) => Date.parse(b.until) > now)
        .slice(0, 3),
    };
  }

  // ---------- Reading ----------

  private async stats(id: string): Promise<AnnouncementStatsDto> {
    const [recipients, read, groups] = await Promise.all([
      this.prisma.notification.count({ where: { announcementId: id } }),
      this.prisma.notification.count({ where: { announcementId: id, readAt: { not: null } } }),
      this.prisma.notificationDelivery.groupBy({
        by: ['channel', 'status'],
        where: { notification: { announcementId: id } },
        _count: { _all: true },
      }),
    ]);
    const n = (channel: NotificationChannel | null, statuses: NotificationStatus[]) =>
      groups
        .filter((g) => (channel === null || g.channel === channel) && statuses.includes(g.status))
        .reduce((sum, g) => sum + g._count._all, 0);
    return {
      recipients,
      read,
      pushSent: n(NotificationChannel.PUSH, [NotificationStatus.SENT]),
      pushFailed: n(NotificationChannel.PUSH, [NotificationStatus.FAILED]),
      emailSent: n(NotificationChannel.EMAIL, [NotificationStatus.SENT]),
      emailFailed: n(NotificationChannel.EMAIL, [NotificationStatus.FAILED]),
      skipped: n(null, [NotificationStatus.SKIPPED]),
      waiting: n(null, [NotificationStatus.PENDING, NotificationStatus.SENDING, NotificationStatus.HELD]),
    };
  }

  private async require(id: string) {
    const row = await this.prisma.announcement.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new NotFoundException('Announcement not found.');
    return row;
  }

  private content(a: { title: string; body: string }) {
    return {
      serviceName: a.title,
      reason: a.body,
      locationName: '',
      businessName: '',
      startTime: undefined as unknown as Date,
    };
  }

  private toDto(r: Row, stats: AnnouncementStatsDto | null): AnnouncementDto {
    return {
      id: r.id,
      kind: r.kind,
      audience: r.audience,
      district: r.district,
      category: r.category,
      user: r.user,
      business: r.business ? { id: r.business.id, name: r.business.name ?? 'Unnamed shop' } : null,
      title: r.title,
      body: r.body,
      linkPath: r.linkPath,
      linkLabel: r.linkLabel,
      sendPush: r.sendPush,
      sendEmail: r.sendEmail,
      banner: r.banner,
      bannerUntil: r.bannerUntil?.toISOString() ?? null,
      status: r.status,
      scheduledFor: r.scheduledFor?.toISOString() ?? null,
      sentAt: r.sentAt?.toISOString() ?? null,
      recipients: r.recipients,
      createdBy: r.createdBy?.email ?? null,
      sentBy: r.sentBy?.email ?? null,
      createdAt: r.createdAt.toISOString(),
      stats,
    };
  }
}
