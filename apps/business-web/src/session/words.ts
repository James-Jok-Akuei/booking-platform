import { plural } from '@lingui/core/macro';

/** "30 minutes", "12 hours", "30 days" — how long a sign-in lasts, as a person says it (§279). */
export function lengthWords(minutes: number): string {
  const days = minutes / (24 * 60);
  const hours = minutes / 60;
  if (minutes >= 24 * 60 && Number.isInteger(days)) return plural(days, { one: '# day', other: '# days' });
  if (minutes >= 60 && Number.isInteger(hours)) return plural(hours, { one: '# hour', other: '# hours' });
  return plural(minutes, { one: '# minute', other: '# minutes' });
}

/** A countdown, "1:42". */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
