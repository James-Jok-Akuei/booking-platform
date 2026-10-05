import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  serviceId!: string;

  /**
   * Requested start, as an ISO-8601 instant (e.g. "2026-09-15T07:00:00.000Z").
   *
   * Only the start is accepted. endTime is derived server-side from the
   * service's durationMinutes — letting a client send it would let them book a
   * 15-minute slot for a 4-hour service.
   */
  @IsDateString({}, { message: 'startTime must be an ISO-8601 date-time string.' })
  startTime!: string;

  /**
   * How many (§136). Left out, it is one — what every booking was.
   *
   * What it MEANS is the service's to say: people, or units of the thing. The
   * service's own maximum is checked in the service, where the row is loaded;
   * the 20 here only bounds the type.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  quantity?: number;
}
