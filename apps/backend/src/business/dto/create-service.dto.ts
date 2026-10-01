import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

/** One branch's offer of a service, at that branch's price (§72). */
export class ServiceOfferDto {
  @IsUUID()
  locationId!: string;

  // Integer MINOR UNITS of the internal currency, never a float — see §10.3
  // and §56. Capped to catch the obvious "typed major units into a minor-unit
  // field" mistake.
  @IsInt({
    message:
      'priceMinor must be a whole number of minor units (e.g. cents), not a decimal amount',
  })
  @Min(0)
  @Max(100_000_000)
  priceMinor!: number;
}

export class CreateServiceDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Where this service is offered, and for how much at each branch (§72).
   *
   * At least one: a service offered nowhere cannot be booked by anybody, and
   * creating one is almost always a mistake rather than an intention. A branch
   * can be removed later, which is the honest way to stop offering it there.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Choose at least one branch for this service, with its price there.',
  })
  @ValidateNested({ each: true })
  @Type(() => ServiceOfferDto)
  offers!: ServiceOfferDto[];

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
