import { IsEmail, IsIn } from 'class-validator';
import { BusinessMemberRole } from '@prisma/client';

export class InviteMemberDto {
  @IsEmail({}, { message: 'A valid email address is required.' })
  email!: string;

  // OWNER is deliberately not accepted. There is exactly one owner per
  // business and no ownership transfer in MVP, so no invitation may mint one.
  @IsIn([BusinessMemberRole.MANAGER, BusinessMemberRole.STAFF], {
    message: 'role must be MANAGER or STAFF.',
  })
  role!: typeof BusinessMemberRole.MANAGER | typeof BusinessMemberRole.STAFF;
}
