import { UserRole } from '@prisma/client';

/**
 * How long a sign-in lasts, per app (§279).
 *
 * Two clocks, not one:
 *
 * - **Idle**: unused for this long, the sign-in ends. Each use renews it — the
 *   refresh token is rotated with this as its life — and the admin console and
 *   the seller app also count it on the screen, from real clicks and typing,
 *   because their background checks for new bookings would otherwise keep a
 *   forgotten tab signed in for ever.
 * - **Most**: however busy, the sign-in ends this long after its code was
 *   typed. Use cannot push it back.
 *
 * The admin console can approve shops and mark payouts paid, so it is the
 * shortest. The seller app sits on a shop's shared front-desk computer: a
 * working day without interruptions, and signed out by the next morning. The
 * customer app is on a person's own locked phone, and nothing can be paid
 * without their MoMo PIN; asking them to sign in again would mostly lose
 * bookings.
 */
export const SESSION_POLICY: Record<UserRole, { idleMinutes: number; maxMinutes: number | null }> = {
  ADMIN: { idleMinutes: 30, maxMinutes: 12 * 60 },
  BUSINESS: { idleMinutes: 12 * 60, maxMinutes: 30 * 24 * 60 },
  CUSTOMER: { idleMinutes: 30 * 24 * 60, maxMinutes: null },
};

/** When a sign-in started at `startedAt` must end, or null when only idleness ends it. */
export const sessionEndsAt = (role: UserRole, startedAt: Date): Date | null => {
  const { maxMinutes } = SESSION_POLICY[role];
  return maxMinutes === null ? null : new Date(startedAt.getTime() + maxMinutes * 60_000);
};

/**
 * How long after typing a code a risky change goes through without asking for
 * another (§279): a sign-in this recent, or a "confirm it is you" this recent.
 * Long enough to invite three people in a row; short enough that a screen left
 * open is not enough.
 */
export const RECENT_AUTH_MINUTES = 10;
