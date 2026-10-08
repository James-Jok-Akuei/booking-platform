import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

/**
 * Which end of the list matters.
 *
 * `LATEST` is the default because it is what the business app has always got:
 * a schedule is read from the most recent backwards. A customer looking at
 * "what's next" needs the opposite, and reversing a page on the client would
 * order 25 rows correctly while putting the FURTHEST-away booking on page one
 * (§110.2).
 */
export enum AppointmentOrder {
  SOONEST = 'soonest',
  LATEST = 'latest',
}

export class ListAppointmentsDto {
  @IsOptional()
  @IsEnum(AppointmentStatus, {
    message: `status must be one of: ${Object.values(AppointmentStatus).join(', ')}`,
  })
  status?: AppointmentStatus;

  /** Inclusive lower bound on startTime. */
  @IsOptional()
  @IsDateString({}, { message: 'from must be an ISO-8601 date-time string.' })
  from?: string;

  /** Exclusive upper bound on startTime. */
  @IsOptional()
  @IsDateString({}, { message: 'to must be an ISO-8601 date-time string.' })
  to?: string;

  /**
   * One branch only (§213). Combined with the caller's own scope, so another
   * business's branch simply matches nothing.
   */
  @IsOptional()
  @IsUUID('all', { message: 'locationId must be a branch id.' })
  locationId?: string;

  /**
   * Find (§213): part of the customer's email, the service's name or the
   * branch's name — or the reservation number the customer's app shows
   * ("3F2A-1C9B", the first eight characters of the booking's id).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(AppointmentOrder, {
    message: `sort must be one of: ${Object.values(AppointmentOrder).join(', ')}`,
  })
  sort?: AppointmentOrder;

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
