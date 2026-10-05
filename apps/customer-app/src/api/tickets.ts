import { api } from './client';
import type { components } from './schema';

/** From the contract (§128). */
export type Ticket = components['schemas']['TicketDto'];
export type TicketDetail = components['schemas']['TicketDetailDto'];
export type TicketCategory = Ticket['category'];

/**
 * Ask for help (§137). `appointmentId` ties it to the booking, which is what
 * lets whoever answers see the payment and the times without asking for them.
 */
export const createTicket = (body: {
  category: TicketCategory;
  subject: string;
  body: string;
  appointmentId?: string;
}) => api<Ticket>('/tickets', { method: 'POST', body });

/** The caller's own requests, newest first. */
export const listTickets = () =>
  api<components['schemas']['TicketPageDto']>('/tickets', { query: { limit: 100 } });

export const getTicket = (id: string) => api<TicketDetail>(`/tickets/${id}`);

export const replyToTicket = (id: string, body: string) =>
  api<components['schemas']['PostedTicketMessageDto']>(`/tickets/${id}/messages`, {
    method: 'POST',
    body: { body },
  });
