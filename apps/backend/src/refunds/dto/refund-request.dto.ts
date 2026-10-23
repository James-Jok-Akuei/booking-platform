import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { RefundStatus } from '@prisma/client';

export class ListRefundsDto {
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

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

export class MarkRefundSentDto {
  /** The operator's reference for the transfer our team made — what reconciles it against the statement. */
  @IsString()
  @Length(3, 200)
  reference!: string;

  /** The number it went to, when it was not the one on record (an older booking, or one the customer gave). */
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ]{9,16}$/, { message: 'A phone number is 9 to 15 digits.' })
  phoneNumber?: string;
}
