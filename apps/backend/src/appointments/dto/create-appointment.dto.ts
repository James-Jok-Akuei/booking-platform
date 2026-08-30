import { IsDateString, IsUUID } from 'class-validator';

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
}
