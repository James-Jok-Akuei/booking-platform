import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ReviewOrder } from './list-reviews.dto';

/**
 * Which reviews a moderator wants to see (§93).
 *
 * `visibility` defaults to REPORTED rather than ALL, because the queue exists
 * to be worked: showing every review a platform has ever received buries the
 * handful that need a decision.
 */
export class ListAdminReviewsDto {
  @IsOptional()
  @IsIn(['VISIBLE', 'HIDDEN', 'ALL'])
  visibility?: 'VISIBLE' | 'HIDDEN' | 'ALL';

  /** Only reviews at or below this rating — the ones that get disputed. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRating?: number;

  /** Only reviews of exactly this many stars — a bar of the breakdown (§248). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  /**
   * Part of the words, the reviewer's name or email, or the shop's or
   * branch's name (§248).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(ReviewOrder, { message: `sort must be one of: ${Object.values(ReviewOrder).join(', ')}` })
  sort?: ReviewOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
