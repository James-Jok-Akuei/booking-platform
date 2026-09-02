import { parseHhMm } from '../availability/time.util';

/** The shape "is it open?" needs, whether it came from a template or an exception. */
export interface OpenWindow {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

/**
 * Whether a location is open at a given local minute.
 *
 * **Boundary convention: half-open, `[open, close)`.** A location whose hours
 * are 09:00–17:00 is open at exactly 09:00 and CLOSED at exactly 17:00. That
 * matches the half-open interval convention used for slots and date ranges
 * everywhere else in this codebase (`overlaps`, `[from, to)`), and it is the
 * honest answer: at 17:00 the shop is shutting, and telling a customer it is
 * open is how they arrive to a locked door.
 *
 * Malformed stored times return false rather than throwing. A search that 500s
 * because one location has a corrupt hours row is worse than one that quietly
 * treats it as closed — and the write side validates the format anyway.
 */
export function isOpenAt(window: OpenWindow | null, minutesSinceMidnight: number): boolean {
  if (!window || window.isClosed) return false;
  if (!window.openTime || !window.closeTime) return false;

  const open = parseHhMm(window.openTime);
  const close = parseHhMm(window.closeTime);
  if (open === null || close === null) return false;

  // Overnight hours (close <= open, e.g. 20:00–02:00) are not modelled anywhere
  // in this platform — availability does not generate slots across midnight
  // either — so such a row is treated as closed rather than silently guessed at.
  if (close <= open) return false;

  return minutesSinceMidnight >= open && minutesSinceMidnight < close;
}
