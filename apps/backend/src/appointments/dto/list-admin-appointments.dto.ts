import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AppointmentStatus, CancelledBy } from '@prisma/client';

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
