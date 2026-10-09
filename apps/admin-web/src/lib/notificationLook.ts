import type { IconName } from '../ui/Icon';

export type Tone = 'ok' | 'ask' | 'danger' | 'warn' | 'star' | 'accent';

/**
 * Each kind of notice an administrator receives, with its own mark, colour
 * and the page that deals with it (§242) — the business app's table (§190),
 * for the console's side of things. A notice opens its page.
 */
export const NOTIFICATION_LOOK: Partial<Record<string, { icon: IconName; tone: Tone; to: string }>> = {
  TICKET_CREATED: { icon: 'help', tone: 'accent', to: '/tickets' },
  TICKET_MESSAGE: { icon: 'message', tone: 'ask', to: '/tickets' },
  TICKET_STATUS_CHANGED: { icon: 'help', tone: 'ask', to: '/tickets' },
  PAYOUT_DESTINATION_SUBMITTED: { icon: 'wallet', tone: 'warn', to: '/payout-destinations' },
  EXCHANGE_RATE_STALE: { icon: 'refresh', tone: 'warn', to: '/settings' },
  PAYMENT_PROVIDER_MISCONFIGURED: { icon: 'alert', tone: 'danger', to: '/settings' },
  APPOINTMENT_MANUALLY_VERIFIED: { icon: 'userCheck', tone: 'warn', to: '/appointments' },
  REVIEW_HIDDEN: { icon: 'eye', tone: 'warn', to: '/reviews' },
  DISPLAY_NAME_CLEARED: { icon: 'user', tone: 'warn', to: '/users' },
};

export const lookFor = (type: string) =>
  NOTIFICATION_LOOK[type] ?? { icon: 'bell' as IconName, tone: 'accent' as Tone, to: '/' };
