import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PayoutStatus } from '@prisma/client';

/** A page of the bookings inside one payout (§290). */
export class PayoutDetailQueryDto {
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

export class ListPayoutsDto {
  /** Admin listing only; the business-scoped route takes it from the path. */
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  /**
   * A word to find payouts by (§289): a shop's name, phone or a member's
   * email; a branch's name, street, district or province; a payout number,
   * typed any way; or the transfer's reference.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

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
