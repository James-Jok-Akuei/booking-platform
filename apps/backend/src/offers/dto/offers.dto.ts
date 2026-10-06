import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotNullIsland } from '../../common/validators/not-null-island.validator';

/** The district a customer calls home, as much of it as a screen shows. */
export class OffersDistrictDto {
  id!: string;
  name!: string;
  provinceName!: string;
}

/** The customer's exact spot (§169): where "near" is measured from when it is set. */
export class OffersSpotDto {
  latitude!: number;
  longitude!: number;
  /** What the phone called the place, e.g. "KG 11 Ave, Kimironko". */
  label!: string | null;
}

/**
 * Whether this customer has asked for emails about services near them (§140).
 */
export class OffersPreferenceDto {
  /** True only after they turned it on themselves. */
  optedIn!: boolean;
  /** When they agreed; null when they have not. */
  optedInAt!: string | null;
  /** Their district. Kept when they opt out, so opting back in is one tap. */
  district!: OffersDistrictDto | null;
  /** Their exact spot, if they gave one (§169). Measured from before the district. */
  spot!: OffersSpotDto | null;
}

export class SetSpotDto {
  @IsLatitude()
  @IsNotNullIsland()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class UpdateOffersPreferenceDto {
  /** Turning it on needs a district or a spot, here or already saved. */
  @IsBoolean()
  optedIn!: boolean;

  /** A live district. Send `null` to forget it. */
  @IsOptional()
  @IsUUID()
  districtId?: string | null;

  /** An exact spot. Send `null` to forget it; leave it out to keep it (§169). */
  @ApiProperty({ type: () => SetSpotDto, required: false, nullable: true })
  @IsOptional()
  @ValidateIf((dto: UpdateOffersPreferenceDto) => dto.spot !== null)
  @ValidateNested()
  @Type(() => SetSpotDto)
  spot?: SetSpotDto | null;
}
