import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  BusinessMemberStatus,
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  MarkAllReadDto,
  MarkReadDto,
  NOTIFICATION_SELECT,
  DismissedDto,
  DismissedManyDto,
  ReadManyDto,
  RestoredManyDto,
} from './dto/notification-response.dto';
import { NOTIFICATION_CHANNEL, NotificationChannelDriver, OutboundMessage } from './notification-channel.interface';
import { BOOKING_FACTS_SELECT, bookingFacts } from '../mail/booking-email';
import { noticeEmail, summaryEmail } from './notification-email';
import { AppointmentContext, renderNotification } from './notification-templates';
import { MONEY_READERS, membersOfBranch } from '../business/branch-scope';
import {
  Audience,
  MARKETING,
  MARKETING_PUSHES_PER_WEEK,
  NotificationRef,
  audienceOf,
  categoryOf,
  inWindow,
  linkFor,
  localMinutes,
  nextLocalTime,
  ruleFor,
} from './notification-catalog';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { DATE_TAGS, asLocale, msg, say } from '../i18n/say';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushService } from './push.service';
import { NotificationsGateway } from './notifications.gateway';

/** Give up after this many failed sends; the delivery stays FAILED for inspection. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** How long a message's email waits for it to be read in the app first (§287). */
export const MESSAGE_EMAIL_WAIT_MS = 10 * 60 * 1000;

/** The morning summary of a seller's bookings goes at this local time (§287). */
export const DIGEST_AT_MINUTES = 7 * 60;

type NotifyContext = AppointmentContext & { inviterEmail?: string; role?: string };

/** One planned way of sending a notification. */
type Plan = { channel: NotificationChannel; status: NotificationStatus; dueAt: Date; lastError?: string };

