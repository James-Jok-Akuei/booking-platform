import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import {
  ApproxSettlement,
  RateContext,
  approxSettlementFor,
} from '../payments/approx-settlement';
import { isPubliclyBookable } from '../business/business-status';
import { dayOfWeekUtc, instantToZonedParts } from '../availability/time.util';
import { isOpenAt } from './open-now';
import { DiscoverLocationsDto, DiscoverySort } from './dto/discover-locations.dto';

/** Rows the bounding-box + haversine query returns. */
interface DistanceRow {
  id: string;
  distance_km: number;
}

const DEFAULT_LIMIT = 20;

/** Mean Earth radius, the standard haversine constant. */
const EARTH_RADIUS_KM = 6371;

@Injectable()
export class DiscoveryService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    config: ConfigService,
  ) {
    // The same single platform timezone AvailabilityService uses (§12). No
    // per-location timezone is stored anywhere, and inventing one here would
    // make "open now" and the availability calendar disagree about what day it
    // is for the same location.
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
  }

  // ---------- Search ----------

  /**
   * Public location search.
   *
   * A result is a LOCATION, not a business: everything customer-facing here is
   * already location-scoped — availability, reviews, ratingAvg, hours, gallery —
   * so a branch is the unit a customer actually chooses between.
   *
   * Query budget for a page of any size, stated because it is easy to regress:
   * **four queries, plus one when distance is used**, and none of them per-row.
   * Down from five since §44 made the cheapest price a column.
   */
  async search(query: DiscoverLocationsDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const distance = this.resolveDistance(query);

    if (query.sort === DiscoverySort.DISTANCE && !distance) {
      throw new BadRequestException(
        'sort=distance requires lat, lng and radiusKm.',
      );
    }

    // (1) The bounding-box + haversine prefilter, when searching by distance.
    // Returns ids and distances only; the rest is loaded by the shared path
    // below so a distance search and an ordinary browse cannot drift apart.
    const nearby = distance ? await this.locationIdsWithin(distance) : null;
    if (nearby && nearby.length === 0) {
      return this.emptyPage(limit, offset, distance);
    }

    const where = this.buildWhere(query, nearby?.map((r) => r.id) ?? null);

    // (2) and (3): the count and the page.
    const [total, locations] = await Promise.all([
      this.prisma.location.count({ where }),
      this.prisma.location.findMany({
        where,
        // Distance ordering is applied after the fact from the prefilter's
        // result, because the distance lives in raw SQL rather than in a column
        // Prisma can order by.
        orderBy: this.orderBy(query),
        // A distance sort needs every candidate before it can order them; the
        // radius and MAX_RADIUS_KM are what bound that set.
        ...(query.sort === DiscoverySort.DISTANCE
          ? {}
          : { take: limit, skip: offset }),
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          ratingAvg: true,
          ratingCount: true,
          fromPriceMinor: true,
          businessId: true,
          business: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              category: { select: { id: true, name: true, icon: true } },
              subcategory: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const distanceById = new Map(nearby?.map((r) => [r.id, r.distance_km]) ?? []);
    let rows = locations;

    if (query.sort === DiscoverySort.DISTANCE) {
      rows = [...locations]
        .sort(
          (a, b) => (distanceById.get(a.id) ?? Infinity) - (distanceById.get(b.id) ?? Infinity),
        )
        .slice(offset, offset + limit);
    }

    // (4) and (5): the open-now inputs for the whole page. Never per row.
    //
    // The cheapest price no longer needs a query at all — it is a column on the
    // location now (§44), maintained on write. That is one fewer query per page
    // AND the reason `sort=price` can order rows this page never fetched.
    const [openNow, rate] = await Promise.all([
      this.openNowByLocation(rows.map((l) => l.id)),
      // One rate read per response, reused for every amount in it (§39).
      this.settings.getExchangeRateForDisplay(),
    ]);

    return {
      total: query.sort === DiscoverySort.DISTANCE ? locations.length : total,
      limit,
      offset,
      ...(distance
        ? { center: { lat: distance.lat, lng: distance.lng }, radiusKm: distance.radiusKm }
        : {}),
      locations: rows
        .map((location) => {
          const fromPriceMinor = location.fromPriceMinor;
          return {
            id: location.id,
            name: location.name,
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            business: location.business,
            ratingAvg: location.ratingAvg ? Number(location.ratingAvg) : null,
            ratingCount: location.ratingCount,
            fromPriceMinor,
            ...this.priceSettlement(fromPriceMinor, rate),
            openNow: openNow.get(location.id) ?? false,
            ...(distanceById.has(location.id)
              ? { distanceKm: round2(distanceById.get(location.id)!) }
              : {}),
          };
        })
        // maxPriceMinor is applied in the QUERY now (see buildWhere), so `total`
        // and the page agree with it. openNow stays a post-filter because it is
        // computed from today's hours rather than stored.
        .filter((l) => (query.openNow ? l.openNow : true)),
    };
  }

  // ---------- Detail ----------

  /**
   * Everything a customer needs before booking, in one response.
   *
   * Reviews are deliberately NOT embedded: `GET /locations/:id/reviews` already
   * exists, is paginated and has its own exposure rules (§31). Duplicating them
   * here would mean two places to keep those rules right.
   */
  async findOne(locationId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phone: true,
        capacity: true,
        ratingAvg: true,
        ratingCount: true,
        businessId: true,
        business: {
          select: {
            id: true,
            name: true,
            description: true,
            phone: true,
            logoUrl: true,
            coverImageUrl: true,
            status: true,
            category: { select: { id: true, name: true, icon: true } },
            subcategory: { select: { id: true, name: true } },
          },
        },
        hours: {
          orderBy: { dayOfWeek: 'asc' },
          select: {
            dayOfWeek: true,
            openTime: true,
            closeTime: true,
            isClosed: true,
          },
        },
        media: {
          orderBy: { displayOrder: 'asc' },
          select: { id: true, url: true, type: true, displayOrder: true },
        },
      },
    });

    // 404, not 403 — identical to availability and reviews. A business that is
    // not public does not exist as far as a customer is concerned.
    if (!location || !isPubliclyBookable(location.business.status)) {
      throw new NotFoundException('Location not found.');
    }

    const today = this.localToday();
    const [services, exceptions, todayException, rate] = await Promise.all([
      // What THIS branch offers, at THIS branch's prices (§72). Reading the
      // business's services here would list work the branch does not do, and
      // price it from somewhere else.
      this.prisma.serviceLocation.findMany({
        where: { locationId, service: { isActive: true } },
        orderBy: { priceMinor: 'asc' },
        select: {
          priceMinor: true,
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              durationMinutes: true,
              depositPercentage: true,
              currency: true,
            },
          },
        },
      }),
      this.prisma.locationScheduleException.findMany({
        where: { locationId, date: { gte: today.date } },
        orderBy: { date: 'asc' },
        take: 30,
        select: {
          date: true,
          isClosed: true,
          customOpenTime: true,
          customCloseTime: true,
          reason: true,
        },
      }),
      this.prisma.locationScheduleException.findUnique({
        where: { locationId_date: { locationId, date: today.date } },
      }),
      this.settings.getExchangeRateForDisplay(),
    ]);

    const template = location.hours.find((h) => h.dayOfWeek === today.dayOfWeek) ?? null;

    return {
      id: location.id,
      name: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      phone: location.phone,
      capacity: location.capacity,
      business: {
        id: location.business.id,
        name: location.business.name,
        description: location.business.description,
        phone: location.business.phone,
        logoUrl: location.business.logoUrl,
        coverImageUrl: location.business.coverImageUrl,
        category: location.business.category,
        subcategory: location.business.subcategory,
      },
      rating: {
        average: location.ratingAvg ? Number(location.ratingAvg) : null,
        count: location.ratingCount,
      },
      // Flattened so a client still sees one service object with a price on it
      // — the per-branch join is how the price is STORED, not a shape a
      // customer should have to understand.
      services: services.map((offer) => ({
        ...offer.service,
        priceMinor: offer.priceMinor,
        depositPercentage: offer.service.depositPercentage.toFixed(2),
        ...(rate
          ? {
              approxSettlement: {
                priceMinor: approxSettlementFor(offer.priceMinor, rate),
              },
            }
          : {}),
      })),
      hours: location.hours,
      upcomingExceptions: exceptions,
      gallery: location.media,
      openNow: isOpenAt(
        this.windowFor(template, todayException),
        today.minutesSinceMidnight,
      ),
      timeZone: this.timeZone,
    };
  }

  // ---------- Distance ----------

  private resolveDistance(query: DiscoverLocationsDto) {
    const given = [query.lat, query.lng, query.radiusKm].filter(
      (v) => v !== undefined,
    ).length;
    if (given === 0) return null;
    if (given !== 3) {
      throw new BadRequestException(
        'lat, lng and radiusKm must be supplied together, or all omitted.',
      );
    }
    return { lat: query.lat!, lng: query.lng!, radiusKm: query.radiusKm! };
  }

  /**
   * Location ids inside the radius, with their distance, computed in SQL.
   *
   * A bounding box first, then haversine over what survives. The box is what
   * the `(latitude, longitude)` index can serve; without it every row would be
   * scanned and a trigonometric function evaluated against each. The box is a
   * superset of the circle — the corners are farther than the radius — so the
   * `HAVING` clause is what actually enforces it.
   *
   * `$queryRaw` because Prisma's builder cannot express a computed ordering
   * key; the same judgement already made for the busiest-hour aggregate (§29).
   * The aggregation stays in the database either way.
   *
   * Locations with NULL coordinates are excluded by the box conditions, which
   * is correct: a distance to an unknown point cannot be computed, and
   * inventing one would place them somewhere they are not.
   */
  private async locationIdsWithin(center: {
    lat: number;
    lng: number;
    radiusKm: number;
  }): Promise<DistanceRow[]> {
    const latDelta = center.radiusKm / 111.32;
    // Longitude degrees shrink towards the poles; clamped so a search near one
    // cannot divide by ~zero and produce an infinite box.
    const cosLat = Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01);
    const lngDelta = center.radiusKm / (111.32 * cosLat);

    // The haversine is computed once in the subquery and filtered in the outer
    // one. A HAVING clause would be wrong here — there is no GROUP BY, and
    // Postgres rejects it — and repeating the expression in a WHERE would
    // evaluate it twice per row.
    return this.prisma.$queryRaw<DistanceRow[]>`
      SELECT d."id", d."distance_km"
        FROM (
          SELECT l."id",
                 ${EARTH_RADIUS_KM} * 2 * ASIN(SQRT(
                   POWER(SIN(RADIANS(l."latitude" - ${center.lat}) / 2), 2)
                   + COS(RADIANS(${center.lat})) * COS(RADIANS(l."latitude"))
                   * POWER(SIN(RADIANS(l."longitude" - ${center.lng}) / 2), 2)
                 )) AS "distance_km"
            FROM "locations" l
           WHERE l."latitude"  BETWEEN ${center.lat - latDelta} AND ${center.lat + latDelta}
             AND l."longitude" BETWEEN ${center.lng - lngDelta} AND ${center.lng + lngDelta}
        ) d
       WHERE d."distance_km" <= ${center.radiusKm}
       ORDER BY d."distance_km" ASC
    `;
  }

  // ---------- Page-wide lookups ----------

  /**
   * Open-now for the whole page, in one hours query and one exception query.
   *
   * Same precedence as availability (§13.1): a date-specific exception outranks
   * the weekly template, including one that opens a day the template calls
   * closed.
   */
  private async openNowByLocation(locationIds: string[]) {
    const open = new Map<string, boolean>();
    if (locationIds.length === 0) return open;

    const today = this.localToday();
    const [hours, exceptions] = await Promise.all([
      this.prisma.locationHours.findMany({
        where: { locationId: { in: locationIds }, dayOfWeek: today.dayOfWeek },
        select: {
          locationId: true,
          openTime: true,
          closeTime: true,
          isClosed: true,
        },
      }),
      this.prisma.locationScheduleException.findMany({
        where: { locationId: { in: locationIds }, date: today.date },
        select: {
          locationId: true,
          isClosed: true,
          customOpenTime: true,
          customCloseTime: true,
        },
      }),
    ]);

    const templateBy = new Map(hours.map((h) => [h.locationId, h]));
    const exceptionBy = new Map(exceptions.map((e) => [e.locationId, e]));

    for (const locationId of locationIds) {
      open.set(
        locationId,
        isOpenAt(
          this.windowFor(
            templateBy.get(locationId) ?? null,
            exceptionBy.get(locationId) ?? null,
          ),
          today.minutesSinceMidnight,
        ),
      );
    }
    return open;
  }

  /** Resolves today's effective opening window: exception first, then template. */
  private windowFor(
    template: { openTime: string; closeTime: string; isClosed: boolean } | null,
    exception: {
      isClosed: boolean;
      customOpenTime: string | null;
      customCloseTime: string | null;
    } | null,
  ) {
    if (exception?.isClosed) return { openTime: null, closeTime: null, isClosed: true };
    if (exception?.customOpenTime && exception.customCloseTime) {
      return {
        openTime: exception.customOpenTime,
        closeTime: exception.customCloseTime,
        isClosed: false,
      };
    }
    if (!template) return null;
    return {
      openTime: template.openTime,
      closeTime: template.closeTime,
      isClosed: template.isClosed,
    };
  }

  // ---------- Shared ----------

  private buildWhere(query: DiscoverLocationsDto, ids: string[] | null) {
    const where: Prisma.LocationWhereInput = {
      // Only publicly bookable businesses, through the single shared predicate
      // rather than a second status check (§42.1).
      business: {
        status: BusinessStatus.APPROVED,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
      },
      ...(ids ? { id: { in: ids } } : {}),
      ...(query.minRating !== undefined ? { ratingAvg: { gte: query.minRating } } : {}),
      // Filters on the SAME column `sort=price` orders by, so the two can never
      // disagree about what a location's cheapest price is. A location with no
      // active services (null) is excluded — there is no price at or below the
      // cap because there is no price at all.
      ...(query.maxPriceMinor !== undefined
        ? { fromPriceMinor: { lte: query.maxPriceMinor } }
        : {}),
    };

    if (query.q) {
      // Case-insensitive substring, nothing more (§43.6). No full-text index,
      // no trigram extension, no new dependency.
      const contains = { contains: query.q, mode: 'insensitive' as const };
      where.OR = [
        { name: contains },
        { business: { is: { name: contains, status: BusinessStatus.APPROVED } } },
        {
          business: {
            is: {
              status: BusinessStatus.APPROVED,
              services: { some: { name: contains, isActive: true } },
            },
          },
        },
      ];
    }

    return where;
  }

  private orderBy(query: DiscoverLocationsDto): Prisma.LocationOrderByWithRelationInput[] {
    if (query.sort === DiscoverySort.RATING) {
      // Nulls last: an unrated location is not better than a 5.0 one.
      return [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { ratingCount: 'desc' }];
    }
    if (query.sort === DiscoverySort.PRICE) {
      // Cheapest first, and ACROSS pages — §43.6 could not do this because the
      // price was not a column. Nulls last: a business with no services yet is
      // not free, and burying it at the end is different from hiding it.
      return [
        { fromPriceMinor: { sort: 'asc', nulls: 'last' } },
        { name: 'asc' },
      ];
    }
    return [{ name: 'asc' }];
  }

  private priceSettlement(
    fromPriceMinor: number | null,
    rate: RateContext | null,
  ): { approxSettlement?: { fromPriceMinor: ApproxSettlement } } {
    if (!rate || fromPriceMinor === null) return {};
    return {
      approxSettlement: { fromPriceMinor: approxSettlementFor(fromPriceMinor, rate) },
    };
  }

  /** Today, in the platform timezone: the calendar date and the local minute. */
  private localToday() {
    const { date, minutesSinceMidnight } = instantToZonedParts(
      new Date(),
      this.timeZone,
    );
    return { date, minutesSinceMidnight, dayOfWeek: dayOfWeekUtc(date) };
  }

  private emptyPage(
    limit: number,
    offset: number,
    distance: { lat: number; lng: number; radiusKm: number } | null,
  ) {
    return {
      total: 0,
      limit,
      offset,
      ...(distance
        ? { center: { lat: distance.lat, lng: distance.lng }, radiusKm: distance.radiusKm }
        : {}),
      locations: [],
    };
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;
