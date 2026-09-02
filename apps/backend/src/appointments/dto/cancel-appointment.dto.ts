import { IsOptional, IsString, Length } from 'class-validator';

export class CancelAppointmentDto {
  /**
   * Optional in the shape, REQUIRED when a business cancels — enforced in the
   * service, because only the service knows which side the caller is on.
   *
   * A business cancellation costs the business money under §25, so it should be
   * a deliberate act with a stated reason. A customer cancelling their own
   * booking owes nobody an explanation.
   */
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
