import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Matches, Min } from 'class-validator';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

export class UpdateExchangeRateDto {
  /**
   * ISO 4217 code the provider charges in. "EUR" for MTN's sandbox.
   *
   * Optional so a rate can be corrected without restating the currency; when
   * omitted the stored currency is kept.
   */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message: 'providerCurrency must be a 3-letter uppercase ISO 4217 code, e.g. "EUR".',
  })
  providerCurrency?: string;

  /**
   * How many units of providerCurrency one USD buys.
   *
   * Excluded minimum, not `@Min(0)`: a rate of exactly zero would convert every
   * deposit to nothing and charge customers zero, which is a worse failure than
   * refusing the value.
   */
  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(8)
  @Min(0.00000001, {
    message: 'exchangeRateUsdToProviderCurrency must be greater than zero.',
  })
  exchangeRateUsdToProviderCurrency!: number;
}
