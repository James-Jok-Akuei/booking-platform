import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobileMoneyProvider } from '@prisma/client';
import {
  DisbursementFailureKind,
  DisbursementProvider,
  SendTransferParams,
  SendTransferResult,
  TransferStatusResult,
} from './disbursement-provider.interface';
import { formatMajorUnits } from './currency';

/**
 * MTN MoMo Disbursements — money OUT (§64.2).
 *
 * Deliberately a separate class from `MomoPaymentProvider` rather than more
 * methods on it. They share a base URL and nothing else that matters: different
 * subscription key, different API user, different token path, different
 * endpoints. Folding them together would mean one object holding two sets of
 * credentials where using the wrong pair fails with "subscription not found" —
 * an error that reads like broken code rather than a crossed wire.
 *
 * ## Repeating a send is safe, by construction
 *
 * MTN keys a transfer on `X-Reference-Id`, which WE choose. The caller records
 * that id before calling, so a retry after a timeout presents the same id and
 * MTN rejects the duplicate rather than sending twice. That is the whole reason
 * the reference is written to the payout first (§64.3).
 */
/** MTN refused a token, or could not be reached for one (§282). */
class TokenRefused extends Error {
  constructor(
    readonly httpStatus: number | null,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class MomoDisbursementProvider implements DisbursementProvider, OnModuleInit {
  readonly key = MobileMoneyProvider.MTN_MOMO;
  /**
   * The country these keys are for (§315): `MOMO_COUNTRY`, an ISO code, or
   * none for the default country. An MTN account is one country's.
   */
  readonly country = process.env.MOMO_COUNTRY?.trim().toUpperCase() || null;
  readonly name = 'MTN MoMo Disbursements';

  private readonly logger = new Logger(MomoDisbursementProvider.name);
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly targetEnvironment: string;
  private readonly apiUser: string;
  private readonly apiKey: string;

  /**
   * SANDBOX ONLY, and shared with collections (§52.1).
   *
   * MTN's sandbox accepts only EUR. The same override applies here for the same
   * reason and with the same danger: the amount actually sent is denominated in
   * a currency the ledger did not record, so the two WILL disagree. Boot refuses
   * it in production, in `MomoPaymentProvider`.
   */
  private readonly sandboxCurrencyOverride?: string;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.env('MOMO_BASE_URL') ?? 'https://sandbox.momodeveloper.mtn.com'
    ).replace(/\/+$/, '');
    this.subscriptionKey = this.env('MOMO_DISBURSEMENT_SUBSCRIPTION_KEY_PRIMARY') ?? '';
    this.targetEnvironment = this.env('MOMO_TARGET_ENVIRONMENT') ?? 'sandbox';
    this.apiUser = this.env('MOMO_DISBURSEMENT_API_USER') ?? '';
    this.apiKey = this.env('MOMO_DISBURSEMENT_API_KEY') ?? '';
    this.sandboxCurrencyOverride = this.env('MOMO_SANDBOX_CURRENCY_OVERRIDE');
  }

  onModuleInit() {
    if (!this.isConfigured()) {
      // Warn, never throw. Being unable to pay out is the NORMAL state during
      // onboarding — disbursement needs a merchant agreement that collections
      // does not — and a platform that cannot pay out should still take
      // bookings. Payouts fail with a clear message instead.
      this.logger.warn(
        'MTN MoMo Disbursements is not configured. Automated payouts are ' +
          'unavailable; they can still be sent by hand and recorded. Set ' +
          'MOMO_DISBURSEMENT_SUBSCRIPTION_KEY_PRIMARY, MOMO_DISBURSEMENT_API_USER ' +
          'and MOMO_DISBURSEMENT_API_KEY, then run ' +
          '`npm run momo:provision -- --disbursement`.',
      );
      return;
    }
    this.logger.log(
      `Disbursement provider: ${this.name} (${this.targetEnvironment}) at ${this.baseUrl}`,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.subscriptionKey && this.apiUser && this.apiKey);
  }

