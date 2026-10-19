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
  BUSINESS_KIND_WRITTEN: { icon: 'pencil', tone: 'warn', to: '/categories' },
  BUSINESS_SUBMITTED: { icon: 'store', tone: 'accent', to: '/businesses' },
  // §287: an announcement's test, sent to yourself.
  ANNOUNCEMENT: { icon: 'megaphone', tone: 'accent', to: '/announcements' },
};

export const lookFor = (type: string) =>
  NOTIFICATION_LOOK[type] ?? { icon: 'bell' as IconName, tone: 'accent' as Tone, to: '/' };

/**
 * Where a notice opens (§247). A notice about a ticket names its reference in
 * its words ("TKT-000015") and carries no id, so it opens Support on that
 * reference, and the page finds and opens the ticket itself — the way a
 * message on the business app's dashboard opens its own chat (§230).
 */
export const destinationFor = (n: { type: string; subject?: string | null; body?: string | null }) => {
  const look = lookFor(n.type);
  if (n.type.startsWith('TICKET_')) {
    const ref = `${n.subject ?? ''} ${n.body ?? ''}`.match(/TKT-\d+/)?.[0];
    if (ref) return `/tickets?ref=${ref}`;
  }
  // "Nile Cuts has finished setting up…" / "…has fixed what its rejection asked for…" (§255):
  // the queue, searched for that shop.
  if (n.type === 'BUSINESS_SUBMITTED') {
    const name = /^(.+?) has (?:finished setting up|fixed what)/.exec(n.body ?? '')?.[1];
    if (name) return `/businesses?q=${encodeURIComponent(name)}`;
  }
  // "Kigali Henna now calls itself “Henna artist”…" (§267): that shop.
  if (n.type === 'BUSINESS_KIND_WRITTEN') {
    const name = /^(.+?) now calls itself/.exec(n.body ?? '')?.[1];
    if (name) return `/businesses?status=ALL&q=${encodeURIComponent(name)}`;
  }
  return look.to;
};
