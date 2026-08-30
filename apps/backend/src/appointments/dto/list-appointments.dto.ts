import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

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
