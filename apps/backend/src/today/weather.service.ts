import { Injectable, Logger } from '@nestjs/common';

/**
 * Heavy rain coming (§310), for the shops it changes the day of — a car wash,
 * a tour, an event under the sky. From Open-Meteo's free forecast: the only
 * thing sent is a point on the map, rounded to about a kilometre, never a
 * shop's name or anyone's. Kept an hour per point; any failure is simply no
 * card, never an error for the shop.
 */
export type RainAhead = { from: string; mm: number; chance: number };

const HEAVY_MM = 2.5;
const LIKELY = 60;
/** After this hour a forecast says nothing about today's customers. */
const DAY_ENDS = 21;

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<string, { at: number; hours: Array<{ time: string; mm: number; chance: number }> }>();

  /** The first hour of heavy rain still to come today near (lat, lng), or null. */
  async rainAhead(lat: number, lng: number, now = new Date()): Promise<RainAhead | null> {
    // Not from tests or a machine told to keep to itself.
    if (process.env.NODE_ENV === 'test' || process.env.TODAY_FEEDS === 'off') return null;
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    let hours = this.cache.get(key);
    if (!hours || now.getTime() - hours.at > 3_600_000) {
      const fetched = await this.fetch(lat, lng);
      if (!fetched) return null;
      hours = { at: now.getTime(), hours: fetched };
      this.cache.set(key, hours);
    }
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const part = (type: string) => local.find((p) => p.type === type)?.value ?? '';
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const hour = Number(part('hour'));
    const ahead = hours.hours.find((h) => {
      const [day, time] = h.time.split('T');
      const at = Number(time.slice(0, 2));
      return day === today && at >= hour && at < DAY_ENDS && h.mm >= HEAVY_MM && h.chance >= LIKELY;
    });
    return ahead ? { from: ahead.time.slice(11, 16), mm: ahead.mm, chance: ahead.chance } : null;
  }

  private async fetch(lat: number, lng: number) {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}` +
      '&hourly=precipitation,precipitation_probability&forecast_days=1&timezone=Africa%2FKigali';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { hourly?: { time: string[]; precipitation: number[]; precipitation_probability: number[] } };
      const h = body.hourly;
      if (!h) return null;
      return h.time.map((time, i) => ({ time, mm: h.precipitation[i] ?? 0, chance: h.precipitation_probability[i] ?? 0 }));
    } catch (error) {
      this.logger.warn(`Weather could not be read: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
