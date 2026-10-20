import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { CHOICE_LIMITS } from '../../business/service-choices';
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

  /**
   * The answers picked so far (§300), as option ids separated by commas.
   * Only read alongside `serviceId`: their extra minutes are added to the
   * service's length, so every time offered fits what was chosen.
   */
  @ApiProperty({
    required: false,
    type: String,
    description: 'Option ids, separated by commas.',
    example: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90,9d1e4c2b-7a3f-4b8e-8c11-2f6e5d4c3b2a',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(CHOICE_LIMITS.groups * CHOICE_LIMITS.options)
  @IsUUID('all', { each: true })
  options?: string[];
}
