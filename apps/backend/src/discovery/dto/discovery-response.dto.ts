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
