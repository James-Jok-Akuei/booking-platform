import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
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

  /** Every branch, including ones added later (§277). Left out: every branch. */
  @IsOptional()
  @IsBoolean()
  allLocations?: boolean;

  /** The branches they will look after, when not every one. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}
