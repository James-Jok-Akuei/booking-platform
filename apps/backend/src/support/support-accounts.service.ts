import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  NotificationCategory,
  NotificationType,
  SupportActionKind,
  UserRole,
} from '@prisma/client';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { asLocale, say } from '../i18n/say';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountService } from '../users/account.service';
import { INVITATION_TTL_DAYS } from '../business/members.service';
import { MARKETING } from '../notifications/notification-catalog';
import { SupportActor, SupportInput, SupportLogService } from './support-log.service';

type Words = (l: Locale) => { title: string; body: string };

/**
 * A notice with no booking in it: a title and the words (§297), written out
 * for each reader in their own language (§308).
 */
const notice = (words: Words, businessName = '') => {
  const english = words(DEFAULT_LOCALE);
  return {
    serviceName: english.title,
    reason: english.body,
    locationName: '',
    businessName,
    startTime: undefined as unknown as Date,
    compose: (l: Locale) => {
      const { title, body } = words(l);
      return { subject: title, body };
    },
  };
};

/** Our team's reason, as its own paragraph. */
const because = (l: Locale, reason: string) => say(l, 'Reason: {reason}', { reason: reason.trim() });

/**
 * What our support team can do for a shop or a person when they cannot do it
 * themselves (§297): pause or open a shop, look after its team, hand it to a
 * new owner, sign someone out of every phone, stop the marketing, close an
 * account. Each is the same change the shop or person could make — with the
 * same rules — plus a reason, a line in the log, a note in the help request,
 * and a notice to whoever it concerns.
 */
