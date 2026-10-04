import { api } from './client';

import type { components } from './schema';

/** Derived from the contract (§128). `business.name` is nullable, as the model is. */
export type Thread = components['schemas']['ThreadDto'];
export type ThreadKind = Thread['kind'];
export type ThreadPage = components['schemas']['ThreadPageDto'];
export type MessagePage = components['schemas']['ThreadMessagePageDto'];
export type ThreadRead = components['schemas']['ThreadReadDto'];

type WireMessage = components['schemas']['ThreadMessageDto'];

/**
 * A message as the BUSINESS sees it — WITH the sender's email, which the
 * customer's side does not get (§112.1).
 *
 * The contract has `email` as optional, because whether it is sent depends on
 * the VIEWER'S ROLE and that is not in the payload. This app is always the
 * business viewer, so it is always present here — narrowed once, in this one
 * place, rather than making every screen handle an `undefined` that cannot
 * actually occur.
 *
 * It is kept for a reason that applies only on this side: a business has
 * several people in it (§14), and in a thread three of them have replied to,
 * the address is how you tell who said what.
 */
export type Message = Omit<WireMessage, 'sender'> & {
  sender: WireMessage['sender'] & { email: string };
};

export const listThreads = (
  params: { limit?: number; offset?: number; appointmentId?: string } = {},
) =>
  api<ThreadPage>('/threads', {
    query: params,
  });

export const getThread = (id: string) => api<Thread>(`/threads/${id}`);

export const listMessages = (id: string, params: { limit?: number } = {}) =>
  api<Omit<MessagePage, 'messages'> & { messages: Message[] }>(
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
