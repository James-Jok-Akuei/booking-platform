import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

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

  /**
   * What the payment gateway charged to process the refund, in cents. REQUIRED
   * when a business cancels an appointment whose deposit was paid.
   *
   * Supplied, never derived. The MoMo integration does not report its own
   * charge on a transaction or a refund (§36.2), so computing it from a
   * percentage constant would put a number in the ledger that the provider's
   * statement contradicts — and a ledger that cannot be reconciled is not
   * doing its job. Zero is allowed: sometimes there is no charge.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'gatewayChargeCents must be a whole number of cents.' })
  @Min(0)
  gatewayChargeCents?: number;
}

/**
 * An admin reclassifying an appointment as business-cancelled, having resolved
 * a dispute in the customer's favour (§36.4).
 */
export class ReclassifyCancellationDto {
  @IsString()
  @Length(3, 500)
  reason!: string;

  /** The ticket the decision came out of, so the reclassification is auditable. */
  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @Type(() => Number)
  @IsInt({ message: 'gatewayChargeCents must be a whole number of cents.' })
  @Min(0)
  gatewayChargeCents!: number;
}
