import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** The most types one business may list (§265). */
export const MAX_KINDS = 8;
/** The most categories those types may span — a shop is a few kinds of place, not every kind. */
export const MAX_KIND_CATEGORIES = 4;

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
}
