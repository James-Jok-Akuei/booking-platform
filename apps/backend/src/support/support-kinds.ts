import { SupportActionKind } from '@prisma/client';

/**
 * The support steps the shop and the customer see on their booking (§297):
 * what was done and when — not who. Asking MTN about a payment is left out:
 * it changes nothing they would read differently.
 */
export const SHOWN_ON_BOOKING: SupportActionKind[] = [
  SupportActionKind.CHECK_IN,
  SupportActionKind.COMPLETE,
  SupportActionKind.FIX_NO_SHOW,
  SupportActionKind.CANCEL_FOR_CUSTOMER,
  SupportActionKind.CANCEL_FOR_SHOP,
  SupportActionKind.RESEND_CODE,
  SupportActionKind.READ_MESSAGES,
  // Reading someone's private answers is said on the booking too (§300.6).
  SupportActionKind.READ_HEALTH_CHOICES,
];
