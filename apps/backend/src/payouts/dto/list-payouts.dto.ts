import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PayoutStatus } from '@prisma/client';

export class ListPayoutsDto {
  /** Admin listing only; the business-scoped route takes it from the path. */
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

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
