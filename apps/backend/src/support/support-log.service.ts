import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportActionKind, TicketAuthorType, TicketStatus, UserRole } from '@prisma/client';
import type { Locale } from '../i18n/locales';
import { asLocale } from '../i18n/say';
import { PrismaService } from '../prisma/prisma.service';
import { SHOWN_ON_BOOKING } from './support-kinds';

/** Who is acting: an administrator, always. */
export type SupportActor = { userId: string; role: UserRole | string };

/** What every support action takes besides its own fields (§297). */
export interface SupportInput {
  reason: string;
  /** The help request it answers; a note is written into it. */
  ticketId?: string | null;
}

/**
 * The record of what support did (§297), and the plumbing every support
 * action shares: who may act, a reason that says something, the help request
 * it answers, the note written into it, and the line in the log.
 *
 * Global, like notifications, because support acts in several modules —
 * bookings, shops, people — and each writes here.
 */
@Injectable()
export class SupportLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins only, and a reason of a few words — the only record of why. */
  check(actor: SupportActor, input: SupportInput) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only our support team can do this.');
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new BadRequestException('Say why, in a few words. It is kept with what you did.');
    }
  }

  /** The help request, when one is named — it must exist and still be open to replies. */
  async ticket(ticketId?: string | null) {
    if (!ticketId) return null;
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, reference: true, status: true, reporterId: true, appointmentId: true, businessId: true },
    });
    if (!ticket) throw new NotFoundException('That help request was not found.');
    return ticket;
  }

  /**
   * Writes the action down — and, when it answers a help request, a reply in
   * it that says what was done, so the person who asked sees it there.
   */
  async record(
    actor: SupportActor,
    entry: {
      kind: SupportActionKind;
      reason: string;
      appointmentId?: string | null;
      businessId?: string | null;
      userId?: string | null;
      ticketId?: string | null;
      details?: Prisma.InputJsonValue;
      /** The reply written into the help request: plain words for the person who asked, in their language (§308). */
      ticketNote?: string | ((locale: Locale) => string) | null;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const action = await tx.supportAction.create({
      data: {
        kind: entry.kind,
        actorId: actor.userId,
        reason: entry.reason.trim(),
        appointmentId: entry.appointmentId ?? null,
        businessId: entry.businessId ?? null,
        userId: entry.userId ?? null,
        ticketId: entry.ticketId ?? null,
        details: entry.details ?? Prisma.JsonNull,
      },
      select: { id: true, createdAt: true },
    });
    if (entry.ticketId && entry.ticketNote) {
      const ticket = await tx.ticket.findUnique({
        where: { id: entry.ticketId },
        select: { status: true, reporter: { select: { locale: true } } },
      });
      // A closed request is not written into; the log still has it.
      if (ticket && ticket.status !== TicketStatus.CLOSED) {
        const note = entry.ticketNote;
        await tx.ticketMessage.create({
          data: {
            ticketId: entry.ticketId,
            authorId: actor.userId,
            authorType: TicketAuthorType.ADMIN,
            body: typeof note === 'function' ? note(asLocale(ticket.reporter?.locale)) : note,
          },
        });
        await tx.ticket.update({ where: { id: entry.ticketId }, data: { lastMessageAt: new Date() } });
      }
    }
    return action;
  }

  /** What support did — about a booking, a shop, a person or a help request. Admins only. */
  async history(
    actor: SupportActor,
    filter: { appointmentId?: string; businessId?: string; userId?: string; ticketId?: string },
  ) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only our support team can read this.');
    const where: Prisma.SupportActionWhereInput = {
      ...(filter.appointmentId ? { appointmentId: filter.appointmentId } : {}),
      ...(filter.businessId ? { businessId: filter.businessId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.ticketId ? { ticketId: filter.ticketId } : {}),
    };
    if (Object.keys(where).length === 0) {
      throw new BadRequestException('Name a booking, a shop, a person or a help request.');
    }
    const rows = await this.prisma.supportAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        kind: true,
        reason: true,
        createdAt: true,
        appointmentId: true,
        businessId: true,
        userId: true,
        details: true,
        actor: { select: { email: true } },
        ticket: { select: { id: true, reference: true } },
      },
    });
    return {
      actions: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        appointmentId: row.appointmentId,
        businessId: row.businessId,
        userId: row.userId,
        details: row.details === null ? null : JSON.stringify(row.details),
        by: row.actor.email,
        ticket: row.ticket,
      })),
    };
  }

  /** The booking ones, for the shop and the customer: what, and when — not who. */
  async onBooking(appointmentId: string) {
    const rows = await this.prisma.supportAction.findMany({
      where: { appointmentId, kind: { in: SHOWN_ON_BOOKING } },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, createdAt: true },
    });
    return rows.map((row) => ({ kind: row.kind, at: row.createdAt.toISOString() }));
  }
}
