import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { BillingAdjustmentType, TicketStatus } from '@prisma/client';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

/**
 * Optional payload an admin may attach when resolving a ticket.
 *
 * Recording a decision, not moving money. FEE_REFUND says the platform fee
 * taken at booking should go back to the customer (the business-cancelled
 * case); GATEWAY_FEE_DEBIT says the provider's charge on that refund is borne
 * by the business. Nothing settles either yet — see DECISIONS.md §25.
 */
export class BillingAdjustmentDto {
  @IsUUID()
  appointmentId!: string;

  @IsEnum(BillingAdjustmentType, {
    message: `type must be one of: ${Object.values(BillingAdjustmentType).join(', ')}`,
  })
  type!: BillingAdjustmentType;

  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(2)
  @Min(0.01, { message: 'amount must be greater than zero.' })
  amount!: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus, {
    message: `status must be one of: ${Object.values(TicketStatus).join(', ')}`,
  })
  status!: TicketStatus;

  /** Required when moving to RESOLVED; enforced in the service. */
  @IsOptional()
  @IsString()
  @Length(3, 5000)
  resolutionNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingAdjustmentDto)
  billingAdjustment?: BillingAdjustmentDto;
}
