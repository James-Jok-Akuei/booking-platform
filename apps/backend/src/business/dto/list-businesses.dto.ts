import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BusinessStatus } from '@prisma/client';

export class ListBusinessesDto {
  /** Omit for every business, whatever its status. */
  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

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
