/**
 * The day and hour it is on a country's clock (§315), for jobs that speak
 * to people at a local hour — "nine on a Friday" is a different moment in
 * Kigali and in Nairobi. A job that wakes every hour asks this for each
 * country rather than naming one zone in its schedule.
 */
export function localTime(now: Date, timeZone: string): { date: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  return { date: `${part('year')}-${part('month')}-${part('day')}`, weekday, hour: Number(part('hour')) };
}

/** Whether it is `hour` o'clock (and, if given, `weekday`, 0 = Sunday) on that clock now. */
export function isLocalTime(now: Date, timeZone: string, at: { hour: number; weekday?: number }): boolean {
  const local = localTime(now, timeZone);
  return local.hour === at.hour && (at.weekday === undefined || local.weekday === at.weekday);
}
