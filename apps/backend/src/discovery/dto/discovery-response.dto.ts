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
  category!: { id: string; name: string; icon: string | null } | null;
  subcategory!: { id: string; name: string } | null;
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
  category!: ShopfrontCategoryDto | null;
  subcategory!: ShopfrontSubcategoryDto | null;
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
  description!: string | null;
  durationMinutes!: number;
  /** The unit of account the price below is in. */
  currency!: string;
  /** A decimal string, like every percentage here (§128.20). */
  depositPercentage!: string;
  priceMinor!: number;

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
