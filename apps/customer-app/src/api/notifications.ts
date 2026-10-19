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

/** Several at once, from a selection (§162). */
export const dismissNotifications = (ids: string[]) =>
  api<components['schemas']['DismissedManyDto']>('/notifications', { method: 'DELETE', body: { ids } });

export const restoreNotifications = (ids: string[]) =>
  api<components['schemas']['RestoredManyDto']>('/notifications/restore', {
    method: 'PATCH',
    body: { ids },
  });

export const markNotificationsRead = (ids: string[]) =>
  api<components['schemas']['ReadManyDto']>('/notifications/read-many', {
    method: 'PATCH',
    body: { ids },
  });

// ---------- What to send, and how (§287) ----------

export type NotificationSettings = components['schemas']['NotificationSettingsDto'];
export type NotificationCategorySetting = components['schemas']['CategorySettingDto'];
export type NotificationSettingsChange = components['schemas']['UpdateNotificationSettingsDto'];

export const getNotificationSettings = () => api<NotificationSettings>('/notifications/settings');

export const updateNotificationSettings = (change: NotificationSettingsChange) =>
  api<NotificationSettings>('/notifications/settings', { method: 'PATCH', body: change });

export const registerPushDevice = (device: components['schemas']['RegisterDeviceDto']) =>
  api<components['schemas']['RegisterDeviceResultDto']>('/notifications/devices', { method: 'POST', body: device });

export const unregisterPushDevice = (token: string) =>
  api<components['schemas']['UnregisterDeviceResultDto']>('/notifications/devices', {
    method: 'DELETE',
    body: { token },
  });

// ---------- Shops you follow (§287) ----------

export type Follow = components['schemas']['FollowDto'];
export const listFollows = () => api<components['schemas']['FollowListDto']>('/follows');
export const followShop = (businessId: string) =>
  api<components['schemas']['FollowStateDto']>(`/follows/${businessId}`, { method: 'POST' });
export const unfollowShop = (businessId: string) =>
  api<components['schemas']['FollowStateDto']>(`/follows/${businessId}`, { method: 'DELETE' });

// ---------- Service notices across the top (§287) ----------

export type Banner = components['schemas']['BannerDto'];
export const listBanners = () =>
  api<components['schemas']['BannersDto']>('/announcements/banner', { query: { for: 'customers' }, anonymous: true });
