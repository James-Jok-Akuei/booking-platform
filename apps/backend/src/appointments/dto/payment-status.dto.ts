import { AppointmentStatus } from '@prisma/client';

/**
 * What the platform can say about a deposit at any moment.
 *
 * `NOT_STARTED` is the platform's own word, not the operator's: nothing has been
 * asked of the customer's handset yet. The other three are the operator's
 * outcome, narrowed from MoMo's six states (§57) so a client never has to know
 * that `CREATED` means "still alive".
 */
export type DepositPaymentStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SUCCESSFUL'
  | 'FAILED';

/**
 * The reply to `GET /appointments/:id/payment-status`.
 *
 * Declared as a class, so the generated contract describes the RESPONSE and not
 * only the request body. Written because the customer app polled this endpoint
 * with a hand-written interface in which every field name was wrong, read
 * `undefined` for all of them, and therefore never noticed a deposit being paid
 * (§109). Nothing could have caught that: the endpoint returned a bare object
 * literal, so `openapi.json` described it as `{ type: object }`.
 *
 * The service's return type is this class, so the two cannot drift again
 * without the backend failing to compile.
 */
export class PaymentStatusResponseDto {
  appointmentId!: string;

  /**
   * The APPOINTMENT's status, not the payment's — the two are deliberately
   * separate fields because a failed payment leaves the appointment alive and
   * retryable, and a client that conflated them would cancel a held slot.
   */
  appointmentStatus!: AppointmentStatus;

  paymentStatus!: DepositPaymentStatus;

  /**
   * Null once a payment has FAILED. The operator will not accept the same
   * reference twice, so clearing it is what makes a retry possible (§57.3) —
   * a client seeing null here should offer the payment again, not an error.
   */
  providerReferenceId!: string | null;

  /**
   * The operator's own words, for logs and support — NOT customer copy.
   *
   * MoMo's four failure states collapse into one `FAILED` here (§57), and this
   * keeps what was lost: `FAILED: APPROVAL_REJECTED`, `FAILED: EXPIRED`,
   * `FAILED: INTERNAL_PROCESSING_ERROR` are all real values. A client must
   * translate before showing it to anyone, and should keep it visible somewhere
   * small, because it is what a support ticket needs.
   */
  failureReason?: string;
}

/**
 * The reply to `POST /appointments/:id/initiate-deposit-payment`.
 *
 * A 200 here means the operator ACCEPTED the request, never that money moved:
 * the customer approves on their own handset, so the outcome arrives only by
 * polling `payment-status`.
 */
export class InitiateDepositPaymentResponseDto {
  appointmentId!: string;

  /** The appointment's status. Still `PENDING_PAYMENT` — nothing is paid yet. */
  status!: AppointmentStatus;

  /** Always `PENDING`: the request was accepted and is now in flight. */
  paymentStatus!: 'PENDING';

  providerReferenceId!: string;

  /** What the customer was quoted, in the currency they were quoted it in. */
  depositAmountMinor!: number;
  currency!: string;

  /**
   * What was actually sent to the operator. Both sides are returned so a client
   * never has to infer which currency a bare amount was in — in the sandbox
   * these differ on purpose (§52.1).
   */
  providerAmountMinor!: number;
  providerCurrency!: string;
  exchangeRateUsed!: string;

  /** Ready to show as-is: it tells the customer to look at their handset. */
  message!: string;
}
