import { BusinessStatus, Prisma } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

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
  logoUrl: true,
  coverImageUrl: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
} as const;

export class AdminBusinessCategoryDto {
  id!: string;
  name!: string;
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

  logoUrl!: string | null;
  coverImageUrl!: string | null;
  createdAt!: string;
  category!: AdminBusinessCategoryDto | null;
  subcategory!: AdminBusinessCategoryDto | null;
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

export class AdminBusinessLocationDto {
  id!: string;
  name!: string;
  address!: string;
  capacity!: number;
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
}

/**
 * `implements` alone never objected to a field the select had stopped
 * providing (§128.17). These close that side.
 */
export const __adminBusinessDtoIsExact: NoExtraFields<AdminBusinessDto, AdminBusinessPayload> = true;
