import { IsEmail, Length } from 'class-validator';

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
}
