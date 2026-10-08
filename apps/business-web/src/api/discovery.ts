import { api } from './client';
import type { components } from './schema';

/** A service at a branch, as the customer app's shelves show it (§135.2). */
export type DiscoveredService = components['schemas']['DiscoveredServiceDto'];
export type DiscoveredServicePage = components['schemas']['DiscoveredServicePageDto'];

/**
 * What customers are booking across the platform (§204) — the same public list
 * the customer app's home reads. Asked anonymously: the seller's own token
 * would only make the server work out which hearts to fill.
 */
export const discoverServices = (params: {
  sort?: 'popular' | 'rating' | 'price' | 'newest';
  categoryId?: string;
  subcategoryId?: string;
  onSale?: boolean;
  limit?: number;
}) => api<DiscoveredServicePage>('/discover/services', { query: params, anonymous: true });

/** One branch exactly as the customer app's shop page reads it (§208). */
export type Shopfront = components['schemas']['ShopfrontDto'];
export type ShopfrontService = components['schemas']['ShopfrontServiceDto'];

/**
 * Asked anonymously, as a signed-out customer would: no hearts filled in. A
 * paused shop or a closed branch 404s here, as it is absent from search (§89).
 */
export const getShopfront = (locationId: string) =>
  api<Shopfront>(`/discover/locations/${locationId}`, { anonymous: true });

export type PublicReviewPage = components['schemas']['LocationReviewsDto'];

/** The branch's reviews as customers read them — hidden ones left out (§92). */
export const getShopReviews = (locationId: string, limit = 20) =>
  api<PublicReviewPage>(`/locations/${locationId}/reviews`, { query: { limit }, anonymous: true });
