import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

export class UpdatePlatformFeeDto {
  /**
   * Percentage of the service price taken as the platform fee.
   *
   * Two decimal places, matching the Decimal(5,2) column. Capped at 100 because
   * a fee above the whole price is nonsense, and every service's
   * depositPercentage must be at least this value — so raising it too far would
   * make existing services unsaveable.
   */
  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(2)
  @Min(0)
  @Max(100)
  platformFeePercentage!: number;
}
