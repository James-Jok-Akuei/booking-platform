import { IsString, Length } from 'class-validator';

export class ClearDisplayNameDto {
  /**
   * Required, exactly as it is for hiding a review (§28): moderation with no
   * recorded reason cannot be reviewed later or explained to the customer it
   * happened to — and the customer is told, so there has to be something to
   * tell them.
   */
  @IsString()
  @Length(3, 500)
  reason!: string;
}
