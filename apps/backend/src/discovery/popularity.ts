import { AppointmentStatus } from '@prisma/client';

/**
 * The bookings that count towards popularity (§135.1).
 *
 * Paid for and not called off. A slot that was only HELD says somebody was
 * curious, not that they came — and counting holds would let a shop climb the
 * list by booking itself and never paying. Cancellations and no-shows are
 * bookings that did not happen.
 */
export const COUNTED_BOOKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

/** What an unrated place is treated as, out of five. Neither punished nor praised. */
const NEUTRAL_RATING = 3.5;

/**
 * One number for "how popular", from bookings AND ratings (§135.1).
 *
 * Bookings, weighted by how well they went: `bookings × rating/5`. So a place
 * with ten bookings at 4.8 stars (9.6) sits above one with eleven at 2.5 (5.5) —
 * being busy is not the same as being good, and the top of the list is a
 * recommendation.
 *
 * Deliberately simple enough to explain to a shop owner in one sentence. They
 * will ask why they are third.
 */
export function popularityScore(bookings: number, ratingAvg: number | null): number {
  return bookings * ((ratingAvg ?? NEUTRAL_RATING) / 5);
}

export interface Rankable {
  bookings: number;
  ratingAvg: number | null;
  ratingCount: number;
  name: string;
}

/**
 * Most popular first.
 *
 * Ties are common — every new shop has a score of zero — so they are broken by
 * rating, then by how many people that rating comes from, then by name. The
 * name is what makes the order STABLE: without it two zero-score shops could
 * swap places between page one and page two.
 */
export function byPopularity(a: Rankable, b: Rankable): number {
  return (
    popularityScore(b.bookings, b.ratingAvg) - popularityScore(a.bookings, a.ratingAvg) ||
    (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) ||
    b.ratingCount - a.ratingCount ||
    a.name.localeCompare(b.name)
  );
}
