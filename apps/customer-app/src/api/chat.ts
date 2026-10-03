import { api } from './client';
import { uploadFile } from '../upload';
import type { components } from './schema';

export type ThreadKind = 'INQUIRY' | 'APPOINTMENT';

/**
 * One conversation. Confirmed field by field against the live endpoint rather
 * than read off the service — §109 is what happens when a client guesses.
 *
 * `kind` is the only thing separating the two shapes (§21.1): an APPOINTMENT
 * thread is created with the booking and carries it, an INQUIRY thread is
 * opened on demand and there is exactly one per shop, forever.
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
 * A message as the CUSTOMER sees it: no email on the sender (§112.1).
 *
 * `id` and `role` are everything this side needs — whether it is mine, and
 * which side it came from. Who at the shop typed it is deliberately not here.
 */
export interface Message {
  id: string;
  body: string | null;
  photoUrl: string | null;
  createdAt: string;
  sender: { id: string; role: 'CUSTOMER' | 'BUSINESS' | 'ADMIN' };
}

export interface ThreadPage {
  total: number;
  limit: number;
  offset: number;
  threads: Thread[];
}

export interface MessagePage {
  total: number;
  limit: number;
  offset: number;
  messages: Message[];
}

/**
 * `appointmentId` narrows to the one thread created with that booking (§21.1),
 * so a booking screen can open ITS conversation without paging through every
 * thread looking for a match.
 */
export const listThreads = (
  params: { limit?: number; offset?: number; appointmentId?: string } = {},
) => api<ThreadPage>('/threads', { query: params });

/** The conversation attached to a booking, or null if there is somehow none. */
export const threadForAppointment = async (appointmentId: string) => {
  const page = await listThreads({ appointmentId, limit: 1 });
  return page.threads[0] ?? null;
};

export const getThread = (id: string) => api<Thread>(`/threads/${id}`);

export const listMessages = (
  id: string,
  params: { limit?: number; offset?: number } = {},
) => api<MessagePage>(`/threads/${id}/messages`, { query: params });

/**
 * Opens the conversation with a shop, or returns the one that already exists.
 *
 * Idempotent on purpose (§21.1): asking a second question weeks later lands in
 * the same thread rather than starting a parallel one the shop has to notice
 * separately. So this is safe to call every time the button is tapped.
 */
export const openInquiry = (businessProfileId: string) =>
  api<Thread>('/threads/inquiry', {
    method: 'POST',
    body: { businessProfileId } satisfies components['schemas']['CreateInquiryThreadDto'],
  });

/**
 * Sends a message. Multipart even when there is no photo, because that is the
 * one shape the endpoint takes — a photo may always ride along with the text.
 */
export const sendMessage = (
  threadId: string,
  input: { body?: string; photo?: { uri: string; name: string; type: string } },
) => {
  // With a photo this cannot go through `api()`: Expo's fetch throws
  // "Unsupported FormDataPart implementation" on a React Native file part
  // (§125.2), so every photo a customer sent would have failed. Expo's native
  // uploader carries the text alongside it as a form parameter.
  if (input.photo) {
    return uploadFile<Message>(
      `/threads/${threadId}/messages`,
      { uri: input.photo.uri, mimeType: input.photo.type },
      {
        fieldName: 'photo',
        ...(input.body ? { parameters: { body: input.body } } : {}),
      },
    );
  }

  // Text alone is still multipart, because that is the one shape the endpoint
  // takes — but a FormData of strings converts perfectly well.
  const form = new FormData();
  if (input.body) form.append('body', input.body);
  return api<Message>(`/threads/${threadId}/messages`, { method: 'POST', body: form });
};

export const markThreadRead = (threadId: string) =>
  api<{ message: string; lastReadAt: string }>(`/threads/${threadId}/read`, {
    method: 'POST',
  });