  // ---------- Auth ----------

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }

    const basic = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/disbursement/token/`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      });
    } catch (error) {
      throw new TokenRefused(null, `MoMo disbursement token request could not reach MTN: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new TokenRefused(
        response.status,
        `MoMo disbursement token request failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }

  // ---------- DisbursementProvider ----------

  async sendTransfer(params: SendTransferParams): Promise<SendTransferResult> {
    if (!this.isConfigured()) {
      return {
        status: 'FAILED',
        failureKind: 'CONFIGURATION',
        failureReason: 'Disbursement provider is not configured.',
      };
    }

    // No token means nothing was sent (§282): a refusal, so the payout goes
    // back to waiting for another attempt rather than sitting "being sent"
    // for a transfer MTN never saw. Wrong keys (401/403) are ours to fix.
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      const httpStatus = error instanceof TokenRefused ? error.httpStatus : null;
      this.logger.error(`MoMo transfer ${params.externalReferenceId} not sent: ${(error as Error).message}`);
      return {
        status: 'FAILED',
        failureKind: httpStatus === 401 || httpStatus === 403 ? 'CONFIGURATION' : 'TRANSIENT',
        failureReason: httpStatus ? `MTN MoMo did not answer (HTTP ${httpStatus}).` : 'MTN MoMo could not be reached.',
      };
    }

    // Resolved once, and the amount is formatted against THIS, not against the
    // configured currency — the §55.2 mistake, which would send a figure a
    // hundred times too large under a code that disagrees with it.
    const outboundCurrency = this.sandboxCurrencyOverride ?? params.currency;
    const amount = formatMajorUnits(params.amountMinor, outboundCurrency);

    const response = await fetch(`${this.baseUrl}/disbursement/v1_0/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // OUR id. Chosen by the caller and recorded before this call, which is
        // what makes a retry safe: MTN rejects a reference it has seen.
        'X-Reference-Id': params.externalReferenceId,
        'X-Target-Environment': this.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: outboundCurrency,
        externalId: params.externalReferenceId,
        payee: { partyIdType: 'MSISDN', partyId: params.msisdn },
        payerMessage: params.payerMessage ?? 'Payout',
        payeeNote: params.payeeNote ?? 'Payout',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const kind = this.classifyFailure(response.status, body);
      this.logger.error(
        `MoMo transfer rejected (${response.status}, ${kind}) for ` +
          `${params.externalReferenceId}: ${body.slice(0, 300)}`,
      );
      return {
        status: 'FAILED',
        failureKind: kind,
        failureReason: `Provider rejected the transfer (HTTP ${response.status}): ${
          this.providerCode(body) ?? 'no code given'
        }.`,
      };
    }

    this.logger.log(
      `MoMo transfer accepted: reference=${params.externalReferenceId} ` +
        `amount=${amount} ${outboundCurrency} msisdn=${this.maskMsisdn(params.msisdn)}`,
    );

    // ACCEPTED, not SUCCESSFUL. A 202 means MTN took the request; whether the
    // money arrived is only knowable from checkTransferStatus.
    return { status: 'ACCEPTED' };
  }

  async checkTransferStatus(externalReferenceId: string): Promise<TransferStatusResult> {
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.baseUrl}/disbursement/v1_0/transfer/${externalReferenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `MoMo transfer status failed (${response.status}) for ${externalReferenceId}: ` +
          body.slice(0, 300),
      );
    }

    const data = (await response.json()) as {
      status?: string;
      reason?: string | { code?: string; message?: string };
      financialTransactionId?: string;
    };

    const reason =
      typeof data.reason === 'string'
        ? data.reason
        : (data.reason?.code ?? data.reason?.message);

    if (data.status === 'SUCCESSFUL') {
      return {
        status: 'SUCCESSFUL',
        // MTN's own id for the movement. This is what reconciles against a
        // statement, so it becomes the payout's `reference`.
        providerReference: data.financialTransactionId,
      };
    }
    if (data.status === 'FAILED') {
      return { status: 'FAILED', failureReason: reason ?? 'No reason given.' };
    }
    return { status: 'PENDING' };
  }

  // ---------- Internals ----------

  /** Codes meaning the platform is misconfigured, not that MTN is busy. */
  private static readonly CONFIGURATION_CODES = [
    'INVALID_CURRENCY',
    'NOT_ALLOWED',
    'NOT_ALLOWED_TARGET_ENVIRONMENT',
    'RESOURCE_NOT_FOUND',
    'SERVICE_UNAVAILABLE_FOR_SUBSCRIPTION',
    'PAYEE_NOT_FOUND',
    'PAYER_NOT_FOUND',
  ];

  /**
   * Whose fault, and what to do about it.
   *
   * `NOT_ENOUGH_FUNDS` gets its own kind because the answer is specific and
   * actionable — top up the disbursement account — and reporting it as
   * "temporary, try later" would have an admin waiting a day for something that
   * will never resolve on its own.
   */
  private classifyFailure(httpStatus: number, body: string): DisbursementFailureKind {
    const code = this.providerCode(body);
    if (code === 'NOT_ENOUGH_FUNDS') return 'INSUFFICIENT_FUNDS';
    if (code && MomoDisbursementProvider.CONFIGURATION_CODES.includes(code)) {
      return 'CONFIGURATION';
    }
    // A 4xx is the platform's fault by definition; 5xx is normally MTN's — but
    // the body is read first, because MTN returns 500 with INVALID_CURRENCY
    // (§52.2).
    if (httpStatus >= 400 && httpStatus < 500) return 'CONFIGURATION';
    return 'TRANSIENT';
  }

  private providerCode(body: string): string | undefined {
    try {
      const parsed = JSON.parse(body) as { code?: string; message?: string };
      return parsed.code ?? parsed.message;
    } catch {
      return undefined;
    }
  }

  private maskMsisdn(msisdn: string): string {
    return `${'•'.repeat(Math.max(msisdn.length - 3, 0))}${msisdn.slice(-3)}`;
  }

  private env(name: string): string | undefined {
    const value = this.config.get<string>(name);
    return value && value.trim() !== '' ? value.trim() : undefined;
  }
}
