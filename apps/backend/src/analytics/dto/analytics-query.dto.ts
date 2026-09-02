import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AnalyticsQueryDto {
  /** Omit for the business-wide roll-up across every location. */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** Inclusive lower bound on appointment startTime. Defaults to 30 days ago. */
  @IsOptional()
  @IsDateString({}, { message: 'from must be an ISO-8601 date-time string.' })
  from?: string;

  /** EXCLUSIVE upper bound on appointment startTime. Defaults to now. */
  @IsOptional()
  @IsDateString({}, { message: 'to must be an ISO-8601 date-time string.' })
  to?: string;
}
