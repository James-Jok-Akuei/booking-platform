import type { IconName } from '../ui/Icon';

export type Tone = 'ok' | 'ask' | 'danger' | 'warn' | 'star' | 'accent';

/**
 * Each kind of notification with its own mark, colour and page (§190, §205),
 * shared by the bell and the "Just in" advert (§206) so a new booking looks the
 * same wherever it is seen — and opens the same page.
 */
export const NOTIFICATION_LOOK: Partial<Record<string, { icon: IconName; tone: Tone; to: string }>> = {
  APPOINTMENT_BOOKED: { icon: 'calendar', tone: 'ask', to: '/appointments' },
  DEPOSIT_CONFIRMED: { icon: 'calendarCheck', tone: 'ok', to: '/appointments' },
  APPOINTMENT_REMINDER: { icon: 'clock', tone: 'ask', to: '/appointments' },
  APPOINTMENT_MANUALLY_VERIFIED: { icon: 'userCheck', tone: 'ok', to: '/appointments?tab=in-progress' },
  APPOINTMENT_CANCELLED: { icon: 'calendarX', tone: 'danger', to: '/appointments?tab=all' },
  APPOINTMENT_NO_SHOW: { icon: 'userX', tone: 'danger', to: '/appointments?tab=all' },
  DEPOSIT_FAILED: { icon: 'alert', tone: 'danger', to: '/appointments?tab=awaiting-payment' },
  NEW_MESSAGE: { icon: 'message', tone: 'accent', to: '/messages' },
  TICKET_CREATED: { icon: 'help', tone: 'accent', to: '/help' },
  TICKET_MESSAGE: { icon: 'help', tone: 'accent', to: '/help' },
  TICKET_STATUS_CHANGED: { icon: 'help', tone: 'accent', to: '/help' },
  REVIEW_CREATED: { icon: 'star', tone: 'star', to: '/reviews' },
  REVIEW_RESPONSE: { icon: 'star', tone: 'star', to: '/reviews' },
  REVIEW_HIDDEN: { icon: 'eye', tone: 'warn', to: '/reviews' },
  STORY_REMOVED: { icon: 'stories', tone: 'danger', to: '/stories' },
  // To the Overview, where "Post my shop" is (§268).
  BUSINESS_APPROVED: { icon: 'checkCircle', tone: 'ok', to: '/' },
  BUSINESS_REINSTATED: { icon: 'checkCircle', tone: 'ok', to: '/profile' },
  BUSINESS_REJECTED: { icon: 'xCircle', tone: 'danger', to: '/profile' },
  BUSINESS_SUSPENDED: { icon: 'pause', tone: 'danger', to: '/profile' },
  BUSINESS_INVITATION: { icon: 'users', tone: 'ask', to: '/people' },
  PAYOUT_DESTINATION_SUBMITTED: { icon: 'wallet', tone: 'warn', to: '/getting-paid' },
  PAYOUT_DESTINATION_VERIFIED: { icon: 'wallet', tone: 'ok', to: '/getting-paid' },
  PAYOUT_DESTINATION_REJECTED: { icon: 'wallet', tone: 'danger', to: '/getting-paid' },
};

/** News about the shop itself — drawn with the shop's own logo, its icon a badge on the corner (§231). */
export const ABOUT_THE_SHOP = new Set(['BUSINESS_APPROVED', 'BUSINESS_REINSTATED', 'BUSINESS_REJECTED', 'BUSINESS_SUSPENDED']);

export const lookFor = (type: string) =>
  NOTIFICATION_LOOK[type] ?? { icon: 'bell' as IconName, tone: 'accent' as Tone, to: '/' };
