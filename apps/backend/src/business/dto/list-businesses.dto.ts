import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BusinessStatus } from '@prisma/client';

export class ListBusinessesDto {
  /** Omit for every business, whatever its status. */
  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

  /**
   * A word to find a business by (§244): part of its name, its phone, or a
   * member's email, any case. Searched by the database, so a long list is
   * never loaded to be filtered in the browser.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /**
   * 'true' — only shops that have sent themselves for review; 'false' — only
   * those still setting up (§255). Omit for both.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  submitted?: 'true' | 'false';

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
