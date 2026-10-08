import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { MINUTES_PER_DAY, SLOT_GRID_MINUTES } from '../time.util';

export class AvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date!: string;

  /**
   * Optional, defaulting to the grid unit. A caller who has not yet picked a
   * service still wants to see the shape of the day, and 15 minutes is the
   * shortest thing that can be booked — so it yields the most permissive
   * (largest) honest slot list rather than an arbitrary guess.
   *
   * Note it is NOT constrained to a multiple of 15: start times sit on the
   * grid, but a 50-minute service is perfectly legal and simply ends off-grid.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MINUTES_PER_DAY)
  durationMinutes?: number = SLOT_GRID_MINUTES;

  /**
   * Ask about a SERVICE instead of a length (§136). When sent, the booking is
   * the service's own length and needs one place per person in `quantity`
   * (§189), and `durationMinutes` above is ignored.
   */
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  /** How many people. Only read alongside `serviceId`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
}
