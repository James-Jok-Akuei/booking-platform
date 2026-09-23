import { api } from './client';

/**
 * The admin endpoints this app uses.
 *
 * Hand-written signatures over the generated `schema.d.ts`, rather than a
 * generated client. The contract is the source of truth for the SHAPES; this
 * file is where the app says which of those ninety endpoints it actually
 * touches, so an endpoint disappearing from the backend shows up here as a
 * compile error in one file rather than in a dozen components.
 */

export type BusinessStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface AdminBusiness {
  id: string;
  name: string | null;
  description: string | null;
  phone: string | null;
  status: BusinessStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedById: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  category: { id: string; name: string } | null;
  subcategory: { id: string; name: string } | null;
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  businesses: T[];
}

export const listBusinesses = (params: {
  status?: BusinessStatus;
  limit?: number;
  offset?: number;
}) => api<Page<AdminBusiness>>('/admin/businesses', { query: params });

export const getBusiness = (id: string) => api<AdminBusiness>(`/admin/businesses/${id}`);

export const approveBusiness = (id: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/approve`, { method: 'PATCH' });

export const reinstateBusiness = (id: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/reinstate`, { method: 'PATCH' });

/** Rejection and suspension both REQUIRE a reason — the business is told it. */
export const rejectBusiness = (id: string, reason: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/reject`, {
    method: 'PATCH',
    body: { reason },
  });

export const suspendBusiness = (id: string, reason: string) =>
  api<AdminBusiness>(`/admin/businesses/${id}/suspend`, {
    method: 'PATCH',
    body: { reason },
  });
