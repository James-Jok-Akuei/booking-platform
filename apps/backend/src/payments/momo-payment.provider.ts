import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  InitiatePaymentParams,
  InitiatePaymentResult,
  PaymentProvider,
  PaymentStatusResult,
} from './payment-provider.interface';

/**
 * MTN MoMo's own transaction states, as returned by GET requesttopay.
 *
 * Confirmed empirically against the sandbox rather than taken from the docs —
 * CREATED is returned in practice and is NOT documented alongside the others.
 * It is an in-flight state, not a terminal one, so treating it as anything
 * other than pending would fail payments that are still perfectly alive.
 */
type MomoStatus =
  | 'PENDING'
  | 'CREATED'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'REJECTED'
  | 'TIMEOUT';

/** States meaning "still in flight" — keep polling. */
const IN_FLIGHT_STATUSES: string[] = ['PENDING', 'CREATED'];

/** States meaning "no money arrived" — let the customer retry. */
const TERMINAL_FAILURE_STATUSES: string[] = ['FAILED', 'REJECTED', 'TIMEOUT', 'EXPIRED'];

/** Refresh a token this long before it actually expires. */
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * MTN MoMo Collections.
 *
 * Three things about MoMo shape this class:
 *
 * 1. **Every call needs a bearer token** obtained from Basic-auth credentials.
 *    Tokens last an hour, so they are cached and refreshed on demand rather
 *    than fetched per request.
 * 2. **request-to-pay is asynchronous.** A 202 means "we have asked the
 *    customer's handset", not "we took the money". The outcome only arrives by
 *    polling the status endpoint. MTN supports callbacks, but sandbox callback
 *    delivery is unreliable, so this integration is poll-only — see
 *    DECISIONS.md.
 * 3. **The caller supplies the transaction id.** X-Reference-Id is a UUID we
 *    generate and is what the status endpoint is later keyed on, so it is
 *    returned as the providerReferenceId and stored on the appointment.
 */
@Injectable()
export class MomoPaymentProvider implements PaymentProvider, OnModuleInit {
  readonly name = 'MTN MoMo Collections';

