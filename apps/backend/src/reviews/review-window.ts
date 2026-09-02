/** How long a customer may edit their review, and a business its response. */
export const REVIEW_EDIT_WINDOW_DAYS = 7;
export const REVIEW_EDIT_WINDOW_MS = REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** True once the edit window has closed on something created at `createdAt`. */
export function isPastEditWindow(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > REVIEW_EDIT_WINDOW_MS;
}
