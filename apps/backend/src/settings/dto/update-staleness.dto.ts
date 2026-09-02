import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateStalenessDto {
  /**
   * How many hours old the exchange rate may be before it is reported stale.
   *
   * Zero is allowed and means "always warn" — legitimate for a currency moving
   * fast enough that any stored rate is suspect. Capped at a month, past which
   * the warning has stopped being a warning about anything.
   */
  @Type(() => Number)
  @IsInt({ message: 'exchangeRateStalenessHours must be a whole number of hours.' })
  @Min(0)
  @Max(720)
  exchangeRateStalenessHours!: number;
}
