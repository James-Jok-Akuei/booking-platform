/** "30 minutes", "12 hours", "30 days" — how long a sign-in lasts, as a person says it (§279). */
export function lengthWords(minutes: number): string {
  const say = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) return say(minutes / (24 * 60), 'day');
  if (minutes >= 60 && minutes % 60 === 0) return say(minutes / 60, 'hour');
  return say(minutes, 'minute');
}

/** A countdown, "1:42". */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
