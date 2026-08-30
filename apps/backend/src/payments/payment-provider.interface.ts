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
  /** Human-readable name, for logs and the payment-status response. */
  readonly name: string;

  /**
   * Asks the provider to collect `amountCents` from `phoneNumber`.
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
  amountCents: number;
  currency: string;
  externalReferenceId: string;
  /** Shown to the payer on their handset, where the provider supports it. */
  payerMessage?: string;
  /** Recorded against the payee's side of the transaction. */
  payeeNote?: string;
}

export interface InitiatePaymentResult {
  providerReferenceId: string;
  status: 'PENDING' | 'FAILED';
  /** Provider-specific reason when status is FAILED, for logs and support. */
  failureReason?: string;
}

export interface PaymentStatusResult {
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  failureReason?: string;
}

/** DI token. An interface has no runtime identity, so injection needs this. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
