import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PayoutDestinationStatus } from '@prisma/client';

export class ListPayoutDestinationsDto {
  @IsOptional()
  @IsEnum(PayoutDestinationStatus)
  status?: PayoutDestinationStatus;

  /**
   * A word to find payout numbers by (§289): the number itself, typed any way;
   * a shop's name, phone or a member's email; a branch's name, street,
   * district or province; or the email of the person who gave it.
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
