import type { Ticket } from './api/tickets';
import { t } from '@lingui/core/macro';

/** A support request's status, in the customer's words (§137) — and language (§308). */
export const TICKET_STATUS: Record<
  Ticket['status'],
  { label: string; tone: 'ok' | 'warn' | 'accent' | 'neutral' }
> = {
  OPEN: { get label() { return t({ message: 'Sent', context: 'help request status' }); }, tone: 'warn' },
  IN_PROGRESS: { get label() { return t({ message: 'Being looked at', context: 'help request status' }); }, tone: 'accent' },
  RESOLVED: { get label() { return t({ message: 'Answered', context: 'help request status' }); }, tone: 'ok' },
  CLOSED: { get label() { return t({ message: 'Closed', context: 'help request status' }); }, tone: 'neutral' },
};
