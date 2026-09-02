import { TicketStatus } from '@prisma/client';

/** How long a RESOLVED ticket stays reopenable, and how long before it closes. */
export const TICKET_RESOLUTION_WINDOW_DAYS = 14;
export const TICKET_RESOLUTION_WINDOW_MS =
  TICKET_RESOLUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Who is permitted to make a given transition. */
export type TransitionActor = 'ADMIN' | 'REPORTER' | 'SYSTEM';

export interface TransitionRule {
  from: TicketStatus;
  to: TicketStatus;
  actors: TransitionActor[];
}

/**
 * The complete set of legal transitions. Anything not listed here throws.
 *
 * Kept as data rather than a chain of ifs so the whole lifecycle is readable at
 * once, and so a test can assert that every unlisted pair is rejected without
 * enumerating the rules a second time.
 */
export const TICKET_TRANSITIONS: TransitionRule[] = [
  { from: TicketStatus.OPEN, to: TicketStatus.IN_PROGRESS, actors: ['ADMIN'] },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, actors: ['ADMIN'] },
  // The reopen path. Time-limited, and only the reporter may take it — an admin
  // reopening their own resolution would defeat the point of the window.
  { from: TicketStatus.RESOLVED, to: TicketStatus.IN_PROGRESS, actors: ['REPORTER'] },
  // SYSTEM is the auto-close sweep.
  { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, actors: ['ADMIN', 'SYSTEM'] },
];

export function findTransition(
  from: TicketStatus,
  to: TicketStatus,
): TransitionRule | undefined {
  return TICKET_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** True when a RESOLVED ticket has sat past its window and is due to close. */
export function isPastResolutionWindow(resolvedAt: Date | null): boolean {
  if (!resolvedAt) return false;
  return Date.now() - resolvedAt.getTime() > TICKET_RESOLUTION_WINDOW_MS;
}
