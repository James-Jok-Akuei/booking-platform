import { IsOptional, IsString, Length } from 'class-validator';

export class ExecuteAdjustmentDto {
  /**
   * The provider's reference for the money movement, where there is one.
   *
   * Optional, unlike a payout's: some adjustments are settled by netting
   * against a future payout rather than by a separate transfer, and inventing a
   * reference for those would make a reconciliation look complete when it is
   * not.
   */
  @IsOptional()
  @IsString()
  @Length(3, 200)
  settlementRef?: string;
}
