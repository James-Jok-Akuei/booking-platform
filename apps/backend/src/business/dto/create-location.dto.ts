import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @Length(2, 120)
  name!: string; // e.g. "Juba Town Branch"

  @IsString()
  @Length(3, 300)
  address!: string;

  // Nullable in the schema for a reason: plenty of businesses onboard with a
  // street address long before anyone pins exact coordinates.
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  // Overrides BusinessProfile.phone for this location when set.
  @IsOptional()
  @IsString()
  @Length(5, 30)
  phone?: string;
}
