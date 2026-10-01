import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobileMoneyProvider } from '@prisma/client';
import {
  BalanceReporting,
  WalletBalance,
  WalletKind,
} from './balance-reporting.interface';
import { minorUnitExponent, toMinorUnits } from './currency';

/**
 * One wallet's credentials, kept together so they cannot be crossed.
 *
 * §64.2 refused to fold collections and disbursements into one class because
 * "one object holding two sets of credentials where using the wrong pair fails
 * with 'subscription not found'" reads like broken code rather than a crossed
 * wire. Reading a balance genuinely needs both, so the defence moves: a
 * credential set is one object, passed whole, and no call site ever picks a
 * key and a user separately.
 */
interface WalletCredentials {
  wallet: WalletKind;
  /** MTN's path segment: `collection` or `disbursement`. */
  product: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
}

/**
 * What MTN says it is holding (§87).
 *
 * Read-only, and separate from both the collection and disbursement providers,
 * because it is the only thing in the codebase that legitimately needs to speak
 * to both products.
 *
 * ## This is not a reconciliation
 *
 * It fetches a number. Comparing it to the ledger is a judgement the screen
 * makes, and in sandbox that comparison is meaningless: MTN's sandbox reports
 * a fixed EUR 1000 that no transfer moves, while the ledger is in RWF. The
 * provider's job is to report honestly what it was told, including that it was
 * told nothing — MTN's sandbox collection wallet answers 500 to every form of
 * the request, which is a fact about the sandbox and not an error to swallow.
 */
@Injectable()
export class MomoBalanceProvider implements BalanceReporting {
  readonly key = MobileMoneyProvider.MTN_MOMO;
  readonly name = 'MTN MoMo';

  private readonly logger = new Logger(MomoBalanceProvider.name);
  private readonly baseUrl: string;
  private readonly targetEnvironment: string;
  private readonly wallets: WalletCredentials[];

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.env('MOMO_BASE_URL') ?? 'https://sandbox.momodeveloper.mtn.com'
    ).replace(/\/+$/, '');
    this.targetEnvironment = this.env('MOMO_TARGET_ENVIRONMENT') ?? 'sandbox';

    this.wallets = [
      {
        wallet: 'COLLECTION',
        product: 'collection',
        subscriptionKey: this.env('MOMO_SUBSCRIPTION_KEY_PRIMARY') ?? '',
        apiUser: this.env('MOMO_API_USER') ?? '',
        apiKey: this.env('MOMO_API_KEY') ?? '',
      },
      {
        wallet: 'DISBURSEMENT',
        product: 'disbursement',
        subscriptionKey: this.env('MOMO_DISBURSEMENT_SUBSCRIPTION_KEY_PRIMARY') ?? '',
        apiUser: this.env('MOMO_DISBURSEMENT_API_USER') ?? '',
        apiKey: this.env('MOMO_DISBURSEMENT_API_KEY') ?? '',
      },
    ];
  }

  /** Whether the sandbox is in use — the screen needs to say so. */
  get isSandbox(): boolean {
    return this.targetEnvironment.toLowerCase() === 'sandbox';
  }

  async checkBalances(): Promise<WalletBalance[]> {
    // Sequential, and each failure contained: one wallet being unreachable
    // must not hide the other's figure, which is the whole point of asking.
    const results: WalletBalance[] = [];
    for (const wallet of this.wallets) {
      results.push(await this.checkOne(wallet));
    }
    return results;
  }

  private async checkOne(credentials: WalletCredentials): Promise<WalletBalance> {
    if (!credentials.subscriptionKey || !credentials.apiUser || !credentials.apiKey) {
      return {
        wallet: credentials.wallet,
        status: 'UNAVAILABLE',
        reason: 'No credentials are configured for this wallet.',
      };
    }

    try {
      const token = await this.getAccessToken(credentials);
      const response = await fetch(
        `${this.baseUrl}/${credentials.product}/v1_0/account/balance`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': this.targetEnvironment,
            'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
          },
        },
      );

      const body = await response.text();
      if (!response.ok) {
        this.logger.warn(
          `MoMo ${credentials.product} balance unavailable (${response.status}): ${body.slice(0, 200)}`,
        );
        return {
          wallet: credentials.wallet,
          status: 'UNAVAILABLE',
          reason: this.explain(response.status, body),
        };
      }

      const data = JSON.parse(body) as {
        availableBalance?: string;
        currency?: string;
      };
      if (!data.availableBalance || !data.currency) {
        return {
          wallet: credentials.wallet,
          status: 'UNAVAILABLE',
          reason: 'The operator answered without a balance or a currency.',
        };
      }

      return {
        wallet: credentials.wallet,
        status: 'OK',
        reportedAmount: data.availableBalance,
        currency: data.currency,
        amountMinor: this.toMinor(data.availableBalance, data.currency),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`MoMo ${credentials.product} balance failed: ${message}`);
      return {
        wallet: credentials.wallet,
        status: 'UNAVAILABLE',
        reason: 'Could not reach the operator.',
      };
    }
  }

  /**
   * MTN reports a MAJOR-unit decimal string. Converting needs the exponent,
   * and `minorUnitExponent` throws rather than defaulting to 2 (§55.2) — so an
   * unknown currency yields null and the raw string is shown instead of a
   * number with the decimal point in an invented place.
   */
  private toMinor(amount: string, currency: string): number | null {
    try {
      minorUnitExponent(currency);
      return toMinorUnits(Number(amount), currency);
    } catch {
      this.logger.warn(
        `MoMo reported a balance in ${currency}, whose minor unit is unknown here.`,
      );
      return null;
    }
  }

  /**
   * MTN's own error codes, in words.
   *
   * Every branch returns a sentence — an earlier version fell through to '' and
   * produced "The operator answered 500. " with nothing after it, which tells a
   * reader less than the raw code would have. The codes here were all seen from
   * the live sandbox within a few minutes of each other: it answers
   * inconsistently, and that inconsistency is itself worth reporting.
   */
  private explain(status: number, body: string): string {
    const code = /"code"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1];
    const sandboxNote = this.isSandbox
      ? " MTN's sandbox answers this endpoint inconsistently; it is not a sign of a problem with this deployment."
      : '';

    switch (code) {
      case 'NOT_ALLOWED_TARGET_ENVIRONMENT':
        return `The operator refused the request for the "${this.targetEnvironment}" environment.${sandboxNote}`;
      case 'RESOURCE_NOT_FOUND':
        return `The operator has no balance to report for this wallet.${sandboxNote}`;
      case 'INTERNAL_PROCESSING_ERROR':
        return `The operator had an internal error.${sandboxNote || ' Try again shortly.'}`;
      default:
        break;
    }

    if (status === 401 || status === 403) return 'The credentials were rejected.';
    return `The operator answered ${status}${code ? ` (${code})` : ''}.${sandboxNote}`;
  }

  private async getAccessToken(credentials: WalletCredentials): Promise<string> {
    const basic = Buffer.from(`${credentials.apiUser}:${credentials.apiKey}`).toString(
      'base64',
    );
    const response = await fetch(`${this.baseUrl}/${credentials.product}/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `MoMo ${credentials.product} token request failed (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  private env(name: string): string | undefined {
    const value = this.config.get<string>(name);
    return value && value.trim() !== '' ? value.trim() : undefined;
  }
}
