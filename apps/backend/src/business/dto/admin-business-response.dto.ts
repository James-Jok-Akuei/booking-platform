import { BusinessStatus, MediaStatus, MobileMoneyProvider, PayoutDestinationStatus, Prisma } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';
import { BusinessReadinessDto } from './readiness.dto';

/**
 * A business in the moderation queue (§29), and in full on its own panel (§117.2).
 *
 * Two shapes on purpose: the list carries what a queue needs to be read, and the
 * detail adds what an approval decision actually rests on — where they work
 * from, what they sell and for how much at each branch, and who can act for
 * them. §117 found that detail returning three fields no client could see.
 */
export const ADMIN_BUSINESS_SELECT = {
  id: true,
  name: true,
  description: true,
  phone: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  statusChangedById: true,
  // When it last sent itself for review, and what a past rejection said (§255).
  submittedAt: true,
  lastRejectionReason: true,
  logoUrl: true,
  coverImageUrl: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  // Every kind of place it is, the main one first (§265).
  kinds: {
    orderBy: { position: 'asc' },
    select: {
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true } },
      // What the business wrote under "Other" (§267) — checked at review.
      otherLabel: true,
    },
  },
} as const;

export class AdminBusinessCategoryDto {
  id!: string;
  name!: string;
}

/** One kind of place a business is (§265). */
export class AdminBusinessKindDto {
  category!: AdminBusinessCategoryDto;
  subcategory!: AdminBusinessCategoryDto;
  /** What the business wrote when this kind is "Other" (§267). */
  otherLabel!: string | null;
}

type AdminBusinessPayload = Serialised<
  Prisma.BusinessProfileGetPayload<{ select: typeof ADMIN_BUSINESS_SELECT }>
>;

export class AdminBusinessDto implements AdminBusinessPayload {
  id!: string;
  name!: string | null;
  description!: string | null;
  phone!: string | null;

  /** What an admin decided. The four values, not `string` (§128.8). */
  status!: BusinessStatus;
  /**
   * Why it is in that status — the rejection or suspension reason, cleared on
   * approval because a stale one beside an APPROVED business reads as an
   * accusation (§42.2).
   */
  statusReason!: string | null;
  statusChangedAt!: string | null;
  statusChangedById!: string | null;
  /** When it last sent itself for review; null while it is still setting up (§255). */
  submittedAt!: string | null;
  /** What the last rejection said, kept after the shop sends itself back (§255). */
  lastRejectionReason!: string | null;

  logoUrl!: string | null;
  coverImageUrl!: string | null;
  createdAt!: string;
  /** Its MAIN kind (§265). */
  category!: AdminBusinessCategoryDto | null;
  subcategory!: AdminBusinessCategoryDto | null;
  /** Every kind of place it is, the main one first (§265). */
  kinds!: AdminBusinessKindDto[];
}

export class AdminBusinessPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  businesses!: AdminBusinessDto[];
}

// ---------------------------------------------------------------------------
// The detail panel (§117.2)
// ---------------------------------------------------------------------------

export class AdminLocationPlaceDto {
  name!: string;
}

export class AdminLocationDistrictDto {
  name!: string;
  province!: AdminLocationPlaceDto;
}

export class AdminMediaDto {
  url!: string;
  /** Photos are checked separately (§132); shown here whatever their state. */
  status!: MediaStatus;
}

export class AdminBusinessLocationDto {
  id!: string;
  name!: string;
  address!: string;
  capacity!: number;
  /** The pin, when they have placed one (§157). */
  latitude!: number | null;
  longitude!: number | null;
  /** False once the branch is closed (§89). */
  isActive!: boolean;
  district!: AdminLocationDistrictDto | null;
  /** Up to six of the branch's photos, in the shop's order. */
  media!: AdminMediaDto[];
}

export class AdminServiceImageDto {
  url!: string;
}

export class AdminPayoutNumberDto {
  msisdn!: string;
  provider!: MobileMoneyProvider;
  status!: PayoutDestinationStatus;
}

export class AdminServiceOfferDto {
  priceMinor!: number;
  location!: AdminBusinessCategoryDto;
}

export class AdminBusinessServiceDto {
  id!: string;
  name!: string;
  durationMinutes!: number;
  /** A decimal STRING — read, never multiplied (§56). */
  depositPercentage!: string;
  isActive!: boolean;
  description!: string | null;
  /** The cover photo (§132), if there is one. */
  images!: AdminServiceImageDto[];
  /** Price is per BRANCH since §72, so a service can cost different amounts. */
  locations!: AdminServiceOfferDto[];
}

export class AdminBusinessMemberUserDto {
  id!: string;
  email!: string;
}

export class AdminBusinessMemberDto {
  id!: string;
  role!: string;
  user!: AdminBusinessMemberUserDto;
}

export class AdminBusinessDetailDto extends AdminBusinessDto {
  locations!: AdminBusinessLocationDto[];
  services!: AdminBusinessServiceDto[];
  /** ACTIVE members only. Removed ones stay as history and grant nothing (§14). */
  members!: AdminBusinessMemberDto[];
  /** The latest payout number they gave, if any — at most one (§48, §244). */
  payoutDestinations!: AdminPayoutNumberDto[];
  /** Its checklist, worked out by the same rules the shop sees (§255). */
  readiness!: BusinessReadinessDto;
}

/**
 * `implements` alone never objected to a field the select had stopped
 * providing (§128.17). These close that side.
 */
export const __adminBusinessDtoIsExact: NoExtraFields<AdminBusinessDto, AdminBusinessPayload> = true;
