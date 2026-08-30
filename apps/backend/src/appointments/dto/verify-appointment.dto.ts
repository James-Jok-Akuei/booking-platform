import { Matches } from 'class-validator';

export class VerifyAppointmentDto {
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit verification code.' })
  code!: string;
}
