/**
 * A length of time, as a person says it (§163).
 *
 * Under an hour it is minutes: "45 min". From an hour it is hours and minutes:
 * "1 h 30 min", "2 h" — nobody says "90 minutes" about a braiding session.
 * `long` spells the words out for a sentence: "1 hour 30 minutes".
 */
export const duration = (minutes: number, long = false): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = long ? (h === 1 ? '1 hour' : `${h} hours`) : `${h} h`;
  const mins = long ? (m === 1 ? '1 minute' : `${m} minutes`) : `${m} min`;
  if (h === 0) return mins;
  if (m === 0) return hours;
  return `${hours} ${mins}`;
};
