import { IsEmail } from 'class-validator';

export class InviteAdminDto {
  @IsEmail({}, { message: 'A valid email address is required.' })
  email!: string;
}
