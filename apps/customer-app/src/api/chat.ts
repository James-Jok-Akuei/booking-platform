import { api } from './client';
import { uploadFile } from '../upload';
import type { components } from './schema';

/**
 * Derived from the contract (§128).
 *
 * Hand-written, this file had `business.name` as a non-null string — it is
 * nullable, because a profile exists from registration and is named at the
 * first save (§128.18).
 *
 * `sender.email` is OPTIONAL in the contract and absent for a customer viewer
 * (§112.1): who at the shop typed it is deliberately not sent to this side.
 */
export type Thread = components['schemas']['ThreadDto'];
export type ThreadKind = Thread['kind'];
export type Message = components['schemas']['ThreadMessageDto'];
export type ThreadPage = components['schemas']['ThreadPageDto'];
export type MessagePage = components['schemas']['ThreadMessagePageDto'];
export type ThreadRead = components['schemas']['ThreadReadDto'];

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
export const openInquiry = (businessProfileId: string, locationId?: string) =>
  api<Thread>('/threads/inquiry', {
    method: 'POST',
    // The branch it was asked from (§277), so the question reaches the people
    // who work there.
    body: { businessProfileId, locationId } satisfies components['schemas']['CreateInquiryThreadDto'],
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
