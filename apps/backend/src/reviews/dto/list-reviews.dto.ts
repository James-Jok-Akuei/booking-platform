import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** The order reviews are read in (§215). */
export enum ReviewOrder {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  LOWEST = 'lowest',
  HIGHEST = 'highest',
}

export class ListReviewsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  /** Only reviews of this many stars (§215). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  /**
   * Only reviews the business has (true) or has not (false) replied to — the
   * shop's "waiting for a reply" (§215).
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  replied?: boolean;

  /** Part of the words of a review, or of the reviewer's name (§215). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(ReviewOrder, { message: `sort must be one of: ${Object.values(ReviewOrder).join(', ')}` })
  sort?: ReviewOrder;
}
