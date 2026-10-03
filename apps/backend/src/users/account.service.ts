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
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

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
  async exportFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
        createdAt: true,
        closedAt: true,
      },
    });
    if (!user) throw new NotFoundException('Account not found.');

    const [appointments, reviews, threads, tickets] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { customerId: userId },
        orderBy: { startTime: 'desc' },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          currency: true,
          depositAmountMinor: true,
          servicePriceMinor: true,
          depositPaidAt: true,
          cancelledAt: true,
          cancellationReason: true,
          createdAt: true,
          service: { select: { name: true } },
          location: { select: { name: true, address: true } },
        },
      }),
      this.prisma.review.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          editedAt: true,
          location: { select: { name: true } },
        },
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
      conversations: threads.map((thread) => ({
        id: thread.id,
        with: thread.businessProfile.name,
        startedAt: thread.createdAt,
        messages: thread.messages.map((message) => ({
          from: message.senderId === userId ? 'you' : 'the business',
          body: message.body,
          photoUrl: message.photoUrl,
          sentAt: message.createdAt,
        })),
      })),
      supportTickets: tickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt,
        messages: ticket.messages.map((message) => ({
          from: message.authorId === userId ? 'you' : 'support',
          body: message.body,
          sentAt: message.createdAt,
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
  async close(userId: string) {
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
        `You have ${upcoming} booking(s) still to come. Cancel them first, or ` +
          'wait until they have happened — a shop is expecting you, and closing ' +
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
          `You are the only owner of ${ownership.businessProfile.name ?? 'a business'}. ` +
            'Make someone else an owner first, or it would be left with nobody ' +
            'who can change anything.',
        );
      }
    }

    const closedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          closedAt,
          displayName: null,
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
    });

    this.logger.log(`Account ${userId} closed at the owner's request.`);
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
  async setPaused(businessId: string, paused: boolean) {
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
      `Business ${businessId} ${paused ? 'paused' : 'resumed'} by its own members.`,
    );
    return updated;
  }
}

/** Reusable `where` fragment: a business customers are allowed to reach. */
export const TRADING: Prisma.BusinessProfileWhereInput = { pausedAt: null };
