import { api } from './client';
import type { components } from './schema';

/** What the customer may send. Straight from the contract, including the limits. */
export type NewReview = components['schemas']['CreateReviewDto'];
export type ReviewEdit = components['schemas']['UpdateReviewDto'];

export type Review = components['schemas']['ReviewDto'];

/**
 * How long a review stays editable, and the server is the one that enforces it.
 *
 * Mirrored here only so the screen can stop OFFERING an edit it knows will be
 * refused — the same reason the business app mirrors it (§92.3). A screen that
 * offers a control and then shows a 400 has told the customer nothing.
 */
export const REVIEW_EDIT_WINDOW_DAYS = 7;

export const canStillEdit = (createdAt: string) =>
  Date.now() - new Date(createdAt).getTime() <
  REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Leaves a review. Only a COMPLETED appointment may be reviewed, and only once —
 * a second attempt is a 409, which is why the screen asks the appointment
 * whether a review already exists rather than finding out by posting.
 */
export const createReview = (appointmentId: string, body: NewReview) =>
  api<Review>(`/appointments/${appointmentId}/reviews`, { method: 'POST', body });

/** Rating, comment or byline, within the window. There is deliberately no delete. */
export const updateReview = (reviewId: string, body: ReviewEdit) =>
  api<Review>(`/reviews/${reviewId}`, { method: 'PATCH', body });
