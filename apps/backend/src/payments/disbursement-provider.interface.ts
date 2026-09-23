import { MobileMoneyProvider } from '@prisma/client';

/**
 * Sending money OUT, as the payout flow needs it (§64).
 *
 * A separate interface from `PaymentProvider`, not extra methods on it. The two
 * directions are different products with different credentials — MTN issues a
 * distinct subscription key for Disbursements, and a deployment may be able to
 * collect without being able to pay out — so a provider that could only collect
 * would have to implement half of a combined interface and throw on the rest.
 * Two interfaces let the registry say honestly which operators can do which.
 *
 * Deliberately narrow, in the spirit of `PaymentProvider`: only the two
 * operations the payout flow needs. Balance enquiry, reversals and statements
 * are separate problems and would each need their own thinking.
 */
export interface DisbursementProvider {
  /** Which operator this is, as stored on the payout destination. */
  readonly key: MobileMoneyProvider;

  /** Human-readable, for logs. */
  readonly name: string;

  /** Whether this provider has the credentials it needs to send money. */
  isConfigured(): boolean;

  /**
   * Asks the operator to move `amountMinor` to `msisdn`.
   *
   * Returns ACCEPTED when the operator has taken the request — which does NOT
   * mean the money arrived, only that it will be attempted. The outcome is only
   * knowable through `checkTransferStatus`, exactly as with collections.
   *
   * `externalReferenceId` is OUR id for the transfer, chosen by the caller and
   * recorded before this is called. It is what makes the operation safe to
   * repeat: an operator that has already seen the reference rejects the
   * duplicate instead of sending the money twice.
   */
  sendTransfer(params: SendTransferParams): Promise<SendTransferResult>;

  /** Where a previously submitted transfer has got to. */
  checkTransferStatus(externalReferenceId: string): Promise<TransferStatusResult>;
}

export interface SendTransferParams {
  /** Digits only, country code first, no plus — the shape payouts store. */
  msisdn: string;
  /** Minor units of `currency`. Never divided here; see §55.2. */
  amountMinor: number;
  currency: string;
  /** Our own id for this transfer, recorded BEFORE the call (§64.3). */
  externalReferenceId: string;
  /** Shown to the payee where the operator supports it. */
  payeeNote?: string;
  payerMessage?: string;
}

/**
 * Why a send failed, as far as the caller needs to care — mirroring §52.2.
 *
 * `CONFIGURATION` is the platform's own fault and will not fix itself: a wrong
 * key, a missing subscription, an unsupported currency. `INSUFFICIENT_FUNDS` is
 * its own kind because the answer is different and specific — top up the
 * disbursement account — and telling an admin "temporary failure, try later"
 * when the account is empty wastes a day. `TRANSIENT` is everything else.
 */
export type DisbursementFailureKind =
  | 'CONFIGURATION'
  | 'INSUFFICIENT_FUNDS'
  | 'TRANSIENT';

export interface SendTransferResult {
  status: 'ACCEPTED' | 'FAILED';
  failureKind?: DisbursementFailureKind;
  failureReason?: string;
}

export interface TransferStatusResult {
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  /** The operator's own id for the transfer, once it has one. */
  providerReference?: string;
  failureReason?: string;
}
