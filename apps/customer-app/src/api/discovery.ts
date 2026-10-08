import { api } from './client';
import type { components, paths } from './schema';

export type Currency = components['schemas']['CurrencyDto'];

/** Unauthenticated: the exponent is a property of the currency, not the caller. */
export const getCurrency = () => api<Currency>('/payments/currency', { anonymous: true });

export type Category = components['schemas']['CategoryDto'];

export const listCategories = () => api<Category[]>('/categories', { anonymous: true });

export type District = components['schemas']['DistrictDto'];

export type Province = components['schemas']['ProvinceDto'];

/** Reference data: five provinces, thirty districts, seeded (§104). */
export const listProvinces = () =>
  api<Province[]>('/places/provinces', { anonymous: true });

/** From the contract (§128). */
export type SavedPlace = components['schemas']['SavedPlaceDto'];


export const listFavourites = () =>
  api<{ total: number; favourites: SavedPlace[] }>('/favourites');

export const saveFavourite = (locationId: string) =>
  api<{ locationId: string; saved: boolean }>('/favourites', {
    method: 'POST',
    body: { locationId },
  });

export const unsaveFavourite = (locationId: string) =>
  api<{ locationId: string; saved: boolean }>(`/favourites/${locationId}`, {
    method: 'DELETE',
  });

/**
 * From the contract (§128.4). Discovery's response is assembled rather than
 * selected, so the SERVICE declares this shape as its return type and the class
 * is checked against the implementation — the opposite direction to
 * `AppointmentDto`, and the only one available when a response is built.
 */
export type DiscoveredLocation = components['schemas']['DiscoveredLocationDto'];


export type DiscoveryPage = components['schemas']['DiscoveryPageDto'];

/**
 * From the contract, not from here. Hand-written, this listed a fourth value —
 * `newest` — that the backend has never accepted, so the sort chip offering it
 * returned a 400 on every tap (§110).
 */
export type DiscoverySort = NonNullable<
  NonNullable<
    paths['/discover/locations']['get']['parameters']['query']
  >['sort']
>;

/**
 * Browse and search. Open to anyone on purpose — someone should be able to look
 * before they have an account, which is also why the backend guards this with
 * OptionalJwtAuthGuard rather than requiring a token. The token still GOES when
 * there is one (§133.7), because that is how the server knows which hearts to
 * fill.
 */
export const discoverLocations = (params: {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  sort?: DiscoverySort;
  openNow?: boolean;
  /** Services only: just what is on sale today, biggest sale first (§186). */
  onSale?: boolean;
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
}) => api<DiscoveryPage>('/discover/locations', { query: params, optionalAuth: true });

/** Saved services (§158): the service AT a branch, since prices differ per branch. */
export type SavedService = components['schemas']['SavedServiceDto'];
export type SavedServicePage = components['schemas']['SavedServicePageDto'];

export const listSavedServices = () => api<SavedServicePage>('/favourites/services');

export const saveService = (serviceId: string, locationId: string) =>
  api<components['schemas']['ServiceFavouriteStateDto']>('/favourites/services', {
    method: 'POST',
    body: { serviceId, locationId },
  });

export const unsaveService = (serviceId: string, locationId: string) =>
  api<components['schemas']['ServiceFavouriteStateDto']>(
    `/favourites/services/${serviceId}/${locationId}`,
    { method: 'DELETE' },
  );

/** A service at a branch, as the home screen's shelves show it (§135.2). */
export type DiscoveredService = components['schemas']['DiscoveredServiceDto'];

export type DiscoveredServicePage = components['schemas']['DiscoveredServicePageDto'];

/**
 * Services across every shop. Takes the same filters as the place search, on
 * purpose: one set of chips drives both, and the server narrows both by the
 * same rules, so the circles and the shelves can never disagree about which
 * shops are open for business.
 */
export const discoverServices = (params: Parameters<typeof discoverLocations>[0]) =>
  // The token goes when there is one (§133.7): it is how the server knows
  // which hearts to fill.
  api<DiscoveredServicePage>('/discover/services', { query: params, optionalAuth: true });

/**
 * The real road to a branch, and how long it takes by car (§157). One branch
 * at a time — the list measures as the crow flies (§107). `by: 'line'` means
 * the routing service did not answer and this is the straight line.
 */
export type Route = components['schemas']['RouteDto'];

export const getRoute = (locationId: string, position: { lat: number; lng: number }) =>
  api<Route>(`/locations/${locationId}/route`, { query: position, anonymous: true });

export type ShopService = components['schemas']['ShopfrontServiceDto'];

export type ShopHours = components['schemas']['ShopfrontHoursDto'];

export type ShopDetail = components['schemas']['ShopfrontDto'];

/** A closed branch 404s here, the same as it is absent from search (§89). */
export const getShop = (id: string) =>
  api<ShopDetail>(`/discover/locations/${id}`, { optionalAuth: true });

export type PublicReview = components['schemas']['ReviewDto'];

export type PublicReviewPage = components['schemas']['LocationReviewsDto'];

/** Hidden reviews are excluded by the server, for everyone (§92). */
export const getShopReviews = (locationId: string, limit = 20) =>
  api<PublicReviewPage>(`/locations/${locationId}/reviews`, {
    query: { limit },
    anonymous: true,
  });

export type Availability = components['schemas']['AvailabilityDto'];

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
  /**
   * WHAT is being booked and how many (§136). The server works out how long
   * that takes and how many places it needs; this screen never does.
   */
  what: { serviceId: string; quantity: number },
) =>
  api<Availability>(`/locations/${locationId}/availability`, {
    query: { date, ...what },
    anonymous: true,
  });
