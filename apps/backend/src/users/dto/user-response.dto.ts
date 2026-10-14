import {
  BusinessMemberRole,
  BusinessMemberStatus,
  BusinessStatus,
  InvitationStatus,
  MobileMoneyProvider,
  Prisma,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { AppointmentStatus } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

// ---------------------------------------------------------------------------
// The caller's own account (§128.16)
// ---------------------------------------------------------------------------

/**
 * One select, shared with the DTO describing its result (§128.5).
 *
 * Exported because this is the read whose MISSING `imageUrl` cost an hour of
 * §125: the upload worked, the file stored, the URL served, and this projection
 * simply did not return it. Nothing described the response, so the client's
 * hand-written type claimed a field the server never sent.
 */
export const ME_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  displayName: true,
  imageUrl: true,
  businessMemberships: {
    where: { status: BusinessMemberStatus.ACTIVE },
    select: {
      id: true,
      role: true,
      status: true,
      // Which branches they look after (§277), flattened before it goes out.
      allLocations: true,
      locations: { select: { locationId: true } },
      businessProfile: { select: { id: true, name: true, status: true } },
    },
  },
} as const satisfies Prisma.UserSelect;

type MeRow = Serialised<Prisma.UserGetPayload<{ select: typeof ME_SELECT }>>;

export class MeBusinessDto {
  id!: string;
  /** Nullable: a profile exists from registration, named at the first save. */
  name!: string | null;
  status!: BusinessStatus;
}

export class MeMembershipDto {
  id!: string;
  role!: BusinessMemberRole;
  status!: BusinessMemberStatus;
  /** Every branch, including ones added later (§277). Always true for the owner. */
  allLocations!: boolean;
  /** The branches they look after when not every one; empty otherwise. */
  locationIds!: string[];
  businessProfile!: MeBusinessDto;
}

/**
 * The signed-in person, as they see themselves.
 *
 * `displayName` and `imageUrl` are returned RAW: null here means "you have not
 * set one", which is a different thing to tell the owner than "Anonymous".
 *
 * A HYBRID (§128.11) — the row is selected, but the one-element membership list
 * is collapsed to a single object before it goes out, so the list field is
 * omitted from the check and the collapsed one declared beside it.
 */
/** The wire shape in one place, so both halves of the check agree. */
type MeWire = Omit<MeRow, 'businessMemberships'> & {
  businessMembership: MeMembershipDto | null;
};

export class MeDto implements MeWire {
  id!: string;
  email!: string;
  role!: UserRole;
  createdAt!: string;
  displayName!: string | null;
  imageUrl!: string | null;

  /**
   * At most one, or null. The underlying relation is a LIST only because the
   * partial unique index has to be modelled that way in Prisma; callers have
   * always seen one membership or none.
   */
  businessMembership!: MeMembershipDto | null;
}

export const __meIsExact: NoExtraFields<MeDto, MeWire> = true;

/** What is left after setting or clearing a picture. */
export class UserImageDto {
  id!: string;
  imageUrl!: string | null;
}

/** The name on this person's reviews after a change (§144). Null reads as Anonymous. */
export class UserDisplayNameDto {
  id!: string;
  displayName!: string | null;
}

// ---------------------------------------------------------------------------
// Numbers they pay from (§124.2)
// ---------------------------------------------------------------------------

export const SAVED_NUMBER_SELECT = {
  id: true,
  phoneNumber: true,
  provider: true,
  label: true,
  lastUsedAt: true,
  createdAt: true,
} as const satisfies Prisma.SavedPaymentNumberSelect;

/**
 * A number used before. A keyboard shortcut, NOT a stored payment method: MTN
 * charges by prompting the handset, so nothing kept here can be used by anybody
 * who is not holding the phone.
 */
export class SavedPaymentNumberDto
  implements Serialised<Prisma.SavedPaymentNumberGetPayload<{ select: typeof SAVED_NUMBER_SELECT }>>
{
  id!: string;
  phoneNumber!: string;
  provider!: MobileMoneyProvider | null;
  label!: string | null;
  lastUsedAt!: string | null;
  createdAt!: string;
}

