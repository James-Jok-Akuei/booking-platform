import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CHOICE_LIMITS } from '../../business/service-choices';
import { MAX_PICKS_SENT } from './create-appointment.dto';

/**
 * Changing wishes after booking (§300.7): until 2 hours before, the answers
 * to questions that change neither the price nor the time — "no salt", a
 * quiet room, allergies — and the note. Answers that changed the price or
 * the time stay as booked.
 */
export class UpdateBookingChoicesDto {
  /**
   * Every answer wanted now to the questions that can still change — the
   * whole set for those, so leaving one out takes it off. Answers to the
   * others are kept as booked and need not be sent.
   */
  @IsArray()
  @ArrayMaxSize(MAX_PICKS_SENT)
  @IsUUID('all', { each: true })
  optionIds!: string[];

  /** The note to the shop. Blank or null takes it off; left out, it stays. */
  @IsOptional()
  @IsString()
  @MaxLength(CHOICE_LIMITS.note)
  note?: string | null;
}
