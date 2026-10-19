import { MediaType } from '@prisma/client';
import { ServiceImageRefDto } from '../../business/dto/business-response.dto';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';
import type { ApproxSettlement } from '../../payments/approx-settlement';

/**
 * Responses that are BUILT rather than selected (§128.4).
 *
 * Appointments could be checked against `Prisma.GetPayload<{select}>` because
 * the service hands the row straight back. Discovery does not: it flattens the
 * district, rounds a distance, attaches an indicative figure and adds `saved`
 * only when somebody is signed in. There is no payload type to compare against.
 *
 * So the other half of the pattern — the service DECLARES these as its return
 * type, and TypeScript checks the implementation against the class rather than
 * the class against a query. Same guarantee, opposite direction, and the only
 * one available when a response is assembled.
 */
export class ApproxSettlementDto implements Serialised<ApproxSettlement> {
  currency!: string;
  amountMinor!: number;
  /** A decimal STRING. Read and shown, never multiplied (§56). */
  exchangeRate!: string;
  rateAsOf!: string | null;
  /** Always true. Its presence is the warning that this is not the real figure. */
  approximate!: true;
}

/** Where a branch is, flattened — "Remera, City of Kigali", not two levels. */
export class DiscoveredDistrictDto {
  id!: string;
  name!: string;
  provinceId!: string;
  provinceName!: string;
}

export class DiscoveredBusinessDto {
  id!: string;
  name!: string | null;
  logoUrl!: string | null;
  /** What a card leads with (§133). Null until the business uploads one. */
  coverImageUrl!: string | null;
  /** Its MAIN kind (§265). */
  category!: { id: string; name: string; icon: string | null } | null;
  subcategory!: { id: string; name: string } | null;
  /** Every kind of place it is, the main one first (§265). */
  kinds!: DiscoveredKindDto[];
}

/** One kind of place a business is (§265). */
export class DiscoveredKindDto {
  category!: { id: string; name: string; icon: string | null };
  subcategory!: { id: string; name: string };
  /** What the business wrote when this kind is "Other" (§267) — show it in place of "Other". */
  otherLabel!: string | null;
}

export class DiscoveredLocationDto {
  id!: string;
  name!: string;
  address!: string;
  latitude!: number | null;
  longitude!: number | null;
  /** Null until the branch says where it is; unfilterable by place until then (§104). */
  district!: DiscoveredDistrictDto | null;
  business!: DiscoveredBusinessDto;
  ratingAvg!: number | null;
  ratingCount!: number;
  /** The cheapest service here, in minor units. Null when nothing is on sale. */
  fromPriceMinor!: number | null;
  /**
   * Bookings that were paid for and not called off (§135.1). What `sort=popular`
   * ranks by, published so a client can SAY why a place is first.
   */
  bookingCount!: number;
  /** Computed from today's hours — the one field that answers "can I go now". */
  openNow!: boolean;
  /**
   * ABSENT when nobody is signed in, not false: there is no answer to "have you
   * saved this" without a "you", and false renders a heart that cannot be
   * filled (§120.2).
   */
  saved?: boolean;
  /** Only on a distance search. */
  distanceKm?: number;
  /** Only when the provider charges in a currency the platform does not price in (§66.2). */
  approxSettlement?: { fromPriceMinor: ApproxSettlementDto };
}

export class DiscoveryCentreDto {
  lat!: number;
  lng!: number;
  radiusKm?: number;
}

export class DiscoveryPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  /** Echoed back on a distance search, so a client can show what it searched. */
  center?: DiscoveryCentreDto;
  radiusKm?: number;
  locations!: DiscoveredLocationDto[];
}

// ---------------------------------------------------------------------------
// Services, across every shop (§135.2)
// ---------------------------------------------------------------------------

export class DiscoveredServiceLocationDto {
  id!: string;
  name!: string;
  district!: { id: string; name: string } | null;
  ratingAvg!: number | null;
  ratingCount!: number;
  openNow!: boolean;
  /** Only when a position was sent. */
  distanceKm?: number;
}

/**
 * One service AT one branch — the thing a customer actually books.
 *
 * Not "a service": the same haircut at two branches is two rows, because it has
 * two prices, two diaries and two places to walk to (§72). `id` is the
 * service's and `location.id` the branch's; the pair is what the booking screen
 * takes, and the pair is what makes a row unique.
 */
/**
 * A sale on today (§186). `priceMinor` beside it is already the price after
 * it; `listPriceMinor` is what it was before, for the crossed-out figure.
 */
export class ServiceDiscountDto {
  /** Whole percent off, 1–90. */
  percent!: number;
  /** The last day it runs (YYYY-MM-DD, platform time), or null: until turned off. */
  endsOn!: string | null;
  /** The moment it ends — midnight after the last day, platform time — for a countdown (§283). */
  endsAt!: string | null;
  /** One unit's price before the sale. */
  listPriceMinor!: number;
}

export class DiscoveredServiceDto {
  id!: string;
  name!: string;
  description!: string | null;
  durationMinutes!: number;
  currency!: string;
  /** This branch's price for one, as paid today: after the sale, if one is on (§186). */
  priceMinor!: number;
  /** The sale on today, or null (§186). */
  discount!: ServiceDiscountDto | null;
  /** A decimal string, like every percentage here (§128.20). */
  depositPercentage!: string;
  /** The cover photo (§132), or null — a client falls back to a category tile. */
  imageUrl!: string | null;
  /** Paid, not-called-off bookings of this service at this branch (§135.1). */
  bookingCount!: number;
  location!: DiscoveredServiceLocationDto;
  business!: DiscoveredBusinessDto;
  /** Whether this customer saved it (§158). Absent entirely for a signed-out reader. */
  @ApiProperty({ required: false, description: 'Absent entirely for a signed-out reader.' })
  saved?: boolean;
}

