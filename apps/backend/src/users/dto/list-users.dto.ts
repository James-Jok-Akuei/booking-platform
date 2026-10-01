import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole } from '@prisma/client';

export class ListUsersDto {
  @IsOptional()
  @IsEnum(UserRole, {
    message: `role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole;

  /** Matches email or display name, case-insensitively. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /**
   * Only accounts that currently have a display name.
   *
   * The one moderation action here clears that name, so this is the filter
   * that turns a user list into a queue of things that can be acted on.
   */
  @IsOptional()
  @Type(() => String)
  withDisplayName?: string;

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
