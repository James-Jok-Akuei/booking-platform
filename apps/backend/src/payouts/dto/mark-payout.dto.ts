import { IsString, Length } from 'class-validator';

export class MarkPaidDto {
  /**
   * The provider's reference for the transfer. Required: a payout marked paid
   * with nothing to look it up by cannot be reconciled against a statement, and
   * the statement is the only thing that proves the money left.
   */
  @IsString()
  @Length(3, 200)
  reference!: string;
}

export class MarkFailedDto {
  /**
   * Required, like every other moderation reason here. Marking a payout failed
   * puts its money back in the pool, and someone will ask later why it did not
   * go out.
   */
  @IsString()
  @Length(3, 500)
  reason!: string;
}
