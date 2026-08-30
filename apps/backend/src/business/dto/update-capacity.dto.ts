import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateLocationCapacityDto {
  /**
   * Concurrent appointments this location can run.
   *
   * At least 1 — a location that can serve nobody is a closed location, which
   * is what opening hours and schedule exceptions are for. Capped at 500 to
   * catch a fat-fingered entry rather than to express a real ceiling.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'capacity must be at least 1.' })
  @Max(500)
  capacity!: number;
}
