import { IsBoolean, IsOptional, Matches, MaxLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleExceptionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date!: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  // Cross-field rules (both-or-neither, must not accompany isClosed, close
  // after open) are enforced in the service, where the combination is visible.
  @IsOptional()
  @Matches(HHMM, { message: 'customOpenTime must be in HH:mm 24-hour format' })
  customOpenTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'customCloseTime must be in HH:mm 24-hour format' })
  customCloseTime?: string;

  @IsOptional()
  @MaxLength(200)
  reason?: string;
}
