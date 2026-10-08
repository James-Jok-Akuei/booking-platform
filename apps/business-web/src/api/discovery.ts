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
