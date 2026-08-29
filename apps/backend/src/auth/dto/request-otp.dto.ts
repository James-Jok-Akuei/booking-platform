import { IsEmail, IsIn } from 'class-validator';

export class RequestOtpDto {
  @IsEmail()
  email: string;

  // Which app is calling this — determines what kind of account gets
  // created if this email has never signed up before.
  // ADMIN accounts are never self-service created here (see admin portal module).
  @IsIn(['BUSINESS', 'CUSTOMER'])
  role: 'BUSINESS' | 'CUSTOMER';
}
