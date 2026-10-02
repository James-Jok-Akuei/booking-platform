import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListThreadsDto {
  /**
   * Narrows to the thread created with one booking (§21.1).
   *
   * Added because a booking screen needs to open ITS conversation, and the only
   * way to find it was to page through every thread looking for a matching
   * `appointment.id` — which works until a customer has more threads than a
   * page holds, and then silently opens the wrong one or none (§112.2).
   *
   * Still scoped to the caller like every other listing here, so an appointment
   * id belonging to someone else simply matches nothing.
   */
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
