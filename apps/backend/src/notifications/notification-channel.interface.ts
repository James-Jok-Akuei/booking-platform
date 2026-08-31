import { NotificationChannel } from '@prisma/client';

/**
 * One way of getting a message to a person.
 *
 * Same shape as §17's PaymentProvider, and for the same reason: callers state
 * *what* they need delivered and know nothing about who delivers it. Adding SMS
 * is a class implementing this plus one case in the factory — no service that
 * raises a notification changes.
 *
 * This matters more here than it looks. The platform targets South Sudan, where
 * SMS reaches people far more reliably than email, so the channel is expected
 * to change; building the seam now is what stops that being a rewrite across
 * every call site later.
 */
export interface NotificationChannelDriver {
  readonly channel: NotificationChannel;

  /** True when this driver is configured well enough to attempt a send. */
  isConfigured(): boolean;

  /**
   * Delivers one message. Throws on failure — NotificationsService catches,
   * records the reason on the row, and lets the retry sweep try again.
   */
  send(message: OutboundMessage): Promise<void>;
}

export interface OutboundMessage {
  /** Email address or MSISDN, depending on the driver. */
  destination: string;
  subject: string;
  body: string;
}

/** DI token — an interface has no runtime identity. */
export const NOTIFICATION_CHANNEL = Symbol('NOTIFICATION_CHANNEL');
