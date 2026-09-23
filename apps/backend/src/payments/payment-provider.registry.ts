import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MobileMoneyProvider } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';

/**
 * Every payment provider the platform can talk to, addressable individually
 * (§57.1).
 *
 * ## Why this replaces a single injected provider
 *
 * The provider used to be chosen once, at boot, from `PAYMENT_PROVIDER` in the
 * environment. That is fine while a country has one operator and wrong the
 * moment it has two: Rwanda has MTN and Airtel, and which one a customer pays
 * with is a property of their SIM, not of the deployment.
 *
 * ## The part that is not optional
 *
 * A provider reference means something only to the operator that issued it.
 * `checkPaymentStatus` asking the wrong operator gets "no such transaction",
 * which is indistinguishable from a genuine failure — so the poller would mark
 * paid bookings as failed and cancel them. Every caller therefore resolves the
 * provider from the appointment's own `paymentProvider` column rather than
 * from configuration.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers: ReadonlyMap<MobileMoneyProvider, PaymentProvider>;

  constructor(providers: PaymentProvider[]) {
    const configured = providers.filter((provider) => provider.isConfigured());

    this.providers = new Map(configured.map((provider) => [provider.key, provider]));

    const missing = providers
      .filter((provider) => !provider.isConfigured())
      .map((provider) => provider.key);

    if (configured.length === 0) {
      // Loud, but not fatal. A deployment with no payment credentials can still
      // serve browsing, bookings and every read in the system; only deposits
      // fail, and they fail with a clear message rather than a boot loop.
      this.logger.error(
        'No payment provider is configured. Deposits cannot be taken. ' +
          `Unconfigured: ${missing.join(', ') || 'none registered'}.`,
      );
    } else {
      this.logger.log(
        `Payment providers available: ${configured.map((p) => p.key).join(', ')}` +
          (missing.length > 0 ? ` (not configured: ${missing.join(', ')})` : ''),
      );
    }
  }

  /** Which operators can actually be paid through, right now. */
  available(): MobileMoneyProvider[] {
    return [...this.providers.keys()];
  }

  isAvailable(key: MobileMoneyProvider): boolean {
    return this.providers.has(key);
  }

  /**
   * The provider for an operator, or a 503 naming what IS available.
   *
   * A 503 rather than a 400: the customer's request is perfectly valid — their
   * number really is an Airtel number — and the reason it cannot be served is
   * on the platform's side. Telling them what is available lets them pay with
   * another number instead of retrying the same one.
   */
  require(key: MobileMoneyProvider): PaymentProvider {
    const provider = this.providers.get(key);
    if (provider) return provider;

    const available = this.available();
    throw new ServiceUnavailableException(
      available.length > 0
        ? `${key} payments are not available on this platform right now. ` +
          `Currently accepted: ${available.join(', ')}.`
        : 'No payment provider is configured, so deposits cannot be taken. ' +
          'This is a platform fault and has been reported.',
    );
  }

  /**
   * The provider to use when the caller has not named one.
   *
   * Deliberately only meaningful while exactly one operator is configured. With
   * two, "the default" is a coin toss that charges the wrong network, so the
   * caller has to decide — from the customer's number, or by asking them
   * (§58). Refusing here is what forces that decision to be made explicitly
   * rather than defaulted into.
   */
  requireOnlyOne(): PaymentProvider {
    const available = this.available();

    if (available.length === 1) return this.require(available[0]);

    if (available.length === 0) {
      throw new ServiceUnavailableException(
        'No payment provider is configured, so deposits cannot be taken. ' +
          'This is a platform fault and has been reported.',
      );
    }

    throw new ServiceUnavailableException(
      `More than one payment provider is available (${available.join(', ')}), ` +
        'so one has to be chosen for this payment rather than defaulted.',
    );
  }
}
