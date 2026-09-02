import { IsString, Length } from 'class-validator';

/**
 * The body for a rejection or a suspension.
 *
 * A reason is required because both are things the business is told about, and
 * being suspended without being told why is worse than the suspension — the
 * business cannot fix what it has not been told.
 */
export class ChangeBusinessStatusDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
