import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

/** The most types one business may list (§265). */
export const MAX_KINDS = 8;
/** The most categories those types may span — a shop is a few kinds of place, not every kind. */
export const MAX_KIND_CATEGORIES = 4;
/** How long a write-in under "Other" may be (§267): a few words, not a description. */
export const OTHER_LABEL_MAX = 40;

/** What a business wrote for one of its "Other" kinds (§267). */
export class OtherLabelDto {
  @IsUUID('all')
  subcategoryId!: string;

  @IsString()
  @Length(2, OTHER_LABEL_MAX)
  label!: string;
}

/**
 * Every kind of place the business is (§265), in order: the first is its main
 * kind, the one shown first and mirrored on the profile.
 */
export class SetBusinessKindsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_KINDS)
  @IsUUID('all', { each: true })
  subcategoryIds!: string[];

  /** For a kind that is a category's "Other": what it actually is (§267). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_KINDS)
  @ValidateNested({ each: true })
  @Type(() => OtherLabelDto)
  otherLabels?: OtherLabelDto[];
}
