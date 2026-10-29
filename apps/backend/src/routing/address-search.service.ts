import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressDto, AddressSearchDto } from './dto/address.dto';
import { packFor } from '../countries/packs';

/** The same letters are answered the same way tomorrow: kept a day. */
const CACHE_MS = 24 * 60 * 60 * 1000;
/** Suggestions are asked for at every pause in typing; this many are remembered. */
const CACHE_MAX = 5000;
/** The map search gets this long; after it, the app is told to try another way. */
const TIMEOUT_MS = 4000;
/** How many matches to offer. Enough to find the right one, few enough to read. */
const LIMIT = 6;
/** Map features nobody lives at or sends offers to: rivers, streams, hills. */
const NOT_ADDRESSES = new Set(['waterway', 'natural']);

/** What Photon's answer holds for one place, as far as this reads it. */
type PlaceProperties = {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  countrycode?: string;
  osm_key?: string;
};
type Feature = { geometry?: { coordinates?: [number, number] }; properties?: PlaceProperties };

/** Each value once, in order, empty ones dropped. */
const unique = (parts: Array<string | undefined>) =>
  parts.filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i);

/** "Northern Province, Rwanda" is in Rwanda; every result is in the country searched (§315). */
const local = (part: string | undefined, country: string) =>
  part?.replace(/,\s*([^,]+)$/, (all, last: string) => (last.trim() === country ? '' : all)).trim() || undefined;

/**
 * A place as a person would say it (§172): "Kimironko Market, KG 153 Street,
 * Kimironko", then "Kigali" underneath — and a town on its own as "Nyamirama",
 * then "Kayonza District, Eastern Province", so the four Remeras in Rwanda can
 * be told apart.
 */
export function describePlace(p: PlaceProperties, country: string): { label: string; detail: string } {
  const street = p.street ? (p.housenumber ? `${p.housenumber} ${p.street}` : p.street) : undefined;
  // "Gasabo District" is where something is, not what it is called.
  const area = [p.district, p.locality].find((part) => part && !/ District$/.test(part));

  let label = unique([local(p.name, country), street, area]).slice(0, 3);
  if (label.length === 0) label = unique([local(p.city, country), local(p.county, country)]).slice(0, 1);

  // Smallest first: "Ruheru, Nyaruguru District". Kigali is the exception —
  // the one city with districts INSIDE it (§106.1) — so "Gasabo District,
  // Kigali", the way it is said.
  const city = local(p.city, country);
  const inKigali = city === 'Kigali';
  const detail = unique([
    inKigali ? undefined : city,
    ...[p.district, p.locality].filter((part) => part && / District$/.test(part)),
    local(p.county, country),
    inKigali ? city : undefined,
    local(p.state, country),
  ])
    .filter((part) => !label.includes(part))
    .slice(0, 2);

  return { label: label.join(', ').slice(0, 120), detail: detail.join(', ') };
}

/**
 * Finding an address while it is typed (§172, §174), for the weekly offers
 * email: "kimir" already offers Kimironko, Kimironko Market and the taxi park.
 *
 * The service is Photon, a search over OpenStreetMap — the same open map as
 * the road distances (§157) — made for exactly this, suggesting as people
 * type. (§172 used Nominatim, whose public server forbids search-as-you-type.)
 * Its public server is free for fair use; `GEOCODING_BASE_URL` points at a
 * self-hosted one, which for Rwanda alone is small, or at nothing to turn
 * search off. Callers name themselves (`GEOCODING_USER_AGENT`), searches take
 * turns a little apart (`GEOCODING_SPACING_MS`), and the same letters are
 * answered from memory. Only the letters typed are sent — never who typed them.
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
        ? 'https://photon.komoot.io'
        : configured.trim().replace(/\/+$/, '') || null;
    this.userAgent =
      config.get<string>('GEOCODING_USER_AGENT')?.trim() ||
      'booking-platform/1.0 (service bookings in Rwanda)';
    this.spacingMs = Number(config.get<string>('GEOCODING_SPACING_MS') ?? 250);
  }

  /** Addresses in `country` (§315): the searcher's own — a shop's, or a customer's. */
  async search(query: string, country: { code: string; name: string }): Promise<AddressSearchDto> {
    const key = `${country.code}:${query.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { results: hit.value, available: true };
    if (!this.baseUrl) return { results: [], available: false };

    const found = await this.inTurn(() => this.ask(query, country));
    if (found === null) return { results: [], available: false };
    this.remember(key, found);
    return { results: found, available: true };
  }

  /** Oldest first out, so a busy day of typing cannot fill the memory. */
  private remember(key: string, value: AddressDto[]) {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
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

  private async ask(query: string, country: { code: string; name: string }): Promise<AddressDto[] | null> {
    // The country's box on the map, from its pack; results are filtered to it too.
    const box = packFor(country.code)?.mapBox;
    const params = new URLSearchParams({
      q: query,
      // More than are shown: some will be over a border or be a river.
      limit: String(LIMIT * 2),
      lang: 'en',
      ...(box ? { bbox: box } : {}),
    });
    try {
      const response = await fetch(`${this.baseUrl}/api/?${params}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Address search answered ${response.status}.`);
        return null;
      }
      const body = (await response.json()) as { features?: unknown };
      if (!Array.isArray(body?.features)) return null;

      const results: AddressDto[] = [];
      for (const feature of body.features as Feature[]) {
        const p = feature.properties ?? {};
        if (p.countrycode !== country.code || (p.osm_key && NOT_ADDRESSES.has(p.osm_key))) continue;
        const [longitude, latitude] = feature.geometry?.coordinates ?? [];
        if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        const { label, detail } = describePlace(p, country.name);
        // The same place found twice (a shop and its building) is one choice.
        if (!label || results.some((r) => r.label === label && r.detail === detail)) continue;
        results.push({ label, detail, latitude, longitude });
        if (results.length === LIMIT) break;
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
