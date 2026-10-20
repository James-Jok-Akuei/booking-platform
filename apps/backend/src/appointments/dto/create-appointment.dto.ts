import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHOICE_LIMITS } from '../../business/service-choices';

/** Every answer a service could have picked at once: six questions of twelve. */
export const MAX_PICKS_SENT = CHOICE_LIMITS.groups * CHOICE_LIMITS.options;

export class CreateAppointmentDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  serviceId!: string;

  /**
   * Requested start, as an ISO-8601 instant (e.g. "2026-09-15T07:00:00.000Z").
   *
   * Only the start is accepted. endTime is derived server-side from the
   * service's durationMinutes — letting a client send it would let them book a
   * 15-minute slot for a 4-hour service.
   */
  @IsDateString({}, { message: 'startTime must be an ISO-8601 date-time string.' })
  startTime!: string;

  /**
   * How many people (§136, §189). Left out, it is one — what every booking was.
   *
   * Each person takes one of the branch's places, so the most is the places
   * the branch has; that is checked in the service, where the branch is
   * loaded. The 1000 here only bounds the type.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  /**
   * The answers picked (§300): ids of this service's options. Checked
   * against its questions — each one that must be answered is, one answer
   * where one is asked, nothing "not available now". Their prices are added
   * once to the booking and their minutes to its length; both are worked
   * out here, never sent.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PICKS_SENT)
  @IsUUID('all', { each: true })
  optionIds?: string[];

  /** A short note to the shop (§300.5), when the service takes one. */
  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.note)
  note?: string | null;
}
