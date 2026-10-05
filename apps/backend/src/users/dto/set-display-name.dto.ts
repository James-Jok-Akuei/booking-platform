import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';
import {
  IsDisplayName,
  normalizeDisplayName,
} from '../../common/validators/display-name.validator';

/**
 * The name beside this person's reviews, set on its own (§144).
 *
 * `null` is a real answer, not a missing one: it means "show me as Anonymous".
 * The literal word is still never stored (§31.2) — null is, and "Anonymous" is
 * what a reader is shown for it.
 *
 * A name obeys exactly the rules it obeys when set through a review (§31.5),
 * because it is the same field and ends up in the same place.
 */
export class SetDisplayNameDto {
  @ApiProperty({ type: String, nullable: true, minLength: 2, maxLength: 40 })
  @Transform(({ value }) => (value === null ? null : normalizeDisplayName(value)))
  @ValidateIf((dto: SetDisplayNameDto) => dto.displayName !== null)
  @IsString({ message: 'displayName must be a name, or null to be shown as Anonymous.' })
  @Length(2, 40, {
    message: 'displayName must be between 2 and 40 characters once whitespace is trimmed.',
  })
  @IsDisplayName()
  displayName!: string | null;
}