// ---------------------------------------------------------------------------
// The directory an administrator reads (§94)
// ---------------------------------------------------------------------------

export class AdminUserBusinessDto {
  id!: string;
  name!: string | null;
  logoUrl!: string | null;
  role!: BusinessMemberRole;
}

export class AdminUserDto {
  id!: string;
  email!: string;
  role!: UserRole;
  displayName!: string | null;
  /** Their own photo, when they set one. */
  imageUrl!: string | null;
  createdAt!: string;
  /** When they closed their account (§122); null while it is open. */
  closedAt!: string | null;
  /**
   * When their app last renewed its session — the nearest thing to "last seen"
   * the platform keeps (§250). Null if they never signed in.
   */
  lastSeenAt!: string | null;
  /** The district they set as home, for offers (§186). */
  homeArea!: string | null;

  /**
   * So the console can stop offering an action the server refuses (§118).
   * Meaningless on a CUSTOMER or BUSINESS row, where it is simply false.
   */
  isPrimaryAdmin!: boolean;

  appointmentCount!: number;
  reviewCount!: number;
  ticketCount!: number;

  /** Where they work now. Removed memberships are history, and left out. */
  businesses!: AdminUserBusinessDto[];
}

export class AdminUserPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  users!: AdminUserDto[];
}

/** What is left of a byline after an administrator clears it (§31). */
export class ClearedDisplayNameDto {
  id!: string;
  email!: string;
  displayName!: string | null;
}

// ---------------------------------------------------------------------------
// Administrators inviting administrators (§99)
// ---------------------------------------------------------------------------

export const ADMIN_INVITATION_SELECT = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { email: true } },
} as const satisfies Prisma.AdminInvitationSelect;

export class InviterDto {
  email!: string;
}

/**
 * An invitation waiting to be taken up.
 *
 * There is no token on this row: an invitation is matched by EMAIL ADDRESS at
 * registration, so nothing here is a credential and the whole row is safe to
 * show the administrator who sent it.
 */
export class AdminInvitationDto
  implements Serialised<Prisma.AdminInvitationGetPayload<{ select: typeof ADMIN_INVITATION_SELECT }>>
{
  id!: string;
  email!: string;
  status!: InvitationStatus;
  createdAt!: string;
  expiresAt!: string;
  invitedBy!: InviterDto;
}

// ---------------------------------------------------------------------------
// Everything the platform holds about the caller (§119.2)
// ---------------------------------------------------------------------------

export const EXPORT_ACCOUNT_SELECT = {
  id: true,
  email: true,
  role: true,
  displayName: true,
  createdAt: true,
  closedAt: true,
  // What they chose about emails near them, and where "near" is (§140).
  offersOptInAt: true,
  homeDistrict: { select: { name: true } },
  // The exact spot, if they gave one (§169): theirs to see.
  homeLatitude: true,
  homeLongitude: true,
  homeLabel: true,
} as const satisfies Prisma.UserSelect;

export const EXPORT_BOOKING_SELECT = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  currency: true,
  depositAmountMinor: true,
  servicePriceMinor: true,
  depositPaidAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  service: { select: { name: true } },
  location: { select: { name: true, address: true } },
} as const satisfies Prisma.AppointmentSelect;

export const EXPORT_REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  editedAt: true,
  location: { select: { name: true } },
} as const satisfies Prisma.ReviewSelect;

export class ExportedHomeDistrictDto {
  name!: string;
}

export class ExportedAccountDto
  implements Serialised<Prisma.UserGetPayload<{ select: typeof EXPORT_ACCOUNT_SELECT }>>
{
  id!: string;
  email!: string;
  role!: UserRole;
  displayName!: string | null;
  createdAt!: string;
  closedAt!: string | null;
  /** When they agreed to emails about services near them; null if they have not. */
  offersOptInAt!: string | null;
  homeDistrict!: ExportedHomeDistrictDto | null;
  homeLatitude!: number | null;
  homeLongitude!: number | null;
  homeLabel!: string | null;
}

