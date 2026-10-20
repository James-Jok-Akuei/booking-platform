import type { SupportAction } from '../api/admin';
import type { IconName } from '../ui/Icon';

/**
 * Each thing support can do (§297), as the log reads it: a few words and a
 * mark. The same words in every place the log is shown — a booking, a shop,
 * a person, a help request.
 */
export const SUPPORT_KIND: Record<SupportAction['kind'], { label: string; icon: IconName }> = {
  CHECK_IN: { label: 'Checked the customer in', icon: 'userCheck' },
  COMPLETE: { label: 'Marked it done', icon: 'checkCircle' },
  FIX_NO_SHOW: { label: 'Changed “missed” to done', icon: 'userCheck' },
  CANCEL_FOR_CUSTOMER: { label: 'Cancelled for the customer', icon: 'calendarX' },
  CANCEL_FOR_SHOP: { label: 'Cancelled for the shop', icon: 'calendarX' },
  RESEND_CODE: { label: 'Sent a new arrival code', icon: 'mail' },
  CHECK_PAYMENT: { label: 'Asked the operator about the payment', icon: 'phone' },
  READ_MESSAGES: { label: 'Read the conversation', icon: 'eye' },
  PAUSE_SHOP: { label: 'Paused the shop', icon: 'pause' },
  RESUME_SHOP: { label: 'Opened the shop again', icon: 'zap' },
  REVOKE_INVITATION: { label: 'Took back an invitation', icon: 'xCircle' },
  RESEND_INVITATION: { label: 'Sent an invitation again', icon: 'send' },
  REMOVE_MEMBER: { label: 'Took someone out of the team', icon: 'userX' },
  TRANSFER_OWNERSHIP: { label: 'Handed the shop to a new owner', icon: 'key' },
  SIGN_OUT_EVERYWHERE: { label: 'Signed them out everywhere', icon: 'logout' },
  STOP_MARKETING: { label: 'Stopped the marketing', icon: 'bell' },
  CLOSE_ACCOUNT: { label: 'Closed the account', icon: 'lock' },
  LINK_TICKET: { label: 'Tied a help request to a booking', icon: 'ticket' },
  READ_HEALTH_CHOICES: { label: 'Read the private answers', icon: 'lock' },
};
