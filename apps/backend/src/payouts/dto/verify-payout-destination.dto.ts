import { IsString, Length } from 'class-validator';

export class VerifyPayoutDestinationDto {
  /**
   * How the admin confirmed the number belongs to this business.
   *
   * Required. This is the record of the only irreversible decision the platform
   * makes — "verified" with no account of how is not something anyone can audit
   * after money has gone to the wrong place.
   */
  @IsString()
  @Length(3, 500)
  verificationNote!: string;
}

export class RejectPayoutDestinationDto {
  /** Required: the business has to be told what to fix. */
  @IsString()
  @Length(3, 500)
  reason!: string;
}
