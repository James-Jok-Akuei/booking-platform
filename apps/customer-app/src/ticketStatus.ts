import type { Ticket } from './api/tickets';

/** A support request's status, in the customer's words (§137). */
export const TICKET_STATUS: Record<
  Ticket['status'],
  { label: string; tone: 'ok' | 'warn' | 'accent' | 'neutral' }
> = {
  OPEN: { label: 'Sent', tone: 'warn' },
  IN_PROGRESS: { label: 'Being looked at', tone: 'accent' },
  RESOLVED: { label: 'Answered', tone: 'ok' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};
