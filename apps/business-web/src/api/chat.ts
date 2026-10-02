import { api } from './client';

export type ThreadKind = 'INQUIRY' | 'APPOINTMENT';

/**
 * One conversation with a customer.
 *
 * Confirmed field by field against the live endpoint, not read off the service.
 */
export interface Thread {
  id: string;
  kind: ThreadKind;
  business: { id: string; name: string };
  customer: { id: string; email: string };
  appointment: {
    id: string;
    status: string;
    startTime: string;
    serviceName: string;
  } | null;
  unreadCount: number;
  lastMessage: {
    preview: string | null;
    hasPhoto: boolean;
    senderId: string;
    createdAt: string;
  } | null;
  lastMessageAt: string | null;
  createdAt: string;
}

/**
 * A message as the BUSINESS sees it — with the sender's email, which the
 * customer's side does not get (§112.1).
 *
 * Kept here for a reason that only applies on this side: a business has several
 * people in it (§14), and in a thread three of them have replied to, the email
 * is how you tell who said what.
 */
export interface Message {
  id: string;
  body: string | null;
  photoUrl: string | null;
  createdAt: string;
  sender: { id: string; email: string; role: 'CUSTOMER' | 'BUSINESS' | 'ADMIN' };
}

export const listThreads = (
  params: { limit?: number; offset?: number; appointmentId?: string } = {},
) =>
  api<{ total: number; limit: number; offset: number; threads: Thread[] }>('/threads', {
    query: params,
  });

export const getThread = (id: string) => api<Thread>(`/threads/${id}`);

export const listMessages = (id: string, params: { limit?: number } = {}) =>
  api<{ total: number; limit: number; offset: number; messages: Message[] }>(
    `/threads/${id}/messages`,
    { query: params },
  );

/**
 * Sends a message. Multipart even with no photo — one shape, because a photo
 * may always ride along with the text.
 *
 * There is no endpoint for a business to START a conversation, and that is
 * deliberate: a shop does not cold-open a chat with someone who has not
 * contacted it, which would make this outbound marketing rather than support.
 */
export const sendMessage = (threadId: string, input: { body?: string; photo?: File }) => {
  const form = new FormData();
  if (input.body) form.append('body', input.body);
  if (input.photo) form.append('photo', input.photo);
  return api<Message>(`/threads/${threadId}/messages`, { method: 'POST', body: form });
};

export const markThreadRead = (threadId: string) =>
  api<{ message: string; lastReadAt: string }>(`/threads/${threadId}/read`, {
    method: 'POST',
  });
