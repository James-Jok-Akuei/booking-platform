import { IsString, Length } from 'class-validator';

export class HideReviewDto {
  /**
   * Required. Hiding customer feedback without recording why is the kind of
   * moderation that cannot be reviewed later or explained in a dispute.
   */
  @IsString()
  @Length(3, 500)
  hiddenReason!: string;
}
