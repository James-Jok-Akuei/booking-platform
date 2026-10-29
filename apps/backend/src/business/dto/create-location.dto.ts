import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsNotNullIsland } from '../../common/validators/not-null-island.validator';

/** How long "How to find us" may be (§318) — about three lines on a phone. */
export const FIND_US_MAX = 280;

export class CreateLocationDto {
  /**
   * Which district this branch is in (§104).
   *
   * Optional, because every branch created before this exists without one and
   * `UpdateLocationDto` is a PartialType of this class. A branch with no
   * district is not findable by place, which the screen says rather than
   * refusing the save.
   */
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsString()
  @Length(2, 120)
  name!: string; // e.g. "Juba Town Branch"

  @IsString()
  @Length(3, 300)
  address!: string;

  /**
   * REQUIRED on create since §43.2. A location with no coordinates cannot
   * appear in a distance search, and a customer looking for somewhere nearby is
   * the whole point of the discovery module — a business that onboards without
   * them is invisible to the search that matters most.
   *
   * The column stays nullable: rows created before this genuinely have no
   * coordinates and there is nothing honest to backfill them with.
   */
  @Type(() => Number)
  @IsLatitude()
  @Min(-90)
  @Max(90)
  @IsNotNullIsland()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /**
   * How to find the door (§318): the floor, the entrance, what it is
   * opposite. Short, because it is read on a phone in the street. An empty
   * box is "nothing to say", stored as null.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(FIND_US_MAX)
  findUs?: string | null;

  // Overrides BusinessProfile.phone for this location when set.
  @IsOptional()
  @IsString()
  @Length(5, 30)
  phone?: string;
}
