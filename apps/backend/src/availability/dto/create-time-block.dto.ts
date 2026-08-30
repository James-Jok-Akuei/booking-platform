import { Matches, IsOptional, MaxLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTimeBlockDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date!: string;

  @Matches(HHMM, { message: 'startTime must be in HH:mm 24-hour format' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be in HH:mm 24-hour format' })
  endTime!: string;

  @IsOptional()
  @MaxLength(200)
  reason?: string;
}
