import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DraftOfferDto {
  @IsUUID()
  locationId!: string;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceMinor!: number;
}

/**
 * Everything optional and everything nullable.
 *
 * A draft is incomplete by definition, so the only rules kept are the ones that
 * stop it being unstorable — a length cap so a runaway paste cannot fill the
 * table, and the right TYPE so a number field holds a number. "Name is required"
 * belongs to creating the service, not to writing one down.
 */
export class UpdateServiceDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  depositPercentage?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftOfferDto)
  offers?: DraftOfferDto[];
}