/** The button on a seller's or an administrator's email, by what the notice is about. */
const BUTTON: Partial<Record<NotificationCategory, string>> = {
  BOOKINGS: msg('See bookings'),
  MESSAGES: msg('Read and reply'),
  REVIEWS: msg('See reviews'),
  MONEY: msg('Getting paid'),
  ADMIN_TICKETS: 'Open the ticket',
  ADMIN_QUEUE: 'Open the queue',
  ADMIN_SYSTEM: 'Open settings',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly timeZone: string;
  private readonly businessAppUrl: string;
  private readonly adminAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(NOTIFICATION_CHANNEL) private readonly driver: NotificationChannelDriver,
    private readonly preferences: NotificationPreferencesService,
    private readonly push: PushService,
    @Optional() private readonly live?: NotificationsGateway,
  ) {
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Kigali';
    this.businessAppUrl = (config.get<string>('BUSINESS_APP_URL') ?? 'http://localhost:5174').replace(/\/$/, '');
    this.adminAppUrl = (config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  /**
   * Records a notification in the person's list, and sends it the ways they
   * chose (§287): by email, as a push, both, or neither — the list always has
   * it. What can wait for the morning waits; a message's email waits a little
   * to see whether it was read in the app first.
   *
   * NEVER throws. A notification is a side effect of something that already
   * happened — a booking, a payment, a cancellation — and none of those should
   * roll back because a mail server was briefly unreachable. Failures are
   * recorded on the delivery and tried again by the sweep. Returns the new
   * notification's id, or null when there was nobody to tell.
   */
  async notify(params: {
    recipientId: string;
    type: NotificationType;
    context: NotifyContext;
    appointmentId?: string;
    /** What it is about, for where it opens. */
    ref?: NotificationRef;
    /** For announcements and shops' messages: what kind it counts as. */
    category?: NotificationCategory;
    /** Where it opens, when the type alone cannot say. */
    link?: string | null;
    /** The email button's words, with `link`. */
    linkLabel?: string | null;
    announcementId?: string;
    shopMessageId?: string;
    /** Narrower than the person's own choices: an announcement sent without email. */
    channels?: { email?: boolean; push?: boolean };
    /** Made now, sent by the sweep: for one message going to many people. */
    deferSend?: boolean;
  }): Promise<string | null> {
    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: params.recipientId },
        select: {
          id: true,
          role: true,
          closedAt: true,
          quietHoursOn: true,
          quietFrom: true,
          quietTo: true,
          bookingEmailDigest: true,
          locale: true,
        },
      });
      // A closed account is told nothing more.
      if (!recipient || recipient.closedAt) return null;

      const audience = audienceOf(recipient.role);
      const category = params.category ?? categoryOf(params.type, audience);
      // Written once, in the language this person reads (§308): the list,
      // the push and the email all carry these words.
      const { subject, body } = renderNotification(params.type, {
        ...params.context,
        timeZone: this.timeZone,
        audience,
        locale: asLocale(recipient.locale),
      });
      const ref: NotificationRef = { appointmentId: params.appointmentId, ...params.ref };
      const link = params.link !== undefined ? params.link : linkFor(params.type, audience, ref);

      const plans = await this.plan(recipient, audience, category, ref.threadId ?? null, params.channels);

      const notification = await this.prisma.notification.create({
        data: {
          recipientId: params.recipientId,
          type: params.type,
          category,
          subject,
          body,
          link,
          threadId: ref.threadId ?? null,
          appointmentId: params.appointmentId,
          announcementId: params.announcementId,
          shopMessageId: params.shopMessageId,
          deliveries: { create: plans },
        },
        select: { id: true, deliveries: { select: { id: true, status: true, dueAt: true } } },
      });

      this.live?.announce(params.recipientId, { id: notification.id, type: params.type, subject });

      if (!params.deferSend) {
        const now = Date.now();
        for (const delivery of notification.deliveries) {
          if (delivery.status === NotificationStatus.PENDING && delivery.dueAt.getTime() <= now) {
            await this.deliver(delivery.id);
          }
        }
      }
      return notification.id;
    } catch (error) {
      // Even creating the row must not break the caller.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to raise ${params.type} notification for ${params.recipientId}: ${message}`);
      return null;
    }
  }

  /**
   * Which ways one notification goes, and when (§287). A channel the person
   * turned off is simply not planned; a push that can wait out quiet hours is
   * planned for the morning; a seller's booking emails can wait for one
   * morning summary; marketing pushes stop at a few a week.
   */
  private async plan(
    recipient: { id: string; quietHoursOn: boolean; quietFrom: number; quietTo: number; bookingEmailDigest: boolean },
    audience: Audience,
    category: NotificationCategory,
    threadId: string | null,
    only?: { email?: boolean; push?: boolean },
  ): Promise<Plan[]> {
    const now = new Date();
    const choices = await this.preferences.choicesOf(recipient.id);
    const rule = ruleFor(audience, category);
    const plans: Plan[] = [];

    let pushPlanned = false;
    if (only?.push !== false && this.preferences.isOn(choices, audience, category, NotificationChannel.PUSH)) {
      if (await this.push.hasDevices(recipient.id)) {
        if (
          MARKETING.includes(category) &&
          (await this.marketingPushesThisWeek(recipient.id)) >= MARKETING_PUSHES_PER_WEEK
        ) {
          plans.push({
            channel: NotificationChannel.PUSH,
            status: NotificationStatus.SKIPPED,
            dueAt: now,
            lastError: 'A few marketing pushes a week at most.',
          });
        } else {
          const quiet =
            rule?.canWait &&
            recipient.quietHoursOn &&
            inWindow(localMinutes(now, this.timeZone), recipient.quietFrom, recipient.quietTo);
          plans.push({
            channel: NotificationChannel.PUSH,
            status: NotificationStatus.PENDING,
            dueAt: quiet ? nextLocalTime(now, this.timeZone, recipient.quietTo) : now,
          });
          pushPlanned = true;
        }
      }
    }

    if (only?.email !== false && this.preferences.isOn(choices, audience, category, NotificationChannel.EMAIL)) {
      if (audience === 'BUSINESS' && category === NotificationCategory.BOOKINGS && recipient.bookingEmailDigest) {
        plans.push({
          channel: NotificationChannel.EMAIL,
          status: NotificationStatus.HELD,
          dueAt: nextLocalTime(now, this.timeZone, DIGEST_AT_MINUTES),
        });
      } else if (category === NotificationCategory.MESSAGES && threadId && pushPlanned) {
        plans.push({
          channel: NotificationChannel.EMAIL,
          status: NotificationStatus.PENDING,
          dueAt: new Date(now.getTime() + MESSAGE_EMAIL_WAIT_MS),
        });
      } else {
        plans.push({ channel: NotificationChannel.EMAIL, status: NotificationStatus.PENDING, dueAt: now });
      }
    }
    return plans;
  }

  private marketingPushesThisWeek(userId: string) {
    return this.prisma.notificationDelivery.count({
      where: {
        channel: NotificationChannel.PUSH,
        status: { in: [NotificationStatus.PENDING, NotificationStatus.SENDING, NotificationStatus.SENT] },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        notification: { recipientId: userId, category: { in: MARKETING } },
      },
    });
  }

  /**
   * Sends to an email address that has no account yet.
   *
   * Business invitations are the case: the whole point is to reach someone who
   * has not signed up, and Notification.recipientId is a foreign key to users,
   * so there is no row to create. The message is rendered by the same templates
   * and sent through the same channel — it simply has no inbox entry, which is
   * correct, because there is no inbox to put it in.
   */
  async notifyUnregisteredEmail(params: {
    email: string;
    type: NotificationType;
    context: NotifyContext;
    /** Nobody to ask yet: the language of the person inviting them (§308). */
    locale?: Locale;
  }): Promise<void> {
    try {
      // An administrator's invitation is to the English-only console.
      const l = params.context.role === 'ADMIN' ? DEFAULT_LOCALE : (params.locale ?? DEFAULT_LOCALE);
      const { subject, body } = renderNotification(params.type, {
        ...params.context,
        timeZone: this.timeZone,
        locale: l,
      });
      const app = params.context.role === 'ADMIN' ? this.adminAppUrl : this.businessAppUrl;
      const { email } = noticeEmail({
        type: params.type,
        audience: params.context.role === 'ADMIN' ? 'ADMIN' : 'BUSINESS',
        subject,
        body,
        button: { label: say(l, 'Sign in to accept'), url: `${app}/login` },
        footer: {
          reason: say(l, 'You get this because someone invited this address.'),
          manage: { label: say(l, 'If you did not expect it, you can ignore it.') },
        },
        locale: l,
        booking: null,
        arrivalCode: null,
        author: null,
        timeZone: this.timeZone,
      });
      await this.driver.send({ destination: params.email, subject, body, email: { design: email } });
      this.logger.log(`Sent ${params.type} to ${params.email} (no account yet, so no inbox row).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // No row exists to retry from, so this is logged and dropped. An owner
      // whose invitee never received an email can revoke and re-invite.
      this.logger.error(`Failed to send ${params.type} to unregistered ${params.email}: ${message}`);
    }
  }

  /**
   * Notifies the ACTIVE members of a business who should hear it (§277): about
   * a booking or a review, those who look after its branch; about the money,
   * those who may read it; about the business itself, everyone. Each then
   * gets it the ways they chose (§287).
   */
  async notifyBusiness(params: {
    businessId: string;
    type: NotificationType;
    context: AppointmentContext;
    appointmentId?: string;
    /** The branch it is about. Left out with an `appointmentId`, the booking's. */
    locationId?: string | null;
    /** Only those who may read the money — the owner and every-branch managers. */
    moneyOnly?: boolean;
    ref?: NotificationRef;
    /** What kind it counts as, and where it opens, when the type alone cannot say (§297). */
    category?: NotificationCategory;
    link?: string | null;
    /** Somebody already told another way — the person whose help request it answers. */
    except?: string | null;
  }): Promise<void> {
    const branch =
      params.locationId !== undefined
        ? params.locationId
        : params.appointmentId
          ? ((
              await this.prisma.appointment.findUnique({
                where: { id: params.appointmentId },
                select: { locationId: true },
              })
            )?.locationId ?? null)
          : undefined;

    const members = await this.prisma.businessMembership.findMany({
      where: {
        businessProfileId: params.businessId,
        status: BusinessMemberStatus.ACTIVE,
        AND: [...(branch !== undefined ? [membersOfBranch(branch)] : []), ...(params.moneyOnly ? [MONEY_READERS] : [])],
      },
      select: { userId: true },
    });

    // Everyone it concerns, not just the owner: staff run the day's
    // appointments (§16.6), so a booking nobody on that floor hears about is
    // the problem this module exists to fix — and a booking at another
    // branch is noise to them (§277). How each hears is their own choice (§287).
    await Promise.all(
      members
        .filter((member) => member.userId !== params.except)
        .map((member) =>
          this.notify({
            recipientId: member.userId,
            type: params.type,
            context: params.context,
            appointmentId: params.appointmentId,
            ref: params.ref,
            ...(params.category ? { category: params.category } : {}),
            ...(params.link !== undefined ? { link: params.link } : {}),
          }),
        ),
    );
  }

  /** Every administrator whose account is open (§287: one place, closed accounts left out). */
  async notifyAdmins(params: { type: NotificationType; context: NotifyContext; ref?: NotificationRef }) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, closedAt: null },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notify({ recipientId: admin.id, type: params.type, context: params.context, ref: params.ref }),
      ),
    );
    return admins.length;
  }

  // ---------- Sending ----------

  /**
   * Sends one delivery, recording the outcome either way (§287). Claimed
   * first, so the sweep and an inline send can never both send it.
   */
  async deliver(deliveryId: string): Promise<boolean> {
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] } },
      data: { status: NotificationStatus.SENDING, attempts: { increment: 1 } },
    });
    if (count === 0) return false;

    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        channel: true,
        attempts: true,
        notification: {
          select: {
            id: true,
            type: true,
            category: true,
            subject: true,
            body: true,
            link: true,
            threadId: true,
            readAt: true,
            createdAt: true,
            appointmentId: true,
            announcement: { select: { linkLabel: true } },
            shopMessage: { select: { business: { select: { name: true, logoUrl: true } } } },
            recipient: { select: { id: true, email: true, role: true, locale: true } },
          },
        },
      },
    });
    if (!delivery) return false;
    const n = delivery.notification;

    try {
      if (delivery.channel === NotificationChannel.PUSH) {
        if (n.readAt) return this.finish(delivery.id, NotificationStatus.SKIPPED, 'Read in the app before it went.');
        const unread = await this.prisma.notification.count({
          where: { recipientId: n.recipient.id, readAt: null, dismissedAt: null },
        });
        const result = await this.push.sendToUser(n.recipient.id, {
          title: n.subject,
          body: pushText(n.type, n.body),
          link: n.link,
          notificationId: n.id,
          badge: unread,
        });
        if (result.devices === 0)
          return this.finish(delivery.id, NotificationStatus.SKIPPED, 'No phone or browser to send to.');
        if (result.sent === 0)
          return this.fail(delivery.id, delivery.attempts, result.errors.join('; ') || 'Not sent.');
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            lastError: result.errors.length ? result.errors.join('; ').slice(0, 500) : null,
            pushTickets: result.tickets.length ? result.tickets : Prisma.JsonNull,
          },
        });
        return true;
      }

      // Email. A message read in the app since needs no email after it (§287).
      if (n.category === NotificationCategory.MESSAGES && (n.readAt || (await this.threadReadSince(n)))) {
        return this.finish(delivery.id, NotificationStatus.SKIPPED, 'Read in the app before the email went.');
      }
      if (!this.driver.isConfigured()) return this.fail(delivery.id, delivery.attempts, 'Channel not configured.');

      await this.driver.send(await this.emailFor(n));
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
      });
      this.logger.log(`Sent ${n.type} by email to ${n.recipient.email} (${n.id}).`);
      return true;
    } catch (error) {
      return this.fail(delivery.id, delivery.attempts, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * The email for one notification (§287, §292): in the platform's design,
   * with the booking it is about drawn as a ticket, why it came, and how to
   * stop it.
   */
  private async emailFor(n: {
    id: string;
    type: NotificationType;
    category: NotificationCategory;
    subject: string;
    body: string;
    link: string | null;
    appointmentId: string | null;
    announcement: { linkLabel: string | null } | null;
    shopMessage: { business: { name: string | null; logoUrl: string | null } } | null;
    recipient: { id: string; email: string; role: UserRole; locale: string };
  }): Promise<OutboundMessage> {
    const audience = audienceOf(n.recipient.role);
    const rule = ruleFor(audience, n.category);
    const app = audience === 'ADMIN' ? this.adminAppUrl : audience === 'BUSINESS' ? this.businessAppUrl : null;
    // The email around the words in the reader's language too (§308); the console's people read English.
    const l = audience === 'ADMIN' ? DEFAULT_LOCALE : asLocale(n.recipient.locale);
    const topic = (
      n.type === NotificationType.ANNOUNCEMENT ? say(l, 'news from us') : rule ? say(l, rule.title) : say(l, 'this')
    ).toLocaleLowerCase(DATE_TAGS[l]);
    const locked = Boolean(rule?.email?.locked);

    // The booking as it is now, so the ticket says where it stands; the
    // customer's arrival code beside it, where they will need it (§54.2).
    const row = n.appointmentId
      ? await this.prisma.appointment.findUnique({
          where: { id: n.appointmentId },
          select: { ...BOOKING_FACTS_SELECT, verificationCode: true },
        })
      : null;

    const { email, calendar } = noticeEmail({
      type: n.type,
      audience,
      subject: n.subject,
      body: n.body,
      // Customers open the phone app; a link would only open a browser.
      button:
        app && n.link
          ? {
              label: n.announcement?.linkLabel || say(l, BUTTON[n.category] ?? msg('Open')),
              url: `${app}${n.link}`,
            }
          : null,
      footer: {
        reason: locked
          ? say(l, 'You always get emails about {topic}.', { topic })
          : say(l, 'You get emails about {topic} because they are turned on.', { topic }),
        manage: app
          ? { label: say(l, 'Change what we send'), url: `${app}/notifications` }
          : { label: say(l, 'Change what we send in the app, under Account → Notifications.') },
        unsubscribeUrl: locked ? null : this.preferences.unsubscribeUrl(n.recipient.id, n.category),
      },
      locale: l,
      booking: row ? bookingFacts(row) : null,
      arrivalCode: audience === 'CUSTOMER' ? (row?.verificationCode ?? null) : null,
      author: n.shopMessage
        ? { name: n.shopMessage.business.name ?? say(l, 'A shop you follow'), logoUrl: n.shopMessage.business.logoUrl }
        : null,
      timeZone: this.timeZone,
    });
    return {
      destination: n.recipient.email,
      subject: n.subject,
      body: n.body,
      email: { design: email, unsubscribeUrl: email.footer.unsubscribeUrl ?? null, calendar },
    };
  }

  private async threadReadSince(n: { threadId: string | null; createdAt: Date; recipient: { id: string } }) {
    if (!n.threadId) return false;
    const state = await this.prisma.threadReadState.findUnique({
      where: { threadId_userId: { threadId: n.threadId, userId: n.recipient.id } },
      select: { lastReadAt: true },
    });
    return Boolean(state && state.lastReadAt >= n.createdAt);
  }

  private async finish(id: string, status: NotificationStatus, note: string) {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { status, lastError: note },
    });
    return false;
  }

  private async fail(id: string, attempts: number, error: string) {
    // Tried again later, waiting longer each time, up to an hour.
    const wait = Math.min(2 ** attempts, 60) * 60 * 1000;
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: NotificationStatus.FAILED,
        lastError: error.slice(0, 500),
        dueAt: new Date(Date.now() + wait),
      },
    });
    this.logger.warn(`Delivery ${id} failed (attempt ${attempts}/${MAX_NOTIFICATION_ATTEMPTS}): ${error}`);
    return false;
  }

  /**
   * The sweep (§287): everything due — a push held for the morning, a
   * message's email after its wait, a failure ready for another try, a send
   * interrupted half-way — and then the morning summaries.
   */
  async deliverDue(limit = 200): Promise<{ attempted: number; delivered: number; summaries: number }> {
    const now = new Date();
    // A send interrupted half-way (a restart) is tried again, not lost.
    await this.prisma.notificationDelivery.updateMany({
      where: { status: NotificationStatus.SENDING, updatedAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } },
      data: { status: NotificationStatus.PENDING },
    });
    const due = await this.prisma.notificationDelivery.findMany({
      where: {
        dueAt: { lte: now },
        OR: [
          { status: NotificationStatus.PENDING },
          { status: NotificationStatus.FAILED, attempts: { lt: MAX_NOTIFICATION_ATTEMPTS } },
        ],
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let delivered = 0;
    for (const delivery of due) {
      if (await this.deliver(delivery.id)) delivered++;
    }
    const summaries = await this.sendSummaries(now);
    return { attempted: due.length, delivered, summaries };
  }

  /**
   * The morning summary (§287): every booking email a seller asked to have
   * together, as one email, listing each.
   */
  private async sendSummaries(now: Date): Promise<number> {
    const held = await this.prisma.notificationDelivery.findMany({
      where: { status: NotificationStatus.HELD, channel: NotificationChannel.EMAIL, dueAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        attempts: true,
        notification: {
          select: {
            subject: true,
            createdAt: true,
            recipient: { select: { id: true, email: true, locale: true } },
          },
        },
      },
    });
    if (held.length === 0 || !this.driver.isConfigured()) return 0;

    const byPerson = new Map<string, typeof held>();
    for (const d of held) {
      const list = byPerson.get(d.notification.recipient.id) ?? [];
      list.push(d);
      byPerson.set(d.notification.recipient.id, list);
    }

    let sent = 0;
    for (const [, list] of byPerson) {
      const email = list[0].notification.recipient.email;
      const locale = asLocale(list[0].notification.recipient.locale);
      const clock = new Intl.DateTimeFormat(DATE_TAGS[locale], {
        timeZone: this.timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const summary = summaryEmail({
        items: list.map((d) => ({ at: clock.format(d.notification.createdAt), subject: d.notification.subject })),
        appUrl: this.businessAppUrl,
        locale,
      });
      try {
        await this.driver.send({
          destination: email,
          subject: summary.subject,
          body: summary.body,
          email: { design: summary.email },
        });
        await this.prisma.notificationDelivery.updateMany({
          where: { id: { in: list.map((d) => d.id) } },
          data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
        });
        sent++;
      } catch (error) {
        await this.prisma.notificationDelivery.updateMany({
          where: { id: { in: list.map((d) => d.id) } },
          data: {
            attempts: { increment: 1 },
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            dueAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
      }
    }
    return sent;
  }

  /** Expo's receipts for pushes sent 15 minutes to a day ago (§287). */
  async checkPushReceipts(): Promise<number> {
    const now = Date.now();
    const sent = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.SENT,
        receiptsCheckedAt: null,
        pushTickets: { not: Prisma.AnyNull },
        sentAt: { lte: new Date(now - 15 * 60 * 1000), gte: new Date(now - 24 * 60 * 60 * 1000) },
      },
      take: 300,
      select: { id: true, pushTickets: true },
    });
    if (sent.length === 0) return 0;
    const tickets = sent.flatMap((d) => (d.pushTickets as Array<{ deviceId: string; ticketId: string }> | null) ?? []);
    const gone = await this.push.checkReceipts(tickets);
    await this.prisma.notificationDelivery.updateMany({
      where: { id: { in: sent.map((d) => d.id) } },
      data: { receiptsCheckedAt: new Date() },
    });
    return gone;
  }

  // ---------- Inbox ----------

  async list(recipientId: string, unreadOnly: boolean, limit: number, offset: number) {
    // A dismissed one is gone from the inbox and from the badge (§159).
    const where: Prisma.NotificationWhereInput = {
      recipientId,
      dismissedAt: null,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [total, unread, notifications] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientId, readAt: null, dismissedAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: NOTIFICATION_SELECT,
      }),
    ]);

    return { total, unread, limit, offset, notifications };
  }

  /**
   * Marks one notification read.
   *
   * Scoped by recipientId, so someone else's notification simply matches no
   * row — the same structural ownership rule used everywhere else.
   */
  async markRead(recipientId: string, notificationId: string): Promise<MarkReadDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, readAt: null },
      data: { readAt: new Date() },
    });

    if (count === 0) {
      // Either it is not theirs, or it was already read. Both are fine to
      // report as success — marking read is idempotent — but a missing row
      // must not leak that someone else's notification exists.
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, recipientId },
      });
      if (exists === 0) return { message: 'Notification not found.', updated: false };
    }

    return { message: 'Notification marked as read.', updated: count > 0 };
  }

  async markAllRead(recipientId: string): Promise<MarkAllReadDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
    return { message: `${count} notification(s) marked as read.`, updated: count };
  }

  /**
   * Takes one off the list (§159). Marked, never deleted — the row is also the
   * record of the email that was sent. Someone else's, or one already gone,
   * matches no row and is reported as not found without saying which.
   */
  async dismiss(recipientId: string, notificationId: string): Promise<DismissedDto> {
    const now = new Date();
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, dismissedAt: null },
      // Taking it off the list is also having seen it.
      data: { dismissedAt: now, readAt: now },
    });
    if (count === 0) throw new NotFoundException('Notification not found.');
    return { id: notificationId, dismissed: true };
  }

  /**
   * Puts one back (§160). The one thing removing by swipe needs: a thumb that
   * slipped. It comes back as read — it was seen, or it would not have been
   * swiped — and in its old place, since nothing about it changed.
   */
  async restore(recipientId: string, notificationId: string): Promise<DismissedDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, dismissedAt: { not: null } },
      data: { dismissedAt: null },
    });
    if (count === 0) throw new NotFoundException('Notification not found.');
    return { id: notificationId, dismissed: false };
  }

  /**
   * Clears every notification already read: what "tidy up" means (§159). The
   * ids come back so an undo can put exactly these back (§162).
   */
  async dismissRead(recipientId: string): Promise<DismissedManyDto> {
    const rows = await this.prisma.notification.findMany({
      where: { recipientId, readAt: { not: null }, dismissedAt: null },
      select: { id: true },
    });
    return this.dismissMany(
      recipientId,
      rows.map((r) => r.id),
    );
  }

  /** Several at once, from a selection (§162). Only the caller's own rows move. */
  async dismissMany(recipientId: string, ids: string[]): Promise<DismissedManyDto> {
    if (ids.length === 0) return { dismissed: 0, ids: [] };
    const mine = await this.prisma.notification.findMany({
      where: { id: { in: ids }, recipientId, dismissedAt: null },
      select: { id: true },
    });
    const now = new Date();
    const { count } = await this.prisma.notification.updateMany({
      where: { id: { in: mine.map((r) => r.id) } },
      data: { dismissedAt: now, readAt: now },
    });
    return { dismissed: count, ids: mine.map((r) => r.id) };
  }

  /** The undo for a selection or a clear (§162). */
  async restoreMany(recipientId: string, ids: string[]): Promise<RestoredManyDto> {
    if (ids.length === 0) return { restored: 0 };
    const { count } = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, recipientId, dismissedAt: { not: null } },
      data: { dismissedAt: null },
    });
    return { restored: count };
  }

  async markReadMany(recipientId: string, ids: string[]): Promise<ReadManyDto> {
    if (ids.length === 0) return { updated: 0 };
    const { count } = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, recipientId, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}

/** A push's words: a message's own first line, or the notice's first paragraph. */
export function pushText(type: NotificationType, body: string): string {
  const paragraphs = body
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const quoted = type === NotificationType.NEW_MESSAGE ? paragraphs.find((p) => p.startsWith('"')) : undefined;
  const text = quoted ? quoted.replace(/^"|"$/g, '') : (paragraphs[0] ?? '');
  return text.length > 178 ? `${text.slice(0, 175)}…` : text;
}
