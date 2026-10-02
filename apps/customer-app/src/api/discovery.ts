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

export interface DiscoveredLocation {
  id: string;
  name: string;
  address: string;
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
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
  offset?: number;
}) => api<DiscoveryPage>('/discover/locations', { query: params, anonymous: true });
