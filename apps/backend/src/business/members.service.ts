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
import { MemberBranchesDto } from './dto/member-branches.dto';
import { BranchScope, EVERY_BRANCH, scopeOf, seesBranch } from './branch-scope';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import {
  BUSINESS_INVITATION_SELECT,
  BusinessInvitationDto,
  BusinessMemberDto,
  RemovedMemberDto,
} from './dto/members-response.dto';

/** How long an invitation stays acceptable. */
export const INVITATION_TTL_DAYS = 7;

/** One select for a member, so the listing and every change answer in one shape (§128.18). */
const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  allLocations: true,
  locations: { select: { locationId: true } },
  user: { select: { id: true, email: true } },
} as const;

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

    const branches = await this.checkBranches(businessId, dto);

    const invitation = await this.prisma.businessInvitation.create({
      data: {
        businessProfileId: businessId,
        email,
        role: dto.role,
        // Copied onto the membership when they accept (§277).
        allLocations: branches.allLocations,
        locationIds: branches.locationIds,
        invitedByUserId: inviterUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      // The listing's select, so one DTO describes both and an owner is not
      // handed two different shapes for one invitation (§128.18).
      select: BUSINESS_INVITATION_SELECT,
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
    // Not declared: these rows carry Dates, which BusinessInvitationDto
    // describes as strings. It is bound to the select instead (§128.11).
    return this.prisma.businessInvitation.findMany({
      where: { businessProfileId: businessId, status: InvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: BUSINESS_INVITATION_SELECT,
    });
  }

  async revokeInvitation(businessId: string, invitationId: string): Promise<ActionMessageDto> {
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

  /**
   * Visible to any active member — everyone can see who they work with.
   *
   * Someone who looks after some branches sees the people they work WITH
   * (§277): the owner, those who look after every branch, and those who share
   * one of their branches — and of anyone's branches, only the ones they share.
   * The rest of the business is not theirs to see.
   */
  async listMembers(businessId: string, viewer: BranchScope = EVERY_BRANCH): Promise<BusinessMemberDto[]> {
    const members = await this.prisma.businessMembership.findMany({
      where: {
        businessProfileId: businessId,
        ...(!viewer.allLocations && {
          OR: [
            { role: BusinessMemberRole.OWNER },
            { allLocations: true },
            { locations: { some: { locationId: { in: viewer.locationIds } } } },
          ],
        }),
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: MEMBER_SELECT,
    });

    return members.map((member) => this.toDto(member, viewer));
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
  ): Promise<BusinessMemberDto> {
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
      // The listing's select, so this answers with the SAME shape. It did not,
      // and the console typed both as one member (§128.18).
      select: MEMBER_SELECT,
    });

    return this.toDto(updated);
  }

  /**
   * Chooses which branches a member looks after (§277): every branch —
   * including ones opened later — or the ones ticked. Their bookings,
   * messages, reviews and hours follow at once: access is read from the
   * database on every request (§14.2), so nobody has to sign in again.
   */
  async setMemberBranches(
    businessId: string,
    membershipId: string,
    dto: MemberBranchesDto,
  ): Promise<BusinessMemberDto> {
    const membership = await this.requireMembership(businessId, membershipId);

    if (membership.role === BusinessMemberRole.OWNER) {
      throw new BadRequestException('The owner always looks after every branch.');
    }
    if (membership.status !== BusinessMemberStatus.ACTIVE) {
      throw new BadRequestException(
        'This member has been removed. Re-invite them instead of changing their branches.',
      );
    }

    const branches = await this.checkBranches(businessId, dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.membershipLocation.deleteMany({ where: { membershipId } });
      if (!branches.allLocations) {
        await tx.membershipLocation.createMany({
          data: branches.locationIds.map((locationId) => ({ membershipId, locationId })),
        });
      }
      return tx.businessMembership.update({
        where: { id: membershipId },
        data: { allLocations: branches.allLocations },
        select: MEMBER_SELECT,
      });
    });

    return this.toDto(updated);
  }

  /**
   * Soft-removes a member: status becomes REMOVED and the row stays.
   *
   * Never a hard delete — the row is the record that this person had access,
   * and (once appointments exist) the thing their past actions will reference.
   */
  async removeMember(businessId: string, membershipId: string, actingUserId: string): Promise<RemovedMemberDto> {
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

  /**
   * The branches asked for, made safe (§277). Left out means every branch. A
   * choice of some must name at least one, and each must be one of this
   * business's open branches — a closed branch has nothing to look after, and
   * another business's is never ours to hand out.
   */
  private async checkBranches(
    businessId: string,
    dto: { allLocations?: boolean; locationIds?: string[] },
  ): Promise<BranchScope> {
    if (dto.allLocations ?? true) return EVERY_BRANCH;

    const ids = [...new Set(dto.locationIds ?? [])];
    if (ids.length === 0) {
      throw new BadRequestException('Choose at least one branch, or every branch.');
    }
    const found = await this.prisma.location.count({
      where: { id: { in: ids }, businessId, isActive: true },
    });
    if (found !== ids.length) {
      throw new BadRequestException('One of those branches is closed or is not one of yours.');
    }
    return { allLocations: false, locationIds: ids };
  }

  /**
   * A member as the screens see them. For a viewer of some branches, only the
   * branches they share are listed — the others' names are not theirs to know.
   */
  private toDto(
    member: {
      id: string;
      role: BusinessMemberRole;
      status: BusinessMemberStatus;
      createdAt: Date;
      allLocations: boolean;
      locations: Array<{ locationId: string }>;
      user: { id: string; email: string };
    },
    viewer: BranchScope = EVERY_BRANCH,
  ): BusinessMemberDto {
    const scope = scopeOf(member);
    return {
      id: member.id,
      userId: member.user.id,
      email: member.user.email,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt.toISOString(),
      allLocations: scope.allLocations,
      locationIds: scope.locationIds.filter((id) => seesBranch(viewer, id)),
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
