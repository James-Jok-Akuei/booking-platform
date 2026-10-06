import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddressSearchQueryDto {
  /** What the customer typed: a street, a building, a place people know. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  q!: string;
}

/**
 * One place on the map that matches (§172).
 *
 * `label` is short enough to say back to the customer and to keep as the
 * saved spot's name — "KG 11 Ave, Kimironko". `detail` is the rest of where
 * it is, so two places with the same street can be told apart.
 */
export class AddressDto {
  label!: string;
  detail!: string;
  latitude!: number;
  longitude!: number;
}

/**
 * The matches, best first. `available` is false when the map search could not
 * be asked — slow, down, or turned off — which is different from asking and
 * finding nothing, and the app says so differently.
 */
export class AddressSearchDto {
  results!: AddressDto[];
  available!: boolean;
}
