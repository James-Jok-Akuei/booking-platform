import { BusinessStatus, Prisma } from '@prisma/client';

/** One legal move in the approval lifecycle. */
export interface BusinessTransitionRule {
  from: BusinessStatus;
  to: BusinessStatus;
  /** Whether an admin must say why. */
  requiresReason: boolean;
}

/**
 * The complete set of legal status transitions. Anything not listed throws.
 *
 * Data rather than a chain of guard clauses, deliberately: the appointment
 * lifecycle (§16.1) scattered its rules across five methods and there is now no
 * one place to read it. The ticket table (`ticket-status.ts`) is the pattern
 * being followed instead — the whole lifecycle is legible at once, and a test
 * can assert that every unlisted pair is rejected without restating the rules.
 *
 * A reason is required exactly where the business is being told something bad:
 * a rejection and a suspension. Approval and reinstatement are good news and
 * need no justification — and demanding one would produce boilerplate that
 * makes the required reasons look equally unimportant.
 */
export const BUSINESS_STATUS_TRANSITIONS: BusinessTransitionRule[] = [
  { from: BusinessStatus.PENDING, to: BusinessStatus.APPROVED, requiresReason: false },
  { from: BusinessStatus.PENDING, to: BusinessStatus.REJECTED, requiresReason: true },
  // An appeal. There is no resubmission flow, so a rejected applicant's only
  // route back is an admin changing their mind.
  { from: BusinessStatus.REJECTED, to: BusinessStatus.APPROVED, requiresReason: false },
  { from: BusinessStatus.APPROVED, to: BusinessStatus.SUSPENDED, requiresReason: true },
  { from: BusinessStatus.SUSPENDED, to: BusinessStatus.APPROVED, requiresReason: false },
];

export function findBusinessTransition(
  from: BusinessStatus,
  to: BusinessStatus,
): BusinessTransitionRule | undefined {
  return BUSINESS_STATUS_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * Whether a business is visible to the public and may take new bookings.
 *
 * One predicate, used by availability, reviews, chat and booking, so the four
 * cannot drift into disagreeing about what "open for business" means.
 *
 * Takes the ROW rather than the status since §119: a business that paused itself
 * is just as unbookable as one that was never approved, and the two reasons are
 * deliberately separate fields — `status` is what an admin decided, `pausedAt`
 * is what the business decided. Passing the row means a surface cannot check one
 * and forget the other, which is the §42.1 failure in a new costume.
 */
export const isPubliclyBookable = (business: {
  status: BusinessStatus;
  /**
   * REQUIRED, not optional. Optional would let a `select` that forgot to ask
   * for it compile cleanly and silently skip half the check — the exact failure
   * this predicate exists to make impossible.
   */
  pausedAt: Date | null;
  /** When the shop posted itself (§268). Required for the same reason. */
  publishedAt: Date | null;
}) => business.status === BusinessStatus.APPROVED && !!business.publishedAt && !business.pausedAt;

/**
 * The same rule as a `where` on the business, for lists and counts (§268):
 * approved by an administrator, posted by the shop, and not paused by it.
 */
export const PUBLIC_BUSINESS = {
  status: BusinessStatus.APPROVED,
  publishedAt: { not: null },
  pausedAt: null,
} satisfies Prisma.BusinessProfileWhereInput;
