import { MobileMoneyProvider } from '@prisma/client';

/**
 * The payment abstraction the booking flow talks to.
 *
 * Same spirit as StorageService's R2/local-disk split: appointment code states
 * *what* it needs — start a deposit collection, find out whether it landed —
 * and knows nothing about who fulfils it. Swapping MTN MoMo for NilPay, or
 * sandbox for production, is a config change and a new class implementing this
 * interface; `AppointmentsService` and the polling jobs do not change.
 *
 * Deliberately narrow. Only the two operations the deposit flow actually needs
 * are here; refunds, payouts and balance queries are Payments-module-two
 * problems and would each need their own thinking about provider differences.
 */
export interface PaymentProvider {
  /**
   * Which operator this is, as stored on the appointment (§57.2).
   *
   * The stable identity. `name` is prose and may be reworded; this is what a
   * payment reference is recorded against and what the poller looks up months
   * later, so it has to be an enum value and not a string someone tidies.
   */
  readonly key: MobileMoneyProvider;

  /** Human-readable name, for logs and the payment-status response. */
  readonly name: string;

  /**
   * Whether this provider has everything it needs to be used.
   *
   * The registry only offers providers that answer true, so an operator whose
   * credentials are not configured is absent rather than failing every payment
   * routed to it (§57.3).
   */
  isConfigured(): boolean;

  /**
   * Asks the provider to collect `amountMinor` from `phoneNumber`.
   *
   * Returns PENDING when the provider has accepted the request — for MoMo that
   * is an HTTP 202, meaning the customer's handset will be prompted. It does
   * NOT mean money moved: that is only knowable via checkPaymentStatus.
   *
   * `externalReferenceId` is our own id for the payment (the appointment id),
   * sent so the provider's records can be reconciled against ours.
   */
  initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;

  /** Where a previously initiated payment has got to. */
  checkPaymentStatus(providerReferenceId: string): Promise<PaymentStatusResult>;
}

export interface InitiatePaymentParams {
  phoneNumber: string;
  amountMinor: number;
  currency: string;
  externalReferenceId: string;
  /** Shown to the payer on their handset, where the provider supports it. */
  payerMessage?: string;
  /** Recorded against the payee's side of the transaction. */
  payeeNote?: string;
}

/**
 * Why an attempt failed, as far as the caller needs to care (§52.2).
 *
 * `CONFIGURATION` is the platform's own fault — a wrong currency, a missing
 * credential, a subscription that does not cover this product. The customer did
 * nothing wrong and retrying will not help, so it is worth telling an admin.
 * `TRANSIENT` is everything else: try again later.
 */
export type PaymentFailureKind = 'CONFIGURATION' | 'TRANSIENT';

export interface InitiatePaymentResult {
  providerReferenceId: string;
  status: 'PENDING' | 'FAILED';
  /** Set when status is FAILED. Decides who is told what (§52.2). */
  failureKind?: PaymentFailureKind;
  /** Provider-specific reason when status is FAILED, for logs and support. */
  failureReason?: string;
}

export interface PaymentStatusResult {
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  failureReason?: string;
}

// The PAYMENT_PROVIDER DI token was removed in §57. Callers inject
// PaymentProviderRegistry and ask it for a named operator, because a single
// injected provider cannot answer "which one issued this reference".
