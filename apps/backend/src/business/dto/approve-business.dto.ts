import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ADVICE_KEYS, ADVICE_NOTE_MAX, type AdviceKey } from '../shop-advice';

/**
 * An approval, with advice for the shop if the reviewer wants to send some
 * (§303): which of the things still missing to mention, and a note in their
 * own words. Both optional — an approval with neither is the plain one.
 */
export class ApproveBusinessDto {
  @ApiProperty({ enum: ADVICE_KEYS, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADVICE_KEYS.length)
  @IsIn(ADVICE_KEYS, { each: true })
  advice?: AdviceKey[];

  /** Sent to the shop as it is written, so write it for them to read. */
  @IsOptional()
  @IsString()
  @MaxLength(ADVICE_NOTE_MAX)
  note?: string;
}
