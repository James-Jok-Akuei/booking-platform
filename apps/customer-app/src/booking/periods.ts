import type { IconName } from '../ui/Icon';
import { t } from '@lingui/core/macro';

export type Period<T = string> = {
  key: 'morning' | 'afternoon' | 'evening';
  label: string;
  icon: IconName;
  slots: T[];
};

// Labels are read when used, so they are in the language of the moment (§308).
const PERIODS: Array<Omit<Period, 'slots'> & { from: number; to: number }> = [
  { key: 'morning', get label() { return t`Morning`; }, icon: 'sunny-outline', from: 0, to: 12 },
  { key: 'afternoon', get label() { return t`Afternoon`; }, icon: 'partly-sunny-outline', from: 12, to: 17 },
  { key: 'evening', get label() { return t`Evening`; }, icon: 'moon-outline', from: 17, to: 24 },
];

/**
 * Times in the three parts of a day a person thinks in (§179).
 *
 * Thirty-five identical buttons in a grid are a wall; "the one after lunch"
 * is found by looking under Afternoon. Only the parts with something in them
 * are returned, in the day's order. A time that cannot be read is left out
 * rather than guessed at. Takes plain "HH:mm" strings, or anything else with
 * a way to read its time — a time with its places left (§189).
 */
export function groupByPeriod(slots: string[]): Period[];
export function groupByPeriod<T>(slots: T[], timeOf: (slot: T) => string): Period<T>[];
export function groupByPeriod<T>(
  slots: T[],
  timeOf: (slot: T) => string = (slot) => String(slot),
): Period<T>[] {
  const hourOf = (time: string) => {
    const hour = Number(time.split(':')[0]);
    return Number.isFinite(hour) ? hour : null;
  };
  return PERIODS.map((period) => ({
    key: period.key,
    label: period.label,
    icon: period.icon,
    slots: slots.filter((slot) => {
      const hour = hourOf(timeOf(slot));
      return hour !== null && hour >= period.from && hour < period.to;
    }),
  })).filter((period) => period.slots.length > 0);
}

/** "10:00" plus ninety minutes is "11:30"; past midnight wraps, as a clock does. */
export function endOf(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