export class ExportedServiceDto {
  name!: string;
}

export class ExportedLocationDto {
  name!: string;
  address!: string;
}

export class ExportedBookingDto
  implements Serialised<Prisma.AppointmentGetPayload<{ select: typeof EXPORT_BOOKING_SELECT }>>
{
  id!: string;
  status!: AppointmentStatus;
  startTime!: string;
  endTime!: string;
  currency!: string;
  depositAmountMinor!: number;
  servicePriceMinor!: number;
  depositPaidAt!: string | null;
  cancelledAt!: string | null;
  cancellationReason!: string | null;
  createdAt!: string;
  service!: ExportedServiceDto;
  location!: ExportedLocationDto;
}

export class ExportedReviewLocationDto {
  name!: string;
}

export class ExportedReviewDto
  implements Serialised<Prisma.ReviewGetPayload<{ select: typeof EXPORT_REVIEW_SELECT }>>
{
  id!: string;
  rating!: number;
  comment!: string | null;
  createdAt!: string;
  editedAt!: string | null;
  location!: ExportedReviewLocationDto;
}

/** `from` is a WORD, not an id — this document is read by the person, not a program. */
export class ExportedChatMessageDto {
  from!: 'you' | 'the business';
  body!: string | null;
  photoUrl!: string | null;
  sentAt!: string;
}

export class ExportedConversationDto {
  id!: string;
  /**
   * Who they were talking to, by name — null if that business never set one.
   * Nullable because `BusinessProfile.name` is: the profile exists from
   * registration and is named at the first save. Three DTOs in this slice
   * assumed otherwise before the compiler said so (§128.18).
   */
  with!: string | null;
  startedAt!: string;
  messages!: ExportedChatMessageDto[];
}

export class ExportedTicketMessageDto {
  from!: 'you' | 'support';
  body!: string;
  sentAt!: string;
}

export class ExportedTicketDto {
  id!: string;
  subject!: string;
  status!: TicketStatus;
  createdAt!: string;
  /** Internal notes are excluded: they are support's working-out, not a record
   * of what this person was told. */
  messages!: ExportedTicketMessageDto[];
}

/**
 * A copy of everything, for the person it is about.
 *
 * The field names are the plain-language ones — `bookings`, `conversations` —
 * because a reader opening this file should not need the schema to understand
 * whose words are whose.
 */
export class AccountExportDto {
  exportedAt!: string;
  account!: ExportedAccountDto;
  bookings!: ExportedBookingDto[];
  reviews!: ExportedReviewDto[];
  conversations!: ExportedConversationDto[];
  supportTickets!: ExportedTicketDto[];
}

export const __savedPaymentNumberDtoIsExact: NoExtraFields<
  SavedPaymentNumberDto,
  Serialised<Prisma.SavedPaymentNumberGetPayload<{ select: typeof SAVED_NUMBER_SELECT }>>
> = true;

export const __adminInvitationDtoIsExact: NoExtraFields<
  AdminInvitationDto,
  Serialised<Prisma.AdminInvitationGetPayload<{ select: typeof ADMIN_INVITATION_SELECT }>>
> = true;

export const __exportedAccountDtoIsExact: NoExtraFields<
  ExportedAccountDto,
  Serialised<Prisma.UserGetPayload<{ select: typeof EXPORT_ACCOUNT_SELECT }>>
> = true;

export const __exportedBookingDtoIsExact: NoExtraFields<
  ExportedBookingDto,
  Serialised<Prisma.AppointmentGetPayload<{ select: typeof EXPORT_BOOKING_SELECT }>>
> = true;

export const __exportedReviewDtoIsExact: NoExtraFields<
  ExportedReviewDto,
  Serialised<Prisma.ReviewGetPayload<{ select: typeof EXPORT_REVIEW_SELECT }>>
> = true;
