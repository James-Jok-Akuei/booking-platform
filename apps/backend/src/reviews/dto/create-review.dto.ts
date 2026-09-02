import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @Type(() => Number)
  @IsInt({ message: 'rating must be a whole number from 1 to 5.' })
  @Min(1, { message: 'rating must be at least 1.' })
  @Max(5, { message: 'rating must be at most 5.' })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/**
 * Editing takes the same shape, but both fields optional — a customer may fix
 * a typo without restating their rating.
 */
export class UpdateReviewDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'rating must be a whole number from 1 to 5.' })
  @Min(1, { message: 'rating must be at least 1.' })
  @Max(5, { message: 'rating must be at most 5.' })
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
