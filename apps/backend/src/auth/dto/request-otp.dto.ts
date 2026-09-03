import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class RequestOtpDto {
  @IsEmail()
  email: string;

  /**
   * Which kind of account to CREATE, when this email has never signed up.
   *
   * Optional, and ignored entirely for an email that already exists — that user
   * logs in as whoever they already are, and the body does not get a vote
   * (§50.1). Required only for a genuinely new email, enforced in the service
   * where the answer to "does this user exist?" is known.
   *
   * Still restricted to BUSINESS | CUSTOMER, so ADMIN accounts remain
   * impossible to self-register (§3). That was always the rule; the bug was
   * that it also made existing admins impossible to AUTHENTICATE.
   */
  @IsOptional()
  @IsIn(['BUSINESS', 'CUSTOMER'])
  role?: 'BUSINESS' | 'CUSTOMER';
}
