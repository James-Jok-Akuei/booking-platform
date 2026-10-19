import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import {
  EXPORT_ACCOUNT_SELECT,
  EXPORT_BOOKING_SELECT,
  EXPORT_REVIEW_SELECT,
  ExportedConversationDto,
  ExportedTicketDto,
  UserImageDto,
} from './dto/user-response.dto';

/**
 * Appointments that have not happened yet and are still expected to.
 *
 * The gate on closing an account, for the reason §89 refuses to close a branch
 * with bookings outstanding: somebody on the other side is expecting this
 * person, and in most cases is already holding their deposit.
 */
const LIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.BOOKED,
  AppointmentStatus.IN_PROGRESS,
];

/** The domain a closed account's address is moved to. Reserved, by RFC 2606. */
const CLOSED_EMAIL_DOMAIN = 'closed.invalid';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * This person's picture (§124.1).
   *
   * Uploaded, never a linked URL — the same rule a business logo follows (§88):
   * an address somebody else controls can become anything at all after it has
   * been accepted.
   *
   * The previous one is deleted after the new one is stored, never before. The
   * other order loses the picture when the upload fails.
   */
  async setImage(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserImageDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { imageUrl: true },
    });

    const url = await this.storage.upload(file.buffer, file.mimetype, `users/${userId}`);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { imageUrl: url },
      select: { id: true, imageUrl: true },
    });

    if (existing?.imageUrl) {
      await this.storage.remove(existing.imageUrl).catch(() => undefined);
    }
    return updated;
  }

  /** Takes the picture off. The file goes; the account does not. */
  async removeImage(userId: string): Promise<UserImageDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { imageUrl: true },
    });
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { imageUrl: null },
      select: { id: true, imageUrl: true },
    });
    if (existing?.imageUrl) {
      await this.storage.remove(existing.imageUrl).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Everything this platform holds about one person, as they asked for it
   * (§119.2).
   *
   * Assembled on request rather than queued to an email. It is a handful of
   * indexed reads scoped to one user, and a copy someone receives while they are
   * still looking at the screen is a copy they actually read — the queue, the
   * job, the signed link and the expiry are all worth adding the day this is too
   * big to answer in a request, and not before.
   *
   * Scoped to the caller at every level. There is no id parameter at all, so
   * there is nothing to tamper with.
   */
  /**
   * Sets the byline, or clears it (§144). One write on the user, so it changes
   * on every review they have left at once (§31.1) — and, like a rename
   * through a review, it does not mark any review as edited: the words did
   * not change.
   */
  async setDisplayName(userId: string, displayName: string | null) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, closedAt: null },
      data: { displayName },
    });
    if (count === 0) throw new NotFoundException('Account not found.');
    return { id: userId, displayName };
  }

  async exportFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: EXPORT_ACCOUNT_SELECT,
    });
    if (!user) throw new NotFoundException('Account not found.');

    const [appointments, reviews, threads, tickets] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { customerId: userId },
        orderBy: { startTime: 'desc' },
        select: EXPORT_BOOKING_SELECT,
      }),
      this.prisma.review.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
        select: EXPORT_REVIEW_SELECT,
      }),
      this.prisma.thread.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          businessProfile: { select: { name: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              body: true,
              photoUrl: true,
              createdAt: true,
              senderId: true,
            },
          },
        },
      }),
      this.prisma.ticket.findMany({
        where: { reporterId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            // Internal notes are the business's working-out about a person, not
            // a record of what they were told. Excluded here the same way they
            // are excluded from the reporter's own view of the ticket.
            where: { isInternal: false },
            select: { body: true, createdAt: true, authorId: true },
          },
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: user,
      // Named so a reader can tell whose words are whose without a key.
      bookings: appointments,
      reviews,
      conversations: threads.map((thread): ExportedConversationDto => ({
        id: thread.id,
        with: thread.businessProfile.name,
        startedAt: thread.createdAt.toISOString(),
        messages: thread.messages.map((message) => ({
          from: message.senderId === userId ? 'you' : 'the business',
          body: message.body,
          photoUrl: message.photoUrl,
          sentAt: message.createdAt.toISOString(),
        })),
      })),
      supportTickets: tickets.map((ticket): ExportedTicketDto => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
        messages: ticket.messages.map((message) => ({
          from: message.authorId === userId ? 'you' : 'support',
          body: message.body,
          sentAt: message.createdAt.toISOString(),
        })),
      })),
    };
  }

  /**
   * Closes an account: the person goes, the record stays (§119.1).
   *
   * Not a delete, and it cannot be. `users` is referenced with ON DELETE CASCADE
   * from appointments, which cascades to reviews and threads and leaves
   * `ledger_entries.appointmentId` NULL — money a business is owed, with nothing
   * saying what it was for. A business's rating would change because somebody
   * else closed their account.
   *
   * So the row stays and the identity goes: the display name is cleared, which
   * makes every review they left read "Anonymous" (§31 renders null that way),
   * and the address is moved to a reserved domain so it holds nothing and
   * releases the real one for reuse.
   */
  async close(
    userId: string,
    // Support closing it for them (§297): the refusals speak about "they", and
    // the person is told before the address is gone.
    options: { bySupport?: boolean; beforeClosing?: () => Promise<void> } = {},
  ): Promise<ActionMessageDto> {
    const you = options.bySupport ? 'They have' : 'You have';
    const youAre = options.bySupport ? 'They are' : 'You are';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, closedAt: true },
    });
    if (!user) throw new NotFoundException('Account not found.');
    if (user.closedAt) {
      throw new BadRequestException('This account is already closed.');
    }

    // Somebody is expecting them, and usually holding their deposit.
    const upcoming = await this.prisma.appointment.count({
      where: {
        customerId: userId,
        status: { in: LIVE_STATUSES },
        startTime: { gte: new Date() },
      },
    });
    if (upcoming > 0) {
      throw new BadRequestException(
        `${you} ${upcoming} booking(s) still to come. Cancel them first, or ` +
          `wait until they have happened — a shop is expecting ${options.bySupport ? 'them' : 'you'}, and closing ` +
          'now would leave them with a slot held for nobody.',
      );
    }

    // A business left with no owner can never be changed again: only an OWNER
    // may invite, and there would be nobody to do it.
    const soleOwnerships = await this.prisma.businessMembership.findMany({
      where: {
        userId,
        role: BusinessMemberRole.OWNER,
        status: BusinessMemberStatus.ACTIVE,
      },
      select: { businessProfileId: true, businessProfile: { select: { name: true } } },
    });
    for (const ownership of soleOwnerships) {
      const otherOwners = await this.prisma.businessMembership.count({
        where: {
          businessProfileId: ownership.businessProfileId,
          role: BusinessMemberRole.OWNER,
          status: BusinessMemberStatus.ACTIVE,
          userId: { not: userId },
        },
      });
      if (otherOwners === 0) {
        throw new BadRequestException(
          `${youAre} the only owner of ${ownership.businessProfile.name ?? 'a business'}. ` +
            'Make someone else an owner first, or it would be left with nobody ' +
            'who can change anything.',
        );
      }
    }

    await options.beforeClosing?.();

    const closedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          closedAt,
          displayName: null,
          // A closed account asked for nothing and lives nowhere (§140).
          offersOptInAt: null,
          offersToken: null,
          homeDistrictId: null,
          homeLatitude: null,
          homeLongitude: null,
          homeLabel: null,
          // Unique, unreachable, and it releases the real address so the same
          // person can sign up again later as somebody new.
          email: `closed-${crypto.randomUUID()}@${CLOSED_EMAIL_DOMAIN}`,
        },
      });
      // Every signed-in device, immediately. The access token still works until
      // it expires — fifteen minutes, and this is the account's own owner acting
      // — but nothing can be refreshed past that.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: closedAt },
      });
      await tx.authSession.updateMany({ where: { userId, endedAt: null }, data: { endedAt: closedAt } });
    });

    this.logger.log(`Account ${userId} closed at the owner's request${options.bySupport ? ', by our support team' : ''}.`);
    return {
      message:
        'Your account is closed. Your bookings and reviews stay with the shops ' +
        'they belong to, with your name removed.',
    };
  }

  /**
   * Pauses or resumes a whole business (§119.3).
   *
   * Stops NEW bookings and takes the shop out of search. Bookings already made
   * still happen and money already owed is still paid out — pausing is not a
   * way to walk away from either.
   *
   * Separate from `status: SUSPENDED`, which is a moderation state an admin puts
   * a business into with a reason the business is told. Reusing it would make a
   * holiday indistinguishable from a sanction in every admin listing.
   */
  async setPaused(businessId: string, paused: boolean, by = 'its own members') {
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, pausedAt: true },
    });
    if (!business) throw new NotFoundException('Business not found.');

    if (paused && business.pausedAt) {
      throw new BadRequestException('This business is already paused.');
    }
    if (!paused && !business.pausedAt) {
      throw new BadRequestException('This business is not paused.');
    }

    const updated = await this.prisma.businessProfile.update({
      where: { id: businessId },
      data: { pausedAt: paused ? new Date() : null },
      select: { id: true, name: true, pausedAt: true },
    });

    this.logger.log(
      `Business ${businessId} ${paused ? 'paused' : 'resumed'} by ${by}.`,
    );
    return updated;
  }
}
