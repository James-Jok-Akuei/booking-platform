import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_RESOLUTION_WINDOW_DAYS, TICKET_RESOLUTION_WINDOW_MS } from './ticket-status';

/**
 * Closes resolved tickets that nobody reopened.
 *
 * The project already uses @nestjs/schedule (§16.8, §17.4, §20.5), so this is a
 * daily cron rather than the lazy-closure fallback — no new dependency, and the
 * same pattern as every other sweep here.
 *
 * TicketsService also treats a past-window RESOLVED ticket as CLOSED on read.
 * That is not redundancy for its own sake: it keeps reads and transitions
 * consistent during the gap between the window elapsing and this job running,
 * so a reopen cannot slip through at hour 337.
 */
@Injectable()
export class TicketsScheduler {
  private readonly logger = new Logger(TicketsScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 0 3 * * *', { name: 'ticket-auto-close' })
  async closeResolvedTickets(): Promise<number> {
    const cutoff = new Date(Date.now() - TICKET_RESOLUTION_WINDOW_MS);

    const due = await this.prisma.ticket.findMany({
      where: { status: TicketStatus.RESOLVED, resolvedAt: { lt: cutoff } },
      select: { id: true, reference: true, resolvedAt: true },
    });

    if (due.length === 0) return 0;

    const now = new Date();
    for (const ticket of due) {
      // Conditional on the status still being RESOLVED, so a ticket reopened a
      // moment ago is never clobbered by this sweep.
      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.RESOLVED },
        data: { status: TicketStatus.CLOSED, closedAt: now },
      });
      if (count > 0) {
        this.logger.log(
          `Auto-closed ticket ${ticket.reference}: resolved ${ticket.resolvedAt?.toISOString()}, ` +
            `more than ${TICKET_RESOLUTION_WINDOW_DAYS} days ago.`,
        );
      }
    }

    this.logger.log(`Ticket auto-close: ${due.length} closed.`);
    return due.length;
  }
}
