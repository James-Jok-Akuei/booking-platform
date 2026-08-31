import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/** How long an invitation stays acceptable. */
export const INVITATION_TTL_DAYS = 7;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Invitations ----------

  /**
   * Invites an email to join the business as MANAGER or STAFF.
   *
   * Every reason an invitation could never be accepted is checked HERE, at
   * creation, rather than being discovered later when the person tries to log
   * in. That matters because acceptance happens during OTP verification: an
   * invitation that cannot be honoured would otherwise surface as a confusing
   * failure in someone else's login flow, long after the owner sent it.
   */
  async invite(businessId: string, inviterUserId: string, dto: InviteMemberDto) {
    const email = dto.email.trim().toLowerCase();

    const [existingUser, business] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
          // Only the ACTIVE row matters for eligibility. REMOVED rows are
          // history and no longer reserve the person's slot.
          businessMemberships: {
            where: { status: BusinessMemberStatus.ACTIVE },
            select: { businessProfileId: true },
          },
        },
      }),
      this.prisma.businessProfile.findUniqueOrThrow({
        where: { id: businessId },
        // name is needed for the invitation email copy further down.
        select: { id: true, name: true },
      }),
    ]);

    if (existingUser) {
      // One email maps to exactly one role platform-wide (DECISIONS.md section 3),
      // so a customer's email could never complete a BUSINESS login to accept this.
      if (existingUser.role !== UserRole.BUSINESS) {
        throw new BadRequestException(
          `This email is already registered as a ${existingUser.role.toLowerCase()} account and cannot join a business.`,
        );
      }

      // At most one ACTIVE row exists, enforced by the partial unique index.
      const [active] = existingUser.businessMemberships;

      if (active) {
        // Covers both "already in this business" and "in someone else's".
        throw new ConflictException(
          active.businessProfileId === businessId
            ? 'This email is already a member of your business.'
            : 'This email is already linked to another business.',
        );
      }

      // A REMOVED membership elsewhere is deliberately NOT a barrier. Someone
      // who left another business is free to join this one: the partial unique
      // index constrains only ACTIVE rows, so their history stays put while a
      // new membership is created alongside it.
    }

    const pending = await this.prisma.businessInvitation.findFirst({
      where: { email, status: InvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      select: { id: true, businessProfileId: true },
    });
    if (pending) {
      throw new ConflictException(
        pending.businessProfileId === businessId
          ? 'An invitation for this email is already pending.'
          : 'This email already has a pending invitation from another business.',
      );
    }

    const invitation = await this.prisma.businessInvitation.create({
      data: {
        businessProfileId: businessId,
        email,
        role: dto.role,
        invitedByUserId: inviterUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    // The invitee is emailed. Note the recipient may have no account yet —
    // that is the normal case for an invitation — so when there is no user row
    // there is no inbox entry to create, only a message to send.
    const inviter = await this.prisma.user.findUnique({
      where: { id: inviterUserId },
      select: { email: true },
    });

    const context = {
      serviceName: '',
      locationName: '',
      businessName: business?.name ?? 'a business',
      startTime: undefined as unknown as Date,
      inviterEmail: inviter?.email,
      role: dto.role,
    };

    if (existingUser) {
      await this.notifications.notify({
        recipientId: existingUser.id,
        type: NotificationType.BUSINESS_INVITATION,
        context,
      });
    } else {
      await this.notifications.notifyUnregisteredEmail({
        email,
        type: NotificationType.BUSINESS_INVITATION,
        context,
      });
    }

    return invitation;
  }

  async listInvitations(businessId: string) {
    return this.prisma.businessInvitation.findMany({
      where: { businessProfileId: businessId, status: InvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        invitedBy: { select: { id: true, email: true } },
      },
    });
  }

  async revokeInvitation(businessId: string, invitationId: string) {
    // Scoped by businessId so an invitation belonging to another business can
    // never be revoked through this route.
    const invitation = await this.prisma.businessInvitation.findFirst({
      where: { id: invitationId, businessProfileId: businessId },
      select: { id: true, status: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `This invitation is already ${invitation.status.toLowerCase()} and cannot be revoked.`,
      );
    }

    await this.prisma.businessInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    return { message: 'Invitation revoked.' };
  }

  // ---------- Members ----------

  /** Visible to any active member — everyone can see who they work with. */
  async listMembers(businessId: string) {
    const members = await this.prisma.businessMembership.findMany({
      where: { businessProfileId: businessId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, email: true } },
      },
    });

    return members.map((member) => ({
      id: member.id,
      userId: member.user.id,
      email: member.user.email,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt,
    }));
  }

  /**
   * Moves a member between MANAGER and STAFF.
   *
   * The OWNER is untouchable in both directions: they cannot be demoted, and
   * nobody can be promoted into a second OWNER. That keeps "exactly one active
   * owner" true by construction rather than by periodic repair.
   */
  async updateMemberRole(
    businessId: string,
    membershipId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const membership = await this.requireMembership(businessId, membershipId);

    if (membership.role === BusinessMemberRole.OWNER) {
      throw new BadRequestException(
        "The owner's role cannot be changed. Ownership transfer is not supported yet.",
      );
    }
    if (membership.status !== BusinessMemberStatus.ACTIVE) {
      throw new BadRequestException(
        'This member has been removed. Re-invite them instead of changing their role.',
      );
    }

    const updated = await this.prisma.businessMembership.update({
      where: { id: membershipId },
      data: { role: dto.role },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { id: true, email: true } },
      },
    });

    return {
      id: updated.id,
      userId: updated.user.id,
      email: updated.user.email,
      role: updated.role,
      status: updated.status,
    };
  }

  /**
   * Soft-removes a member: status becomes REMOVED and the row stays.
   *
   * Never a hard delete — the row is the record that this person had access,
   * and (once appointments exist) the thing their past actions will reference.
   */
  async removeMember(businessId: string, membershipId: string, actingUserId: string) {
    const membership = await this.requireMembership(businessId, membershipId);

    if (membership.role === BusinessMemberRole.OWNER) {
      throw new BadRequestException(
        'The owner cannot be removed. Every business must have exactly one active owner.',
      );
    }
    // Defensive: an owner cannot reach this line, since only owners may call
    // this endpoint and the owner check above already fired.
    if (membership.userId === actingUserId) {
      throw new BadRequestException('You cannot remove yourself.');
    }
    if (membership.status === BusinessMemberStatus.REMOVED) {
      throw new BadRequestException('This member has already been removed.');
    }

    const removed = await this.prisma.businessMembership.update({
      where: { id: membershipId },
      data: { status: BusinessMemberStatus.REMOVED },
      select: { id: true, status: true, user: { select: { email: true } } },
    });

    return {
      message: `${removed.user.email} has been removed from the business.`,
      membership: { id: removed.id, status: removed.status },
    };
  }

  private async requireMembership(businessId: string, membershipId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: { id: membershipId, businessProfileId: businessId },
      select: { id: true, role: true, status: true, userId: true },
    });

    if (!membership) {
      throw new NotFoundException('Member not found.');
    }

    return membership;
  }
}