@Injectable()
export class SupportAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly account: AccountService,
    private readonly support: SupportLogService,
  ) {}

  // ---------- Shops ----------

  /** What support needs to help a shop: whether it is paused, its team, its waiting invitations. */
  async shop(actor: SupportActor, businessId: string) {
    this.support.check(actor, { reason: 'reading' });
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        pausedAt: true,
        members: {
          where: { status: BusinessMemberStatus.ACTIVE },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            role: true,
            allLocations: true,
            createdAt: true,
            user: { select: { id: true, email: true } },
          },
        },
        invitations: {
          where: { status: InvitationStatus.PENDING },
          orderBy: { createdAt: 'desc' },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found.');
    const now = Date.now();
    return {
      id: business.id,
      pausedAt: business.pausedAt?.toISOString() ?? null,
      members: business.members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        email: m.user.email,
        role: m.role,
        allLocations: m.allLocations,
        createdAt: m.createdAt.toISOString(),
      })),
      invitations: business.invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() <= now,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Pauses or opens a shop for its owner (§119.3 rules): no new bookings while
   * paused, and the ones made still happen. The shop can open itself again.
   */
  async setPaused(actor: SupportActor, businessId: string, paused: boolean, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const updated = await this.account.setPaused(businessId, paused, 'our support team');
    await this.support.record(actor, {
      kind: paused ? SupportActionKind.PAUSE_SHOP : SupportActionKind.RESUME_SHOP,
      reason: dto.reason,
      businessId,
      ticketId: ticket?.id,
      ticketNote: (l) =>
        paused
          ? say(l, 'We paused your shop: no new bookings until it is opened again. Bookings already made still happen.')
          : say(l, 'We opened your shop again: customers can book it.'),
    });
    await this.tellShop(
      businessId,
      (l) =>
        paused
          ? {
              title: say(l, 'Our support team paused your shop'),
              body:
                say(
                  l,
                  'Customers cannot make new bookings while it is paused. Bookings already made still happen. You can open it again yourself in Your shop.',
                ) + `\n\n${because(l, dto.reason)}`,
            }
          : {
              title: say(l, 'Our support team opened your shop again'),
              body: `${say(l, 'Customers can find and book you again.')}\n\n${because(l, dto.reason)}`,
            },
      ticket,
      '/profile',
    );
    return {
      message: paused ? 'The shop is paused.' : 'The shop is open again.',
      pausedAt: updated.pausedAt?.toISOString() ?? null,
    };
  }

  /** Takes back an invitation the owner cannot reach to take back. */
  async revokeInvitation(actor: SupportActor, businessId: string, invitationId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const invitation = await this.invitation(businessId, invitationId);
    await this.prisma.businessInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });
    await this.support.record(actor, {
      kind: SupportActionKind.REVOKE_INVITATION,
      reason: dto.reason,
      businessId,
      ticketId: ticket?.id,
      details: { email: invitation.email, role: invitation.role },
      ticketNote: (l) =>
        say(l, 'We took back the invitation for {email}. They can no longer join with it.', { email: invitation.email }),
    });
    await this.tellShop(
      businessId,
      (l) => ({
        title: say(l, 'An invitation was taken back'),
        body:
          say(l, 'Our support team took back the invitation for {email}.', { email: invitation.email }) +
          `\n\n${because(l, dto.reason)}`,
      }),
      ticket,
      '/people',
      true,
    );
    return { message: `The invitation for ${invitation.email} is taken back.` };
  }

  /**
   * Sends an invitation again — the email went to spam, or the week ran out —
   * with a fresh week to accept. It is the same invitation: same person, same
   * role, same branches.
   */
  async resendInvitation(actor: SupportActor, businessId: string, invitationId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const invitation = await this.invitation(businessId, invitationId);
    const taken = await this.prisma.businessMembership.findFirst({
      where: { status: BusinessMemberStatus.ACTIVE, user: { email: invitation.email } },
      select: { id: true },
    });
    if (taken)
      throw new BadRequestException(`${invitation.email} is already in a team, so this invitation cannot be used.`);

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.businessInvitation.update({ where: { id: invitationId }, data: { expiresAt } });

    const existing = await this.prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    const context = {
      serviceName: '',
      locationName: '',
      businessName: invitation.business.name ?? 'a business',
      startTime: undefined as unknown as Date,
      inviterEmail: invitation.invitedBy.email,
      role: invitation.role,
    };
    if (existing) {
      await this.notifications.notify({
        recipientId: existing.id,
        type: NotificationType.BUSINESS_INVITATION,
        context,
      });
    } else {
      await this.notifications.notifyUnregisteredEmail({
        email: invitation.email,
        type: NotificationType.BUSINESS_INVITATION,
        context,
        locale: asLocale(invitation.invitedBy.locale),
      });
    }
    await this.support.record(actor, {
      kind: SupportActionKind.RESEND_INVITATION,
      reason: dto.reason,
      businessId,
      ticketId: ticket?.id,
      details: { email: invitation.email, expiresAt: expiresAt.toISOString() },
      ticketNote: (l) =>
        say(l, 'We sent the invitation to {email} again. It can be accepted for {days} days.', {
          email: invitation.email,
          days: INVITATION_TTL_DAYS,
        }),
    });
    return { message: `Sent to ${invitation.email} again, good for ${INVITATION_TTL_DAYS} days.` };
  }

  /**
   * Takes someone out of a team — the owner cannot sign in, and a person who
   * left still has the keys. The owner is never removed here: ownership is
   * handed over instead.
   */
  async removeMember(actor: SupportActor, businessId: string, membershipId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const member = await this.member(businessId, membershipId);
    if (member.role === BusinessMemberRole.OWNER) {
      throw new BadRequestException('The owner cannot be removed. Hand the shop to someone else first.');
    }
    if (member.status !== BusinessMemberStatus.ACTIVE)
      throw new BadRequestException('This person is already out of the team.');

    await this.prisma.businessMembership.update({
      where: { id: membershipId },
      data: { status: BusinessMemberStatus.REMOVED },
    });
    await this.support.record(actor, {
      kind: SupportActionKind.REMOVE_MEMBER,
      reason: dto.reason,
      businessId,
      userId: member.userId,
      ticketId: ticket?.id,
      details: { email: member.user.email, role: member.role },
      ticketNote: (l) =>
        say(l, 'We took {email} out of the team. They can no longer open the shop.', { email: member.user.email }),
    });
    await this.notifications.notify({
      recipientId: member.userId,
      type: NotificationType.SUPPORT_UPDATE,
      context: notice((l) => ({
        title: member.business.name
          ? say(l, 'You are no longer in the team at {shop}', { shop: member.business.name })
          : say(l, 'You are no longer in the team at the shop'),
        body: say(
          l,
          'Our support team took you out of the team, so you can no longer open this shop. If you think this is a mistake, ask the shop’s owner.',
        ),
      })),
      category: NotificationCategory.ACCOUNT,
      link: null,
    });
    await this.tellShop(
      businessId,
      (l) => ({
        title: say(l, 'Someone was taken out of your team'),
        body:
          say(l, 'Our support team took {email} out of your team.', { email: member.user.email }) +
          `\n\n${because(l, dto.reason)}`,
      }),
      ticket,
      '/people',
      true,
    );
    return { message: `${member.user.email} is out of the team.` };
  }

  /**
   * Hands a shop to someone already in its team (§297) — the owner left, sold
   * it, or lost their email. The primary administrator only, with a code
   * typed in the last few minutes: it gives one person the money and the keys.
   * The old owner stays, as a manager of every branch, for the new owner to
   * keep or remove.
   */
  async transferOwnership(actor: SupportActor, businessId: string, membershipId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    await this.assertPrimary(actor);
    const ticket = await this.support.ticket(dto.ticketId);
    const next = await this.member(businessId, membershipId);
    if (next.status !== BusinessMemberStatus.ACTIVE) {
      throw new BadRequestException(
        'Only someone in the team can become the owner. Ask the shop to invite them first.',
      );
    }
    if (next.role === BusinessMemberRole.OWNER) throw new BadRequestException('This person is already the owner.');
    const closed = await this.prisma.user.findUnique({ where: { id: next.userId }, select: { closedAt: true } });
    if (closed?.closedAt) throw new BadRequestException('That account is closed.');

    const owners = await this.prisma.businessMembership.findMany({
      where: { businessProfileId: businessId, role: BusinessMemberRole.OWNER, status: BusinessMemberStatus.ACTIVE },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const owner of owners) {
        await tx.membershipLocation.deleteMany({ where: { membershipId: owner.id } });
        await tx.businessMembership.update({
          where: { id: owner.id },
          data: { role: BusinessMemberRole.MANAGER, allLocations: true },
        });
      }
      // An owner looks after every branch; the old choice of branches goes.
      await tx.membershipLocation.deleteMany({ where: { membershipId } });
      await tx.businessMembership.update({
        where: { id: membershipId },
        data: { role: BusinessMemberRole.OWNER, allLocations: true },
      });
      await this.support.record(
        actor,
        {
          kind: SupportActionKind.TRANSFER_OWNERSHIP,
          reason: dto.reason,
          businessId,
          userId: next.userId,
          ticketId: ticket?.id,
          details: { to: next.user.email, from: owners.map((o) => o.user.email) },
          ticketNote: (l) =>
            say(l, 'We made {email} the owner of the shop. The old owner stays in the team as a manager.', {
              email: next.user.email,
            }),
        },
        tx,
      );
    });

    const shopName = next.business.name;
    await this.notifications.notify({
      recipientId: next.userId,
      type: NotificationType.SUPPORT_UPDATE,
      context: notice((l) => ({
        title: shopName
          ? say(l, 'You are now the owner of {shop}', { shop: shopName })
          : say(l, 'You are now the owner of the shop'),
        body: say(
          l,
          'Our support team made you the owner. You can now change the team, the payout number and everything else. The old owner is still in the team as a manager — keep them or take them out under Team.',
        ),
      })),
      category: NotificationCategory.ACCOUNT,
      link: '/people',
    });
    for (const owner of owners) {
      await this.notifications.notify({
        recipientId: owner.userId,
        type: NotificationType.SUPPORT_UPDATE,
        context: notice((l) => ({
          title: shopName
            ? say(l, '{email} is now the owner of {shop}', { email: next.user.email, shop: shopName })
            : say(l, '{email} is now the owner of the shop', { email: next.user.email }),
          body:
            say(l, 'Our support team handed the shop to {email}. You are still in the team, as a manager of every branch.', {
              email: next.user.email,
            }) + `\n\n${because(l, dto.reason)}`,
        })),
        category: NotificationCategory.ACCOUNT,
        link: '/people',
      });
    }
    return { message: `${next.user.email} is now the owner.` };
  }

  // ---------- People ----------

  /** What support needs to help a person: their phones signed in, their marketing, whether it is closed. */
  async person(actor: SupportActor, userId: string) {
    this.support.check(actor, { reason: 'reading' });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, closedAt: true, offersOptInAt: true },
    });
    if (!user) throw new NotFoundException('Person not found.');
    const [signedIn, devices, marketing, shopOffers] = await Promise.all([
      this.openSignIns(userId),
      this.prisma.pushDevice.count({ where: { userId } }),
      this.prisma.notificationPreference.count({ where: { userId, category: { in: MARKETING }, enabled: true } }),
      this.prisma.shopFollow.count({ where: { userId, offersAt: { not: null } } }),
    ]);
    return {
      id: user.id,
      role: user.role,
      closedAt: user.closedAt?.toISOString() ?? null,
      signedInSessions: signedIn,
      pushDevices: devices,
      marketing: {
        newsChoicesOn: marketing,
        weeklyOffersEmail: user.offersOptInAt !== null,
        shopsSendingOffers: shopOffers,
      },
    };
  }

  /**
   * Signs a person out of every phone and browser — a lost phone, or someone
   * else got in. Push to those phones stops too: a stolen phone should not
   * keep showing their bookings.
   */
  async signOutEverywhere(actor: SupportActor, userId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const user = await this.personFor(userId);
    const now = new Date();
    const places = await this.openSignIns(userId);
    const [, , devices] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      // Off "where you are signed in" too (§298).
      this.prisma.authSession.updateMany({ where: { userId, endedAt: null }, data: { endedAt: now } }),
      this.prisma.pushDevice.deleteMany({ where: { userId } }),
    ]);
    const tokens = { count: places };
    await this.support.record(actor, {
      kind: SupportActionKind.SIGN_OUT_EVERYWHERE,
      reason: dto.reason,
      userId,
      ticketId: ticket?.id,
      details: { sessions: tokens.count, pushDevices: devices.count },
      ticketNote: (l) => say(l, 'We signed you out on every phone and computer. Sign in again with a code sent to your email.'),
    });
    if (user.id !== ticket?.reporterId) {
      await this.notifications.notify({
        recipientId: userId,
        type: NotificationType.SUPPORT_UPDATE,
        context: notice((l) => ({
          title: say(l, 'You were signed out everywhere'),
          body: say(
            l,
            'Our support team signed you out on every phone and computer. Sign in again with a code sent to this email. If you did not ask for this, reply to us in Help.',
          ),
        })),
        category: NotificationCategory.ACCOUNT,
        link: null,
      });
    }
    return { message: `Signed out of ${tokens.count} place${tokens.count === 1 ? '' : 's'}.` };
  }

  /**
   * Stops every marketing message — news, the weekly offers email, offers from
   * shops they follow — when someone asks us and cannot find the switches.
   * Their bookings, messages and account notices carry on. Each "no" is kept
   * like one they gave themselves (§287).
   */
  async stopMarketing(actor: SupportActor, userId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    await this.personFor(userId);
    const follows = await this.prisma.shopFollow.findMany({
      where: { userId, offersAt: { not: null } },
      select: { businessId: true },
    });
    const wording = 'Turned off by our support team, at their request.';
    await this.prisma.$transaction(async (tx) => {
      for (const category of MARKETING) {
        for (const channel of ['EMAIL', 'PUSH'] as const) {
          await tx.notificationPreference.upsert({
            where: { userId_category_channel: { userId, category, channel } },
            create: { userId, category, channel, enabled: false },
            update: { enabled: false },
          });
          await tx.consentRecord.create({
            data: {
              userId,
              purpose: `${category.toLowerCase()}.${channel.toLowerCase()}`,
              granted: false,
              wording,
              source: 'support',
            },
          });
        }
      }
      await tx.user.update({ where: { id: userId }, data: { offersOptInAt: null, offersToken: null } });
      await tx.shopFollow.updateMany({ where: { userId, offersAt: { not: null } }, data: { offersAt: null } });
      for (const follow of follows) {
        await tx.consentRecord.create({
          data: { userId, purpose: `shop:${follow.businessId}`, granted: false, wording, source: 'support' },
        });
      }
      await this.support.record(
        actor,
        {
          kind: SupportActionKind.STOP_MARKETING,
          reason: dto.reason,
          userId,
          ticketId: ticket?.id,
          details: { shops: follows.length },
          ticketNote: (l) =>
            say(
              l,
              'We turned off news, offers and the weekly email. You still hear about your bookings and messages. You can turn any of them back on in Notifications.',
            ),
        },
        tx,
      );
    });
    return { message: 'Marketing is off. Bookings and messages still come.' };
  }

  /**
   * Closes an account for its owner (§119 rules: nothing still to come, no
   * shop left without an owner). Never an administrator's — that is the
   * primary administrator's, in Admins. Told by email first, since the
   * address goes when it closes.
   */
  async closeAccount(actor: SupportActor, userId: string, dto: SupportInput) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const user = await this.personFor(userId);
    if (user.role === UserRole.ADMIN)
      throw new BadRequestException('An administrator is removed in Admins, not closed here.');

    await this.account.close(userId, {
      bySupport: true,
      beforeClosing: async () => {
        await this.notifications.notify({
          recipientId: userId,
          type: NotificationType.SUPPORT_UPDATE,
          context: notice((l) => ({
            title: say(l, 'Your account is closed'),
            body: say(
              l,
              'Our support team closed your account, as asked. Your bookings and reviews stay with the shops they belong to, with your name removed. You can make a new account with this email at any time.',
            ),
          })),
          category: NotificationCategory.ACCOUNT,
          link: null,
        });
      },
    });
    await this.support.record(actor, {
      kind: SupportActionKind.CLOSE_ACCOUNT,
      reason: dto.reason,
      userId,
      ticketId: ticket?.id,
      details: { email: user.email },
    });
    return { message: 'The account is closed.' };
  }

  // ---------- Helpers ----------

  /**
   * How many places someone is signed in (§298): sign-ins not ended with a
   * token still alive, plus live tokens from before sign-ins were kept.
   */
  private async openSignIns(userId: string) {
    const now = new Date();
    const live = { revokedAt: null, expiresAt: { gt: now } };
    const [sessions, legacy] = await Promise.all([
      this.prisma.authSession.count({ where: { userId, endedAt: null, refreshTokens: { some: live } } }),
      this.prisma.refreshToken.count({ where: { userId, sessionId: null, ...live } }),
    ]);
    return sessions + legacy;
  }

  /** A shop's team or invitations are notified like the shop's own changes: everyone, or the owner only. */
  private async tellShop(
    businessId: string,
    words: Words,
    ticket: { reporterId: string } | null,
    link: string,
    ownerOnly = false,
  ) {
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const except = ticket?.reporterId ?? null;
    if (ownerOnly) {
      const owners = await this.prisma.businessMembership.findMany({
        where: { businessProfileId: businessId, role: BusinessMemberRole.OWNER, status: BusinessMemberStatus.ACTIVE },
        select: { userId: true },
      });
      for (const owner of owners.filter((o) => o.userId !== except)) {
        await this.notifications.notify({
          recipientId: owner.userId,
          type: NotificationType.SUPPORT_UPDATE,
          context: notice(words, business?.name ?? ''),
          category: NotificationCategory.ACCOUNT,
          link,
        });
      }
      return;
    }
    await this.notifications.notifyBusiness({
      businessId,
      type: NotificationType.SUPPORT_UPDATE,
      context: notice(words, business?.name ?? ''),
      category: NotificationCategory.ACCOUNT,
      link,
      except,
    });
  }

  private async invitation(businessId: string, invitationId: string) {
    const invitation = await this.prisma.businessInvitation.findFirst({
      where: { id: invitationId, businessProfileId: businessId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        businessProfile: { select: { name: true } },
        invitedBy: { select: { email: true, locale: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(`This invitation is already ${invitation.status.toLowerCase()}.`);
    }
    return { ...invitation, business: invitation.businessProfile };
  }

  private async member(businessId: string, membershipId: string) {
    const member = await this.prisma.businessMembership.findFirst({
      where: { id: membershipId, businessProfileId: businessId },
      select: {
        id: true,
        role: true,
        status: true,
        userId: true,
        user: { select: { email: true } },
        businessProfile: { select: { name: true } },
      },
    });
    if (!member) throw new NotFoundException('Member not found.');
    return { ...member, business: member.businessProfile };
  }

  private async personFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, closedAt: true },
    });
    if (!user) throw new NotFoundException('Person not found.');
    if (user.closedAt) throw new BadRequestException('This account is closed.');
    return user;
  }

  /** Handing a shop over is the primary administrator's, like letting an administrator in (§242). */
  private async assertPrimary(actor: SupportActor) {
    const me = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { isPrimaryAdmin: true } });
    if (!me?.isPrimaryAdmin) {
      throw new ForbiddenException('Only the primary administrator can hand a shop to a new owner.');
    }
  }
}
