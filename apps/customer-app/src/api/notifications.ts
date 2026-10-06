import { api } from './client';
import type { components } from './schema';

/** From the contract (§128). */
export type Notification = components['schemas']['NotificationDto'];
export type NotificationPage = components['schemas']['NotificationPageDto'];

/**
 * The inbox the platform has always kept and the phone never showed (§134).
 *
 * Every email the platform sends a customer — deposit confirmed, booking
 * cancelled, a reminder, a reply — is also a row here. Until now the only way
 * to see one was to open the email.
 */
export const listNotifications = (params: { limit?: number; unreadOnly?: boolean } = {}) =>
  api<NotificationPage>('/notifications', { query: params });

export const markNotificationRead = (id: string) =>
  api<components['schemas']['MarkReadDto']>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });

export const markAllNotificationsRead = () =>
  api<components['schemas']['MarkAllReadDto']>('/notifications/read-all', {
    method: 'PATCH',
  });

/** Takes one off the list (§159). It stays read-and-gone; it is not deleted on the server. */
export const dismissNotification = (id: string) =>
  api<components['schemas']['DismissedDto']>(`/notifications/${id}`, { method: 'DELETE' });

/** Clears every notification already read. */
export const dismissReadNotifications = () =>
  api<components['schemas']['DismissedManyDto']>('/notifications/read', { method: 'DELETE' });

/** Puts a removed one back (§160): the undo. */
export const restoreNotification = (id: string) =>
  api<components['schemas']['DismissedDto']>(`/notifications/${id}/restore`, { method: 'PATCH' });
