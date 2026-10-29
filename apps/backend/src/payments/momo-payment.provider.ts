import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobileMoneyProvider } from '@prisma/client';
import * as crypto from 'crypto';
import {
  InitiatePaymentParams,
  InitiatePaymentResult,
  PaymentFailureKind,
  PaymentProvider,
  PaymentStatusResult,
} from './payment-provider.interface';
import { formatMajorUnits } from './currency';

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
 * MTN could not be asked at all (§282): its token service refused, or it
 * could not be reached. `httpStatus` is null when there was no answer.
 */
class MomoUnreachable extends Error {
  constructor(
    readonly httpStatus: number | null,
    message: string,
  ) {
    super(message);
  }
}

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
  readonly key = MobileMoneyProvider.MTN_MOMO;
  /**
   * The country these keys are for (§315): `MOMO_COUNTRY`, an ISO code, or
   * none for the default country. An MTN account is one country's.
   */
  readonly country = process.env.MOMO_COUNTRY?.trim().toUpperCase() || null;
  readonly name = 'MTN MoMo Collections';

  private readonly logger = new Logger(MomoPaymentProvider.name);
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly targetEnvironment: string;
  /**
   * SANDBOX ONLY. Overrides the currency in the OUTBOUND request, and nothing
   * else (§52.1).
   *
   * MTN's sandbox accepts only EUR, while a realistic dataset is priced in SSP —
   * so without this, a working sandbox and realistic data cannot coexist. The
   * override touches the request body alone: what the customer is quoted, what
   * is stored on the appointment, and what the ledger settles in all remain the
   * real `providerCurrency`.
   *
   * That asymmetry is exactly why it must never run in production, and why boot
   * refuses if it is set there.
   */
  private readonly sandboxCurrencyOverride?: string;
  private readonly apiUser: string;
  private readonly apiKey: string;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.env('MOMO_BASE_URL') ?? 'https://sandbox.momodeveloper.mtn.com').replace(/\/+$/, '');
    this.subscriptionKey = this.env('MOMO_SUBSCRIPTION_KEY_PRIMARY') ?? '';
    this.targetEnvironment = this.env('MOMO_TARGET_ENVIRONMENT') ?? 'sandbox';
    this.sandboxCurrencyOverride = this.env('MOMO_SANDBOX_CURRENCY_OVERRIDE');

    // Fail to START, not to pay. A misconfiguration discovered at boot is an
    // ops problem; the same one discovered at charge time is a customer being
    // billed in a currency nobody chose.
    if (process.env.NODE_ENV === 'production' && this.sandboxCurrencyOverride) {
      throw new Error(
        'MOMO_SANDBOX_CURRENCY_OVERRIDE is set and NODE_ENV is production. It ' +
          'rewrites the currency sent to the payment provider and exists only to ' +
          'work around the sandbox accepting EUR alone. Unset it.',
      );
    }
    if (this.sandboxCurrencyOverride) {
      this.logger.warn(
        `SANDBOX CURRENCY OVERRIDE ACTIVE: outbound requests will say ` +
          `${this.sandboxCurrencyOverride} regardless of the configured provider ` +
          'currency. Testing aid only — the ledger and the customer still see the ' +
          'real currency, so the two WILL disagree.',
      );
    }
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
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/collection/token/`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      });
    } catch (error) {
      throw new MomoUnreachable(null, `MoMo token request could not reach MTN: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new MomoUnreachable(
        response.status,
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
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      return this.notStarted(error, params.externalReferenceId);
    }

    // The currency actually put on the wire, resolved ONCE. The sandbox
    // override (§52.1) replaces it, so the amount has to be formatted against
    // this and not against `params.currency` — labelling an amount EUR while
    // formatting it by RWF's zero decimal places would send a figure a hundred
    // times too large, under a currency code that disagrees with it.
    const outboundCurrency = this.sandboxCurrencyOverride ?? params.currency;

    // MoMo amounts are major units as a string, not minor ones. Formatted with
    // the currency's own number of decimal places (§55.2): a hardcoded /100
    // sent "117.00" where a currency with no minor unit wanted "11700".
    const amount = formatMajorUnits(params.amountMinor, outboundCurrency);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay`, {
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
          // The override applies HERE and nowhere else (§52.1).
          currency: outboundCurrency,
          externalId: params.externalReferenceId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: params.phoneNumber,
          },
          payerMessage: params.payerMessage ?? 'Appointment deposit',
          payeeNote: params.payeeNote ?? 'Appointment deposit',
        }),
      });
    } catch (error) {
      // Lost on the way, after the token: MTN may well have queued it and be
      // prompting the customer now. Saying "not started" could let them pay
      // with no booking to show for it, so it is "under way" — the poll asks
      // MTN about this reference, and the unpaid-hold expiry bounds the wait.
      this.logger.error(
        `MoMo requesttopay for appointment ${params.externalReferenceId} got no answer ` +
          `(${(error as Error).message}); kept as ${referenceId}, under way, for the poll to settle.`,
      );
      return { providerReferenceId: referenceId, status: 'PENDING' };
    }

    // 202 Accepted is the documented success: the request is queued and the
    // payer will be prompted. Anything else means it never started.
    if (response.status !== 202) {
      const body = await response.text();
      const kind = this.classifyFailure(response.status, body);
      this.logger.error(
        `MoMo requesttopay rejected (${response.status}, ${kind}) for appointment ` +
          `${params.externalReferenceId}: ${body.slice(0, 300)}`,
      );
      return {
        providerReferenceId: '',
        status: 'FAILED',
        failureKind: kind,
        failureReason: `Provider rejected the request (HTTP ${response.status}): ${
          this.providerCode(body) ?? 'no code given'
        }.`,
      };
    }

    // `outboundCurrency`, because that is what `amount` was FORMATTED against.
    // Printed with `params.currency` it read "10.00 RWF" for a request that
    // actually said "10.00 EUR" — and in a zero-decimal currency "10.00" is not
    // even a well-formed figure (§114.1). The disbursement provider has always
    // printed the outbound one, so the two sat in the same log disagreeing.
    //
    // Both are logged when they differ, since the whole point of a sandbox
    // override is that the two are not the same and a reader needs to see it.
    const quoted =
      outboundCurrency === params.currency ? '' : ` (quoted in ${params.currency})`;
    this.logger.log(
      `MoMo requesttopay accepted: reference=${referenceId} amount=${amount} ${outboundCurrency}${quoted} msisdn=${this.maskMsisdn(params.phoneNumber)}`,
    );

    return { providerReferenceId: referenceId, status: 'PENDING' };
  }

  /** MTN codes that mean the platform is misconfigured, not that MTN is busy. */
  private static readonly CONFIGURATION_CODES = [
    'INVALID_CURRENCY',
    'NOT_ALLOWED',
    'NOT_ALLOWED_TARGET_ENVIRONMENT',
    'RESOURCE_NOT_FOUND',
    'SERVICE_UNAVAILABLE_FOR_SUBSCRIPTION',
  ];

  /**
   * Platform's fault, or the world's?
   *
   * The distinction decides who hears about it (§52.2): a configuration failure
   * is an admin's problem and no amount of retrying fixes it, while a transient
   * one is a "try again shortly". Before this, both reached the customer as
   * "Provider rejected the request (HTTP 500)" and the real cause lived only in
   * a log a support agent could not see.
   *
   * A 4xx is the platform's fault by definition. A 5xx is normally MTN's — but
   * MTN returns 500 with an INVALID_CURRENCY body, so the body is read too.
   */
  /**
   * MTN could not be asked to take a deposit at all (§282) — it refused a
   * token, or did not answer. It used to throw, and the customer read
   * "Internal server error". Wrong credentials (401/403) are ours to fix and
   * the admins are told; anything else is MTN's, passes, and the customer is
   * asked to try again shortly.
   */
  private notStarted(error: unknown, appointmentId: string): InitiatePaymentResult {
    const httpStatus = error instanceof MomoUnreachable ? error.httpStatus : null;
    const kind: PaymentFailureKind = httpStatus === 401 || httpStatus === 403 ? 'CONFIGURATION' : 'TRANSIENT';
    this.logger.error(
      `MoMo could not be asked for the deposit of appointment ${appointmentId} (${kind}): ${(error as Error).message}`,
    );
    return {
      providerReferenceId: '',
      status: 'FAILED',
      failureKind: kind,
      failureReason: httpStatus ? `MTN MoMo did not answer (HTTP ${httpStatus}).` : 'MTN MoMo could not be reached.',
    };
  }

  private classifyFailure(httpStatus: number, body: string): PaymentFailureKind {
    const code = this.providerCode(body);
    if (code && MomoPaymentProvider.CONFIGURATION_CODES.includes(code)) {
      return 'CONFIGURATION';
    }
    if (httpStatus >= 400 && httpStatus < 500) return 'CONFIGURATION';
    return 'TRANSIENT';
  }

  /** MTN's machine-readable code, when the body carries one. */
  private providerCode(body: string): string | null {
    try {
      const parsed = JSON.parse(body) as { code?: string };
      return parsed.code ?? null;
    } catch {
      return null;
    }
  }

  async checkPaymentStatus(providerReferenceId: string): Promise<PaymentStatusResult> {
    if (!this.isConfigured()) {
      return { status: 'FAILED', failureReason: 'Payment provider is not configured.' };
    }

    // MTN not answering — no token, or no reply — is "not known yet", never
    // "failed" (§282): the same rule as a 5xx below. The poll asks again.
    let response: Response;
    try {
      const token = await this.getAccessToken();
      response = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay/${providerReferenceId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      });
    } catch (error) {
      this.logger.warn(`MoMo status check could not ask MTN about ${providerReferenceId}: ${(error as Error).message}`);
      return { status: 'PENDING' };
    }

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
