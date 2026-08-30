import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class LocationHoursEntryDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number; // 0 = Sunday ... 6 = Saturday (JS Date.getDay())

  // Required even when isClosed is true — the service normalises a closed day's
  // times rather than letting them be omitted, so every row is well-formed and
  // reopening a day is a one-field edit.
  @Matches(HHMM, { message: 'openTime must be in HH:mm 24-hour format' })
  openTime!: string;

  @Matches(HHMM, { message: 'closeTime must be in HH:mm 24-hour format' })
  closeTime!: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}

export class SetLocationHoursDto {
  // Replaces the whole week in one call, so the payload must be a full week —
  // partial updates would leave the location in a half-defined state where it
  // is ambiguous whether a missing day means "closed" or "unchanged".
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => LocationHoursEntryDto)
  hours!: LocationHoursEntryDto[];
}
