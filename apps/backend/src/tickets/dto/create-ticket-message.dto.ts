import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateTicketMessageDto {
  @IsString()
  @Length(1, 5000)
  body!: string;

  /**
   * Admin-only. Ignored entirely on the reporter-facing endpoint, and rejected
   * for non-admins on the admin endpoint, so a reporter can never author a note
   * they would then be unable to see.
   *
   * Arrives as a multipart text field, hence the explicit transform.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isInternal?: boolean;
}
