import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import {
  MAX_PAYOUT_HOLD_DAYS,
  MIN_PAYOUT_HOLD_DAYS,
} from '../platform-settings.service';

export class UpdatePayoutHoldDto {
  /**
   * Days between an appointment resolving and its money becoming payable.
   *
   * Zero is allowed and means "payable immediately" — a deliberate choice for a
   * platform that trusts its businesses, not an accident. Capped at 30: a hold
   * longer than a month stops being a settling window and starts being the
   * business financing the platform.
   */
  @Type(() => Number)
  @IsInt({ message: 'payoutHoldDays must be a whole number of days.' })
  @Min(MIN_PAYOUT_HOLD_DAYS)
  @Max(MAX_PAYOUT_HOLD_DAYS)
  payoutHoldDays!: number;
}