export class DiscoveredServicePageDto {
  total!: number;
  limit!: number;
  offset!: number;
  services!: DiscoveredServiceDto[];
}

/**
 * `implements` alone never objected to a field the select had stopped
 * providing (§128.17). These close that side.
 */
export const __approxSettlementDtoIsExact: NoExtraFields<ApproxSettlementDto, Serialised<ApproxSettlement>> = true;

// ---------------------------------------------------------------------------
// One shopfront, in full (§128.37)
// ---------------------------------------------------------------------------

export class ShopfrontCategoryDto {
  id!: string;
  name!: string;
  /** An icon key or emoji. Never a URL. */
  icon!: string | null;
}

export class ShopfrontSubcategoryDto {
  id!: string;
  name!: string;
}

export class ShopfrontBusinessDto {
  id!: string;
  name!: string | null;
  description!: string | null;
  phone!: string | null;
  logoUrl!: string | null;
  coverImageUrl!: string | null;
  /** Its MAIN kind (§265). */
  category!: ShopfrontCategoryDto | null;
  subcategory!: ShopfrontSubcategoryDto | null;
  /** Every kind of place it is, the main one first (§265). */
  kinds!: ShopfrontKindDto[];
  /** How many customers follow it (§288). */
  followers!: number;
}

/** One kind of place a business is (§265). */
export class ShopfrontKindDto {
  category!: ShopfrontCategoryDto;
  subcategory!: ShopfrontSubcategoryDto;
  /** What the business wrote when this kind is "Other" (§267) — show it in place of "Other". */
  otherLabel!: string | null;
}

export class ShopfrontRatingDto {
  /** Null when nothing has been reviewed. Not zero — zero is a rating. */
  average!: number | null;
  count!: number;
}

/**
 * A service with its price AT THIS BRANCH.
 *
 * Flattened on purpose: the per-branch join is how a price is STORED, not a
 * shape a customer should have to understand (§72).
 */
export class ShopfrontServiceDto {
  id!: string;
  name!: string;
  /** The headline under the photos on the service's page (§185). */
  title!: string | null;
  description!: string | null;
  /** What to know before coming (§180): shown before booking, and again on the reservation. */
  instructions!: string | null;
  durationMinutes!: number;
  /** The unit of account the price below is in. */
  currency!: string;
  /** A decimal string, like every percentage here (§128.20). */
  depositPercentage!: string;
  /**
   * The price of ONE person as paid today — after the sale, if one is on
   * (§186). A booking for several costs this times how many (§136); how many
   * can come at once is the branch's `capacity` (§189).
   */
  priceMinor!: number;
  /** The sale on today, or null (§186). */
  discount!: ServiceDiscountDto | null;

  /** Whether this customer saved it at this branch (§158). Absent for a signed-out reader. */
  @ApiProperty({ required: false, description: 'Absent entirely for a signed-out reader.' })
  saved?: boolean;

  /**
   * Photos of the service, cover first (§132). Empty is normal — a service
   * without photos is one nobody has photographed yet, not a broken one, and a
   * client should fall back to the shop's own picture rather than a gap.
   */
  images!: ServiceImageRefDto[];

  /** Indicative only, and absent when no rate is configured (§66.2). */
  @ApiProperty({ required: false, type: () => ApproxSettlementDto })
  approxSettlement?: ApproxSettlementDto;
}

export class ShopfrontDistrictDto {
  id!: string;
  name!: string;
  provinceId!: string;
  provinceName!: string;
}

export class ShopfrontHoursDto {
  /** 0 = Sunday, matching JavaScript rather than ISO (§12). */
  dayOfWeek!: number;
  openTime!: string;
  closeTime!: string;
  isClosed!: boolean;
}

/**
 * A date that does not follow the weekly template.
 *
 * NOTE the format: `date` here is a full ISO TIMESTAMP, because the row is
 * passed through unformatted — whereas the business's own
 * `/business/locations/{id}/schedule-exceptions` formats the same column to
 * `YYYY-MM-DD`. Two formats for one column, now both in the contract and
 * visibly different (§128.37). Left as it is deliberately: changing either is a
 * breaking change for a client already parsing it.
 */
export class ShopfrontExceptionDto {
  date!: string;
  isClosed!: boolean;
  customOpenTime!: string | null;
  customCloseTime!: string | null;
  reason!: string | null;
}

export class ShopfrontMediaDto {
  id!: string;
  url!: string;
  type!: MediaType;
  displayOrder!: number;
}

/**
 * Everything a customer sees about one branch.
 *
 * `saved` is ABSENT for a signed-out reader rather than false: there is no
 * answer to "have you saved this" without a "you" (§120). That makes this the
 * fifth per-viewer response in the API (§128.29, §128.34).
 */
export class ShopfrontDto {
  @ApiProperty({
    required: false,
    description: 'Absent entirely for a signed-out reader.',
  })
  saved?: boolean;

  id!: string;
  name!: string;
  address!: string;
  latitude!: number | null;
  longitude!: number | null;
  phone!: string | null;
  /** Concurrent appointments this branch can run. */
  capacity!: number;

  business!: ShopfrontBusinessDto;
  rating!: ShopfrontRatingDto;
  services!: ShopfrontServiceDto[];
  district!: ShopfrontDistrictDto | null;

  hours!: ShopfrontHoursDto[];
  upcomingExceptions!: ShopfrontExceptionDto[];
  gallery!: ShopfrontMediaDto[];

  /** Computed against `timeZone`, not the reader's clock (§103). */
  openNow!: boolean;
  timeZone!: string;
}
