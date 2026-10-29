import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { MobileMoneyProvider } from '@prisma/client';

/** The least a registry needs to know about what it holds. */
export interface KeyedProvider {
  readonly key: MobileMoneyProvider;
  /**
   * The country this connection serves (§315), as an ISO code — or null for
   * the default country. An operator's account belongs to one country: MTN
   * Rwanda's keys cannot charge a Ugandan SIM, so MTN Uganda would be a second
   * connection with its own keys and its own `country`.
   */
  readonly country?: string | null;
  isConfigured(): boolean;
}

/** The country a payment is for, as the registry needs it. */
export type ServedCountry = { code: string; name: string; isDefault: boolean };

/**
 * Operators the platform can reach, addressable one at a time (§57.1, §64.2).
 *
 * Shared by collections and disbursements because the rules are identical in
 * both directions and getting them wrong is expensive in both: an operator that
 * is not configured must be ABSENT rather than present-and-failing, and with
 * two operators live there must be no default.
 *
 * Duplicating this for the second direction would mean two copies of "refuse to
 * guess which network to use", and the copy that drifts is the one used less.
 */
export abstract class ProviderRegistry<T extends KeyedProvider> {
  private readonly providers: ReadonlyMap<MobileMoneyProvider, T>;
  protected readonly logger: Logger;

  /** Whether a connection serves `country`: its own, or the default one when it names none. */
  private serves(provider: T, country?: ServedCountry): boolean {
    if (!country) return true;
    const served = provider.country?.trim().toUpperCase() || null;
    return served === null ? country.isDefault : served === country.code;
  }

  protected constructor(providers: T[], label: string) {
    this.logger = new Logger(label);

    const configured = providers.filter((provider) => provider.isConfigured());
    this.providers = new Map(configured.map((provider) => [provider.key, provider]));

    const missing = providers
      .filter((provider) => !provider.isConfigured())
      .map((provider) => provider.key);

    if (configured.length === 0) {
      // Loud, but never fatal. A deployment missing these credentials can still
      // serve browsing, bookings and every read in the system; only this one
      // capability fails, and it fails with a message that says which.
      this.logger.error(
        `No ${label} provider is configured. ` +
          `Unconfigured: ${missing.join(', ') || 'none registered'}.`,
      );
    } else {
      this.logger.log(
        `Available: ${configured.map((p) => p.key).join(', ')}` +
          (missing.length > 0 ? ` (not configured: ${missing.join(', ')})` : ''),
      );
    }
  }

  /**
   * A SINGULAR noun for this capability — "payment", "disbursement".
   *
   * Singular because the messages below pluralise it where they need to. The
   * wording is user-facing and asserted by tests: a customer told "MTN_MOMO
   * payments are not available" can act on it, and one told "provider error"
   * cannot.
   */
  protected abstract get capability(): string;

  /** The operators that can be reached — in `country`, when given (§315). */
  available(country?: ServedCountry): MobileMoneyProvider[] {
    return [...this.providers.values()].filter((p) => this.serves(p, country)).map((p) => p.key);
  }

  isAvailable(key: MobileMoneyProvider, country?: ServedCountry): boolean {
    const provider = this.providers.get(key);
    return Boolean(provider && this.serves(provider, country));
  }

  /**
   * The provider for an operator, or a 503 naming what IS available.
   *
   * A 503 rather than a 400: the request is perfectly valid — the number really
   * is on that network — and the reason it cannot be served is on the
   * platform's side.
   */
  require(key: MobileMoneyProvider, country?: ServedCountry): T {
    const provider = this.providers.get(key);
    if (provider && this.serves(provider, country)) return provider;

    const available = this.available(country);
    // Whole sentences, each its own (§308): a country's name is a value, "in Rwanda" is not.
    if (available.length > 0) {
      throw new ServiceUnavailableException(
        country
          ? `${key} ${this.capability}s are not available in ${country.name} right now. Currently accepted: ${available.join(', ')}.`
          : `${key} ${this.capability}s are not available on this platform right now. Currently accepted: ${available.join(', ')}.`,
      );
    }
    throw new ServiceUnavailableException(
      country
        ? `No ${this.capability} provider is configured for ${country.name}. This is a platform fault and has been reported.`
        : `No ${this.capability} provider is configured. This is a platform fault and has been reported.`,
    );
  }

  /**
   * The provider to use when the caller has not named one.
   *
   * Only meaningful while exactly one operator is configured. With two, "the
   * default" is a coin toss, so the caller has to decide. Refusing here is what
   * forces that decision to be made rather than defaulted into.
   */
  requireOnlyOne(country?: ServedCountry): T {
    const available = this.available(country);

    if (available.length === 1) return this.require(available[0], country);

    if (available.length === 0) {
      throw new ServiceUnavailableException(
        `No ${this.capability} provider is configured. ` +
          'This is a platform fault and has been reported.',
      );
    }

    throw new ServiceUnavailableException(
      `More than one ${this.capability} provider is available ` +
        `(${available.join(', ')}), so one has to be chosen rather than defaulted.`,
    );
  }
}
