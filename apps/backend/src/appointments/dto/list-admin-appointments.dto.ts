import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { AppointmentOrder } from './list-appointments.dto';

/**
 * What an admin is looking for in the appointment list (§95).
 *
 * Shaped around the one thing they can do here — reclassify a cancellation —
 * rather than around browsing. `reclassifiable` is the filter that matters:
 * cancelled, blamed on the customer, and with a deposit actually taken, which
 * is the only combination where reclassifying moves money.
 */
export class ListAdminAppointmentsDto {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(CancelledBy)
  cancelledBy?: CancelledBy;

  /** 'true' narrows to cancellations that could still be reclassified. */
  @IsOptional()
  reclassifiable?: string;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  /**
   * The reservation number the customer quotes ("3F2A-1C9B"), or part of the
   * customer's email or name, the shop's, branch's or service's name (§249).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Latest start first unless asked otherwise (§249). */
  @IsOptional()
  @IsEnum(AppointmentOrder, { message: `sort must be one of: ${Object.values(AppointmentOrder).join(', ')}` })
  sort?: AppointmentOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
