import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RouteDto } from './dto/route.dto';

const EARTH_RADIUS_KM = 6371;
/** How long an answer is kept, per start-and-end pair. Roads do not move. */
const CACHE_MS = 10 * 60 * 1000;
/** The routing service gets this long; after it, the straight line answers. */
const TIMEOUT_MS = 4000;

/** Straight-line distance, the same haversine the search uses (§107). */
export function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Road distance and driving time to a branch (§157).
 *
 * The search measures every branch as the crow flies (§107), which is right
 * for sorting a list and wrong for "how long will it take me". This asks a
 * routing service for the real road, ONE branch at a time — the reservation
 * page, the shop page — where one answer is worth a request.
 *
 * The service is OSRM, spoken over HTTP, chosen because the public instance
 * costs nothing and the interface is one URL; `ROUTING_BASE_URL` points at a
 * self-hosted one, or at nothing to turn this off. Google's Routes API would
 * be a different URL and a different parser, not a different shape.
 *
 * Never fails the caller: a slow or absent service answers with the straight
 * line and `by: 'line'`, and the screen says "about" less.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly baseUrl: string | null;
  private readonly cache = new Map<string, { at: number; value: RouteDto }>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = config.get<string>('ROUTING_BASE_URL');
    this.baseUrl =
      configured === undefined ? 'https://router.project-osrm.org' : configured.trim() || null;
  }

  async toLocation(locationId: string, from: { lat: number; lng: number }): Promise<RouteDto> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, isActive: true },
      select: { latitude: true, longitude: true },
    });
    if (!location || location.latitude === null || location.longitude === null) {
      throw new NotFoundException('Location not found.');
    }
    const to = { lat: location.latitude, lng: location.longitude };

    // Three decimals is about a hundred metres: close enough for the same
    // answer, loose enough that a customer standing still is one cache entry.
    const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)}>${locationId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    const value = (await this.road(from, to)) ?? {
      distanceKm: Math.round(straightLineKm(from, to) * 100) / 100,
      minutes: null,
      by: 'line' as const,
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async road(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteDto | null> {
    if (!this.baseUrl) return null;
    // OSRM takes longitude first.
    const url =
      `${this.baseUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=false&alternatives=false&steps=false';
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        code?: string;
        routes?: Array<{ distance: number; duration: number }>;
      };
      const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
      if (!route) return null;
      return {
        distanceKm: Math.round((route.distance / 1000) * 100) / 100,
        minutes: Math.max(1, Math.round(route.duration / 60)),
        by: 'road',
      };
    } catch (error) {
      this.logger.warn(`Routing service did not answer: ${(error as Error).message}`);
      return null;
    }
  }
}
