import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';

export class RouteQueryDto {
  /** Where the customer is. Used for this answer and not kept. */
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

/**
 * The way from the customer to a branch (§157).
 *
 * `by` says what the numbers are: `road` is a real route from the routing
 * service, with a driving time; `line` is the straight line, used when the
 * routing service could not answer, and then `minutes` is null — a time
 * nobody measured is not a time.
 */
export class RouteDto {
  distanceKm!: number;
  minutes!: number | null;
  @ApiProperty({ enum: ['road', 'line'] })
  by!: 'road' | 'line';
}
