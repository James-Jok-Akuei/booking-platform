import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsDisplayName,
  normalizeDisplayName,
} from '../../common/validators/display-name.validator';

/**
 * The name to publish beside this review.
 *
 * Optional everywhere. Omitting it leaves whatever the customer already has —
 * including nothing, which reads as "Anonymous". Supplying it overwrites, and
 * because the name lives on the User it rewrites the byline on every review
 * they have ever left. That is the intended behaviour, not a side effect.
 */
export function DisplayNameField() {
  return function (target: object, propertyKey: string) {
    IsOptional()(target, propertyKey);
    // Cleaning happens before every check below, so the rules apply to the
    // string that will actually be stored and shown.
    Transform(({ value }) => normalizeDisplayName(value))(target, propertyKey);
    IsString()(target, propertyKey);
    Length(2, 40, {
      message:
        'displayName must be between 2 and 40 characters once whitespace is trimmed.',
    })(target, propertyKey);
    IsDisplayName()(target, propertyKey);
  };
}

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

  @DisplayNameField()
  displayName?: string;
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

  @DisplayNameField()
  displayName?: string;
}
