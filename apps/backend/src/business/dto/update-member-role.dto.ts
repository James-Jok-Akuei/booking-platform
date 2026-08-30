import { IsIn } from 'class-validator';
import { BusinessMemberRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  // Same reasoning as InviteMemberDto: OWNER is unreachable through the API.
  @IsIn([BusinessMemberRole.MANAGER, BusinessMemberRole.STAFF], {
    message: 'role must be MANAGER or STAFF.',
  })
  role!: typeof BusinessMemberRole.MANAGER | typeof BusinessMemberRole.STAFF;
}
