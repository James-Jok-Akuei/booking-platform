/**
 * Platform configuration as the console reads it (§128.20).
 *
 * All three of these are BUILT responses — every one of them reformats what the
 * table holds — so each service method declares its DTO as its return type
 * (§128.4) and the dates are ISO strings at the source (§128.9).
 */

/** Percentages are strings, not numbers: `toFixed(2)` is the published form. */
export class PlatformFeeDto {
  /**
   * Two decimal places, as a STRING. A Decimal rendered to a float is the §55.2
   * mistake in a different place — and this is the number every booking's fee
   * is computed from.
   */
  platformFeePercentage!: string;
  updatedAt!: string;
}

export class ExchangeRateAuthorDto {
  id!: string;
  email!: string;
}

/**
 * The manual rate, and everything needed to judge whether to trust it.
 *
 * `warning` and `note` are sentences rather than flags, because whoever reads
 * this should not have to know what `stale: true` implies. `warning` is null
 * when nothing is wrong, so the presence of the key is itself the signal.
 */
export class ExchangeRateSettingsDto {
  /** What the platform prices in. */
  internalCurrency!: string;
  /** What the operator charges in. Equal to the above in a single-currency deployment. */
  providerCurrency!: string;

  /** Eight decimal places, as a string. Null when nothing is configured. */
  exchangeRateUsdToProviderCurrency!: string | null;
  exchangeRateUpdatedAt!: string | null;
  exchangeRateUpdatedBy!: ExchangeRateAuthorDto | null;

  /** Null when there is no rate, or when no conversion happens at all. */
  ageInHours!: number | null;
  stalenessThresholdHours!: number;

  /**
   * Whether any conversion actually happens (§69.1).
   *
   * False when the operator charges in the unit of account — the rate is then
   * pinned at 1 by §55.3 and cannot be wrong, so staleness does not apply.
   * Published rather than left for a client to infer by comparing two currency
   * codes, because a client that infers it wrongly shows an operator a red
   * "STALE" badge on a number with one legal value.
   */
  conversionInUse!: boolean;
  stale!: boolean;
  configured!: boolean;

  /** Null when nothing is wrong. */
  warning!: string | null;
  note!: string;
}

export class PayoutHoldDto {
  payoutHoldDays!: number;
  /** What the number means, in words. Dates already set are never rewritten. */
  note!: string;
}
