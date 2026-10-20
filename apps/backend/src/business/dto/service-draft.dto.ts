import { ChoiceKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CHOICE_LIMITS, LOWEST_CHOICE_PRICE_MINOR } from '../service-choices';
import { ChoiceShowIfDto } from './service-choices.dto';

/** An answer being written (§300): any part may be missing yet. */
export class DraftChoiceOptionDto {
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.label)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.description)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(LOWEST_CHOICE_PRICE_MINOR)
  @Max(CHOICE_LIMITS.priceMinor)
  priceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CHOICE_LIMITS.extraMinutes)
  extraMinutes?: number;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

/** A question being written (§300), in the shape the service form sends. */
export class DraftChoiceGroupDto {
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.name)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.question)
  question?: string | null;

  @IsOptional()
  @IsEnum(ChoiceKind)
  kind?: ChoiceKind;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHOICE_LIMITS.options)
  maxPicks?: number | null;

  @IsOptional()
  @IsBoolean()
  healthRelated?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChoiceShowIfDto)
  showIf?: ChoiceShowIfDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  suggestionKey?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHOICE_LIMITS.options)
  @ValidateNested({ each: true })
  @Type(() => DraftChoiceOptionDto)
  options?: DraftChoiceOptionDto[];
}

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
  @MaxLength(100)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  instructions?: string | null;

  /** A sale being written (§186). Checked when the service is posted, not here. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  discountEndsOn?: string | null;

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

  /** The questions as written so far (§300). Checked when the service is posted. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHOICE_LIMITS.groups)
  @ValidateNested({ each: true })
  @Type(() => DraftChoiceGroupDto)
  choices?: DraftChoiceGroupDto[];

  @IsOptional()
  @IsBoolean()
  noteEnabled?: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.notePrompt)
  notePrompt?: string | null;

  @IsOptional()
  @IsBoolean()
  priceConfirmedAtShop?: boolean | null;
}
