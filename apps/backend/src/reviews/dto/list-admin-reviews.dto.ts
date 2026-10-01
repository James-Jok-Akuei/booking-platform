import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsUUID()
  businessId?: string;

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
