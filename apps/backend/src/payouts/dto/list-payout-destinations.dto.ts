import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PayoutDestinationStatus } from '@prisma/client';

export class ListPayoutDestinationsDto {
  @IsOptional()
  @IsEnum(PayoutDestinationStatus)
  status?: PayoutDestinationStatus;

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
