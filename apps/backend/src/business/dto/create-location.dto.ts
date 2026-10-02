import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsNotNullIsland } from '../../common/validators/not-null-island.validator';

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

  // Overrides BusinessProfile.phone for this location when set.
  @IsOptional()
  @IsString()
  @Length(5, 30)
  phone?: string;
}
