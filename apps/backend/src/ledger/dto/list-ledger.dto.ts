import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LedgerEntryType } from '@prisma/client';

export class ListLedgerEntriesDto {
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsUUID()
  payoutId?: string;

  @IsOptional()
  @IsEnum(LedgerEntryType)
  type?: LedgerEntryType;

  /** Part of a shop's name (§251). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Written at or after this instant (§251). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Written before this instant (§251). */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListAdjustmentsDto {
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;

  /** Only those still to execute, or only those executed (§251). */
  @IsOptional()
  @IsIn(['outstanding', 'executed'])
  state?: 'outstanding' | 'executed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
