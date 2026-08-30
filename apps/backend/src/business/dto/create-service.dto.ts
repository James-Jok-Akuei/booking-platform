import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

export class CreateServiceDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // Integer cents, never a float — see DECISIONS.md. Capped at ~$1,000,000 to
  // catch the obvious "typed dollars into a cents field" mistake.
  @IsInt({ message: 'priceCents must be an integer number of cents, not a decimal amount' })
  @Min(0)
  @Max(100_000_000)
  priceCents!: number;

  @IsInt()
  @Min(1)
  @Max(1440) // a single appointment cannot exceed one day
  durationMinutes!: number;

  /**
   * Share of the price the customer pays up front to hold the slot.
   *
   * The lower bound is NOT expressed here: it is the live platform fee from
   * PlatformSetting, which an admin can change at runtime, so validating it
   * needs a database read and happens in ServicesService.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(2)
  @Min(0)
  @Max(100)
  depositPercentage?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
