import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Email and code, and nothing else.
 *
 * `role` used to be required here too. It was redundant — the request step had
 * already taken it — and it was actively wrong: a client had to carry a value
 * across two calls, and sending the wrong one failed a login that should have
 * succeeded (§50.1).
 */
export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @Length(6, 6)
  code: string;

  /**
   * An administrator's second step (§298): the 6 digits from their
   * authenticator app, or one of their recovery codes ("xxxx-xxxx"). Sent
   * once the server has asked for it with TWO_STEP_REQUIRED.
   */
  @IsOptional()
  @IsString()
  @Length(6, 12)
  twoStepCode?: string;

  /**
   * The app asking (§308.6): an account it is not for is told where it
   * belongs, before anything else and without being signed in.
   */
  @IsOptional()
  @IsIn(['business', 'customer'])
  app?: 'business' | 'customer';
}
