import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { ADMIN_INVITATION_SELECT } from './dto/user-response.dto';

/** How long an administrator invitation stays open. */
export const ADMIN_INVITATION_TTL_DAYS = 7;

/**
 * Administrators inviting other administrators (§99).
 *
 * Only the **primary** administrator may do any of this, the same line a
 * business draws between OWNER and MANAGER: running the platform and deciding
 * who runs it are different powers.
 *
 * The invitation row is what confers the role. `POST /auth/otp/request` refuses
 * a role of ADMIN from any client, so there is no other way to become one —
 * someone with the primary administrator's confidence has to have written it
 * down first.
 */
@Injectable()
export class AdminInvitationsService {
  private readonly logger = new Logger(AdminInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertPrimary(actor: { userId: string; role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do this.');
    }
    const me = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { isPrimaryAdmin: true },
    });
    if (!me?.isPrimaryAdmin) {
      throw new ForbiddenException(
        'Only the primary administrator can invite or remove administrators.',
      );
    }
  }

  /**
   * Every reason the invitation could never be honoured is checked HERE, the
   * same as §(business invitations): acceptance happens inside somebody else's
   * login, and a failure discovered there reads as a broken sign-in rather than
   * an invitation that was never going to work.
   */
  async invite(actor: { userId: string; role: UserRole | string }, dto: InviteAdminDto) {
    await this.assertPrimary(actor);
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (existing?.role === UserRole.ADMIN) {
      throw new BadRequestException('That person is already an administrator.');
    }
    if (existing) {
      // A customer or business account cannot be promoted: their role decides
      // what every guard lets them reach, and changing it under them would
      // silently move their bookings or their shop out of their own app.
      throw new BadRequestException(
        `${email} already has a ${existing.role.toLowerCase()} account. ` +
          'Administrators must be invited at an address with no account yet.',
      );
    }

    const pending = await this.prisma.adminInvitation.findFirst({
      where: { email, status: InvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (pending) {
      throw new BadRequestException('That address already has an invitation waiting.');
    }

    const invitation = await this.prisma.adminInvitation.create({
      data: {
        email,
        invitedByUserId: actor.userId,
        expiresAt: new Date(Date.now() + ADMIN_INVITATION_TTL_DAYS * 86_400_000),
      },
      // The same select the listing uses, so one DTO describes both and the
      // console is not handed two different shapes for one invitation.
      select: ADMIN_INVITATION_SELECT,
    });

    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { email: true },
    });

    // No account yet, by the rule above, so there is no inbox to write to —
    // only a message to send.
    await this.notifications.notifyUnregisteredEmail({
      email,
      type: NotificationType.BUSINESS_INVITATION,
      context: {
        serviceName: '',
        locationName: '',
        businessName: 'the platform administration',
        startTime: undefined as unknown as Date,
        inviterEmail: inviter?.email,
        role: 'ADMIN',
      },
    });

    this.logger.log(`Admin invitation sent to ${email} by ${actor.userId}.`);
    return invitation;
  }

  async listInvitations(actor: { userId: string; role: UserRole | string }) {
    await this.assertPrimary(actor);
    return this.prisma.adminInvitation.findMany({
      where: { status: InvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: ADMIN_INVITATION_SELECT,
    });
  }

  async revokeInvitation(
    actor: { userId: string; role: UserRole | string },
    invitationId: string,
  ) {
    await this.assertPrimary(actor);

    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, status: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `This invitation is already ${invitation.status.toLowerCase()}.`,
      );
    }

    await this.prisma.adminInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    return { message: 'Invitation revoked.' };
  }

  /**
   * Takes administrator access away.
   *
   * The account becomes a CUSTOMER rather than being deleted: they may hold
   * tickets they assigned, reviews they hid and adjustments they created, and
   * those records name them. Demotion ends the access and keeps the history
   * readable.
   */
  async revokeAdmin(
    actor: { userId: string; role: UserRole | string },
    targetUserId: string,
  ): Promise<ActionMessageDto> {
    await this.assertPrimary(actor);

    if (targetUserId === actor.userId) {
      throw new BadRequestException('You cannot remove your own access.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, isPrimaryAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (target.role !== UserRole.ADMIN) {
      throw new BadRequestException('That account is not an administrator.');
    }
    if (target.isPrimaryAdmin) {
      throw new BadRequestException(
        'The primary administrator cannot be removed. There must always be one.',
      );
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: UserRole.CUSTOMER },
    });

    this.logger.warn(
      `Admin access removed from ${target.email} by ${actor.userId}.`,
    );
    return { message: `${target.email} is no longer an administrator.` };
  }
}
