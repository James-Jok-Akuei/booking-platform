import {
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  Prisma,
} from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

/**
 * Who works in a business, and who has been asked to (§128.24).
 *
 * The membership responses are BUILT — the user's id and address are lifted out
 * of the relation and put beside the role — so the service declares them and
 * `createdAt` is an ISO string at the source (§128.9).
 */
export class BusinessMemberDto {
  /** The MEMBERSHIP id, which is what the role and remove routes take. */
  id!: string;
  /** The person. A different id, and not interchangeable with the one above. */
  userId!: string;
  email!: string;
  role!: BusinessMemberRole;
  status!: BusinessMemberStatus;
  /** When they joined. */
  createdAt!: string;
  /** Every branch, including ones added later (§277). Always true for the owner. */
  allLocations!: boolean;
  /** The branches they look after when not every one; empty otherwise. */
  locationIds!: string[];
}

/** What is left after removing somebody: a sentence, and the retired row. */
export class RemovedMembershipDto {
  id!: string;
  /** REMOVED. The row is never dropped — it is the record that they were here. */
  status!: BusinessMemberStatus;
}

export class RemovedMemberDto {
  /** Names the person, so the screen can say who was removed. */
  message!: string;
  membership!: RemovedMembershipDto;
}

/** One select, shared with the DTO describing its result (§128.5). */
export const BUSINESS_INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  // The branches they will look after once they join (§277).
  allLocations: true,
  locationIds: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { id: true, email: true } },
} as const satisfies Prisma.BusinessInvitationSelect;

type BusinessInvitationRow = Serialised<
  Prisma.BusinessInvitationGetPayload<{
    select: typeof BUSINESS_INVITATION_SELECT;
  }>
>;

export class InvitedByDto {
  id!: string;
  email!: string;
}

/**
 * An invitation waiting to be accepted.
 *
 * No token on the row: an invitation is matched by EMAIL ADDRESS at OTP
 * verification, so nothing here is a credential.
 *
 * `role` is MANAGER or STAFF, never OWNER — ownership transfer does not exist,
 * so there is no path by which an invitation creates a second owner.
 */
export class BusinessInvitationDto implements BusinessInvitationRow {
  id!: string;
  email!: string;
  role!: BusinessMemberRole;
  /** Every branch, including ones added later (§277). */
  allLocations!: boolean;
  /** The branches they will look after when not every one; empty otherwise. */
  locationIds!: string[];
  status!: InvitationStatus;
  createdAt!: string;
  expiresAt!: string;
  invitedBy!: InvitedByDto;
}

export const __businessInvitationDtoIsExact: NoExtraFields<
  BusinessInvitationDto,
  BusinessInvitationRow
> = true;
