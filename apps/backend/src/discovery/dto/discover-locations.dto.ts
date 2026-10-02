import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export enum DiscoverySort {
  RATING = 'rating',
  PRICE = 'price',
  DISTANCE = 'distance',
  /**
   * Most recently listed first. Added because the customer app had been offering
   * it as a chip since §102 and every tap was a 400 — the app's hand-written
   * sort type listed a value the enum never had (§110).
   */
  NEWEST = 'newest',
}

/** Widest search the platform will run in one request. */
export const MAX_RADIUS_KM = 200;

export class DiscoverLocationsDto {
  /**
   * Narrow to one province (§104). Matched through the district, so a branch
   * with no district set is simply not returned — it has not said where it is.
   */
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  /** Narrow to one district. The useful unit inside Kigali. */
  @IsOptional()
  @IsUUID()
  districtId?: string;

  /** Case-insensitive substring over business name, location name, service name. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  minRating?: number;

  /** Against the location's CHEAPEST active service. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  openNow?: boolean;

  // All three together or none — enforced in the service, which is the only
  // layer that can see the combination.
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0.1)
  @Max(MAX_RADIUS_KM)
  radiusKm?: number;

  @IsOptional()
  @IsEnum(DiscoverySort, {
    message: `sort must be one of: ${Object.values(DiscoverySort).join(', ')}`,
  })
  sort?: DiscoverySort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
