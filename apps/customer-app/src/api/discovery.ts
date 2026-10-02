import { api } from './client';

export interface Currency {
  code: string;
  exponent: number;
  minorUnitsPerMajor: number;
  note: string;
}

/** Unauthenticated: the exponent is a property of the currency, not the caller. */
export const getCurrency = () => api<Currency>('/payments/currency', { anonymous: true });

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  subcategories: Array<{ id: string; name: string }>;
}

export const listCategories = () => api<Category[]>('/categories', { anonymous: true });

export interface District {
  id: string;
  code: string;
  name: string;
}

export interface Province {
  id: string;
  code: string;
  name: string;
  districts: District[];
}

/** Reference data: five provinces, thirty districts, seeded (§104). */
export const listProvinces = () =>
  api<Province[]>('/places/provinces', { anonymous: true });

export interface DiscoveredLocation {
  id: string;
  name: string;
  address: string;
  /** Null when the branch has not said where it is; then it is unfilterable. */
  district: {
    id: string;
    name: string;
    provinceId: string;
    provinceName: string;
  } | null;
  latitude: number | null;
  longitude: number | null;
  business: {
    id: string;
    name: string | null;
    logoUrl: string | null;
    category: { id: string; name: string; icon: string | null } | null;
    subcategory: { id: string; name: string } | null;
  };
  ratingAvg: number | null;
  ratingCount: number;
  /** Cheapest service here, in minor units. Null when nothing is on sale. */
  fromPriceMinor: number | null;
  openNow: boolean;
  /** Only present on a distance search. */
  distanceKm?: number;
}

export interface DiscoveryPage {
  total: number;
  limit: number;
  offset: number;
  locations: DiscoveredLocation[];
}

export type DiscoverySort = 'rating' | 'price' | 'distance' | 'newest';

/**
 * Browse and search. Anonymous on purpose — someone should be able to look
 * before they have an account, which is also why the backend guards this with
 * OptionalJwtAuthGuard rather than requiring a token.
 */
export const discoverLocations = (params: {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  sort?: DiscoverySort;
  openNow?: boolean;
  minRating?: number;
  maxPriceMinor?: number;
  /** districtId is the narrower of the two and wins if both are sent. */
  provinceId?: string;
  districtId?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
  offset?: number;
}) => api<DiscoveryPage>('/discover/locations', { query: params, anonymous: true });

export interface ShopService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  /** A decimal string, e.g. "15.00" — the share taken as a deposit. */
  depositPercentage: string;
  currency: string;
  priceMinor: number;
}

export interface ShopHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface ShopDetail {
  id: string;
  name: string;
  address: string;
  district: {
    id: string;
    name: string;
    provinceId: string;
    provinceName: string;
  } | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  capacity: number;
  openNow: boolean;
  timeZone: string;
  rating: { average: number | null; count: number };
  gallery: Array<{ id: string; url: string }>;
  hours: ShopHours[];
  /** Days in the near future that differ from the usual week (§91). */
  upcomingExceptions: Array<{
    date: string;
    isClosed: boolean;
    customOpenTime: string | null;
    customCloseTime: string | null;
  }>;
  services: ShopService[];
  business: {
    id: string;
    name: string | null;
    description: string | null;
    phone: string | null;
    logoUrl: string | null;
    coverImageUrl: string | null;
    category: { id: string; name: string; icon: string | null } | null;
    subcategory: { id: string; name: string } | null;
  };
}

/** A closed branch 404s here, the same as it is absent from search (§89). */
export const getShop = (id: string) =>
  api<ShopDetail>(`/discover/locations/${id}`, { anonymous: true });

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  editedAt: string | null;
  responseText: string | null;
  responseAt: string | null;
  createdAt: string;
  displayName: string;
}

export interface PublicReviewPage {
  ratingAvg: number | null;
  ratingCount: number;
  total: number;
  reviews: PublicReview[];
}

/** Hidden reviews are excluded by the server, for everyone (§92). */
export const getShopReviews = (locationId: string, limit = 20) =>
  api<PublicReviewPage>(`/locations/${locationId}/reviews`, {
    query: { limit },
    anonymous: true,
  });

export interface Availability {
  locationId: string;
  date: string;
  dayOfWeek: number;
  timeZone: string;
  durationMinutes: number;
  capacity: number;
  /** Why there are no slots, in the server's own words. */
  source:
    | 'TEMPLATE'
    | 'EXCEPTION'
    | 'CLOSED_TEMPLATE'
    | 'CLOSED_EXCEPTION'
    | string;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
  /** Local "HH:mm" in the location's own time zone, not the phone's. */
  slots: string[];
}

/**
 * Free slots for one day.
 *
 * `durationMinutes` must be the service's, not the default grid: a 60-minute
 * service cannot start in the last 45 minutes before closing, and asking with
 * the default would offer starts that booking then refuses.
 */
export const getAvailability = (
  locationId: string,
  date: string,
  durationMinutes: number,
) =>
  api<Availability>(`/locations/${locationId}/availability`, {
    query: { date, durationMinutes },
    anonymous: true,
  });
