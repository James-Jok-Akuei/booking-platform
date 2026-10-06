import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressDto, AddressSearchDto } from './dto/address.dto';

/** A typed address is found the same way tomorrow: kept a day. */
const CACHE_MS = 24 * 60 * 60 * 1000;
/** The map search gets this long; after it, the app is told to try another way. */
const TIMEOUT_MS = 5000;
/** How many matches to offer. Enough to find the right one, few enough to read. */
const LIMIT = 6;

/** What Nominatim's `jsonv2` answer holds, as far as this reads it. */
type Place = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
};

/** Each value once, in order, empty ones dropped. */
const unique = (parts: Array<string | undefined>) =>
  parts.filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i);

/**
 * A place as a person would say it (§172): "Kimironko Market, KG 11 Ave,
 * Kimironko", then "Gasabo, Kigali" underneath — not OpenStreetMap's full
 * "Kimironko Market, KG 11 Ave, Kimironko, Gasabo, Kigali City, Rwanda".
 */
export function describePlace(place: Place): { label: string; detail: string } {
  const a = place.address ?? {};
  const street = a.road ? (a.house_number ? `${a.house_number} ${a.road}` : a.road) : undefined;
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.village ?? a.city_district;
  const town = a.city ?? a.town ?? a.state;

  let label = unique([place.name, street, area]).slice(0, 3);
  if (label.length === 0) {
    label = (place.display_name ?? '').split(', ').slice(0, 2);
  }
  const detail = unique([a.county, town]).filter((part) => !label.includes(part));

  return { label: label.join(', ').slice(0, 120), detail: detail.join(', ') };
}

/**
 * Finding a typed address on the map (§172), for the weekly offers email.
 *
 * Until now the only way to save a spot was to stand on it and press "Use
 * where I am now" (§169) — no use to someone at work who wants offers near
 * home. This turns what they type into places to pick from.
 *
 * The service is Nominatim, OpenStreetMap's search, the same open map the
 * road distances come from (§157). Its public server is free on three
 * conditions, all kept here: callers name themselves (`GEOCODING_USER_AGENT`),
 * ask at most once a second (searches wait their turn), and do not search as
 * people type (the app searches when "Find" is pressed). Only the typed words
 * are sent — never who typed them.
 *
 * Never fails the caller: a slow or absent service answers `available: false`
 * and the app offers the other two ways.
 */
@Injectable()
export class AddressSearchService {
  private readonly logger = new Logger(AddressSearchService.name);
  private readonly baseUrl: string | null;
  private readonly userAgent: string;
  private readonly spacingMs: number;
  private readonly cache = new Map<string, { at: number; value: AddressDto[] }>();
  private turn: Promise<unknown> = Promise.resolve();
  private lastAskedAt = 0;

  constructor(config: ConfigService) {
    const configured = config.get<string>('GEOCODING_BASE_URL');
    this.baseUrl =
      configured === undefined
        ? 'https://nominatim.openstreetmap.org'
        : configured.trim().replace(/\/+$/, '') || null;
    this.userAgent =
      config.get<string>('GEOCODING_USER_AGENT')?.trim() ||
      'booking-platform/1.0 (service bookings in Rwanda)';
    // One a second is the public server's rule; a self-hosted one can say less.
    this.spacingMs = Number(config.get<string>('GEOCODING_SPACING_MS') ?? 1100);
  }

  async search(query: string): Promise<AddressSearchDto> {
    const key = query.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { results: hit.value, available: true };
    if (!this.baseUrl) return { results: [], available: false };

    const found = await this.inTurn(() => this.ask(query));
    if (found === null) return { results: [], available: false };
    this.cache.set(key, { at: Date.now(), value: found });
    return { results: found, available: true };
  }

  /** One search at a time, each at least `spacingMs` after the last. */
  private inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = this.turn.then(async () => {
      const wait = this.lastAskedAt + this.spacingMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastAskedAt = Date.now();
      return task();
    });
    this.turn = run.catch(() => undefined);
    return run;
  }

  private async ask(query: string): Promise<AddressDto[] | null> {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      // Rwanda only: "Kimironko" should not find a street in another country.
      countrycodes: 'rw',
      limit: String(LIMIT),
      'accept-language': 'en',
    });
    try {
      const response = await fetch(`${this.baseUrl}/search?${params}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Address search answered ${response.status}.`);
        return null;
      }
      const places = (await response.json()) as unknown;
      if (!Array.isArray(places)) return null;

      const results: AddressDto[] = [];
      for (const place of places as Place[]) {
        const latitude = Number(place.lat);
        const longitude = Number(place.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        const { label, detail } = describePlace(place);
        // The same street found twice is one choice, not two.
        if (!label || results.some((r) => r.label === label && r.detail === detail)) continue;
        results.push({ label, detail, latitude, longitude });
      }
      return results;
    } catch (error) {
      this.logger.warn(
        `Address search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