  private readonly logger = new Logger(MomoPaymentProvider.name);
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly targetEnvironment: string;
  private readonly apiUser: string;
  private readonly apiKey: string;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.env('MOMO_BASE_URL') ?? 'https://sandbox.momodeveloper.mtn.com').replace(/\/+$/, '');
    this.subscriptionKey = this.env('MOMO_SUBSCRIPTION_KEY_PRIMARY') ?? '';
    this.targetEnvironment = this.env('MOMO_TARGET_ENVIRONMENT') ?? 'sandbox';
    this.apiUser = this.env('MOMO_API_USER') ?? '';
    this.apiKey = this.env('MOMO_API_KEY') ?? '';
  }

  onModuleInit() {
    if (!this.isConfigured()) {
      // Warn rather than throw, matching StorageService: a missing payment
      // credential should not stop the whole API booting, it should make every
      // payment attempt fail loudly with a clear message.
      this.logger.warn(
        'MTN MoMo is not fully configured. Deposit payments will fail until ' +
          'MOMO_SUBSCRIPTION_KEY_PRIMARY, MOMO_API_USER and MOMO_API_KEY are set. ' +
          'Run `npm run momo:provision` to generate the API user and key against the sandbox.',
      );
      return;
    }
    this.logger.log(
      `Payment provider: ${this.name} (${this.targetEnvironment}) at ${this.baseUrl}`,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.subscriptionKey && this.apiUser && this.apiKey);
  }

  // ---------- Auth ----------

  /**
   * A valid bearer token, from cache when possible.
   *
   * The safety margin avoids the race where a token passes the expiry check and
   * then expires in flight, which would surface as a spurious 401 on an
   * otherwise good payment.
   */
  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
      return this.token.value;
    }

    const basic = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `MoMo token request failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.logger.log(`Obtained MoMo access token, valid for ${data.expires_in}s.`);
    return this.token.value;
  }

  // ---------- PaymentProvider ----------

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    if (!this.isConfigured()) {
      return {
        providerReferenceId: '',
        status: 'FAILED',
        failureReason: 'Payment provider is not configured.',
      };
    }

    // We choose the transaction id; MTN keys the status endpoint on it.
    const referenceId = crypto.randomUUID();
    const token = await this.getAccessToken();

    // MoMo amounts are major units as a string, not cents. This is the one
    // place cents are converted, and it is exact: dividing an integer by 100
    // and fixing to 2dp cannot lose a cent.
    const amount = (params.amountCents / 100).toFixed(2);

    const response = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': this.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: params.currency,
        externalId: params.externalReferenceId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: params.phoneNumber,
        },
        payerMessage: params.payerMessage ?? 'Appointment deposit',
        payeeNote: params.payeeNote ?? 'Appointment deposit',
      }),
    });

    // 202 Accepted is the documented success: the request is queued and the
    // payer will be prompted. Anything else means it never started.
    if (response.status !== 202) {
      const body = await response.text();
      this.logger.error(
        `MoMo requesttopay rejected (${response.status}) for appointment ${params.externalReferenceId}: ${body.slice(0, 300)}`,
      );
      return {
        providerReferenceId: '',
        status: 'FAILED',
        failureReason: `Provider rejected the request (HTTP ${response.status}).`,
      };
    }

    this.logger.log(
      `MoMo requesttopay accepted: reference=${referenceId} amount=${amount} ${params.currency} msisdn=${this.maskMsisdn(params.phoneNumber)}`,
    );

    return { providerReferenceId: referenceId, status: 'PENDING' };
  }

  async checkPaymentStatus(providerReferenceId: string): Promise<PaymentStatusResult> {
    if (!this.isConfigured()) {
      return { status: 'FAILED', failureReason: 'Payment provider is not configured.' };
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.baseUrl}/collection/v1_0/requesttopay/${providerReferenceId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      // Treated as still-pending, NOT failed. A transient 5xx or a network
      // blip must not cancel a payment that may well be succeeding; the poll
      // will simply ask again, and the expiry job bounds how long that lasts.
      this.logger.warn(
        `MoMo status check failed (${response.status}) for ${providerReferenceId}: ${body.slice(0, 200)}`,
      );
      return { status: 'PENDING' };
    }

    const data = (await response.json()) as {
      status: MomoStatus;
      reason?: string | { code?: string; message?: string };
    };

    // MTN distinguishes FAILED, REJECTED and TIMEOUT. To the booking flow they
    // are the same event — no money arrived, let the customer try again — so
    // they collapse into one FAILED, with the specific reason kept for logs.
    const reason =
      typeof data.reason === 'string'
        ? data.reason
        : (data.reason?.message ?? data.reason?.code);

    if (data.status === 'SUCCESSFUL') {
      return { status: 'SUCCESSFUL' };
    }

    if (IN_FLIGHT_STATUSES.includes(data.status)) {
      return { status: 'PENDING' };
    }

    if (TERMINAL_FAILURE_STATUSES.includes(data.status)) {
      // MTN distinguishes FAILED, REJECTED, TIMEOUT and EXPIRED. To the booking
      // flow they are one event — no money arrived, let the customer try again
      // — so they collapse into FAILED, with the specific reason kept for logs
      // and support. Observed sandbox reasons include INTERNAL_PROCESSING_ERROR,
      // APPROVAL_REJECTED and EXPIRED.
      return {
        status: 'FAILED',
        failureReason: reason ? `${data.status}: ${reason}` : data.status,
      };
    }

    // An unrecognised status is treated as still in flight, never as failed.
    // Guessing "failed" on a state we do not understand risks releasing a slot
    // for a payment that actually succeeded — the customer would be charged for
    // an appointment they no longer have. Pending is the safe default because
    // the 5-minute expiry sweep bounds how long it can persist.
    this.logger.warn(
      `Unrecognised MoMo status "${data.status}" for ${providerReferenceId}; treating as PENDING.`,
    );
    return { status: 'PENDING' };
  }

  /** Never log a full phone number. */
  private maskMsisdn(msisdn: string): string {
    return msisdn.length <= 4 ? '****' : `${'*'.repeat(msisdn.length - 4)}${msisdn.slice(-4)}`;
  }

  private env(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value && value.trim().length > 0 ? value.trim() : undefined;
  }
}
