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
import { FavouritesService } from '../favourites/favourites.service';
import { dayOfWeekUtc, instantToZonedParts } from '../availability/time.util';
import { isOpenAt } from './open-now';
import { DiscoverLocationsDto, DiscoverySort } from './dto/discover-locations.dto';
import { DiscoveredServicePageDto, DiscoveryPageDto } from './dto/discovery-response.dto';
import { COUNTED_BOOKING_STATUSES, byPopularity } from './popularity';

/** Rows the bounding-box + haversine query returns. */
interface DistanceRow {
  id: string;
  distance_km: number;
}

const DEFAULT_LIMIT = 20;

/** Mean Earth radius, the standard haversine constant. */
const EARTH_RADIUS_KM = 6371;

/**
 * Narrows two optional id restrictions into one.
 *
 * `null` means "no restriction", so it is not the same as an empty array — one
 * means every location is still a candidate and the other means none is.
 */
function intersectIds(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const inB = new Set(b);
  return a.filter((id) => inB.has(id));
}

@Injectable()
export class DiscoveryService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly favourites: FavouritesService,
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
   * **five queries, plus one when distance is used**, and none of them per-row.
   * The fifth is the booking count (§135.1), one grouped query for the page.
   */
  async search(
    query: DiscoverLocationsDto,
    viewerId?: string,
  ): Promise<DiscoveryPageDto> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const distance = this.resolveDistance(query);

    if (query.sort === DiscoverySort.DISTANCE && !distance) {
      throw new BadRequestException('sort=distance requires lat and lng.');
    }

    // (1) The bounding-box + haversine prefilter, when searching by distance.
    // Returns ids and distances only; the rest is loaded by the shared path
    // below so a distance search and an ordinary browse cannot drift apart.
    const nearby = distance ? await this.locationIdsWithin(distance) : null;

    // An empty result only means "nothing found" when a radius was asked for.
    // Without one the query excludes nothing, so an empty list here would be a
    // platform with no located branches at all, and the ordinary path handles
    // that correctly.
    if (distance?.radiusKm !== undefined && nearby && nearby.length === 0) {
      return this.emptyPage(limit, offset, distance);
    }

    // Ids narrow the search ONLY when a radius was given. Otherwise `nearby`
    // is just a distance lookup for ordering and display (§107).
    const restrictTo =
      distance?.radiusKm !== undefined ? (nearby?.map((r) => r.id) ?? null) : null;

    /**
     * `openNow` resolved into the WHERE, by way of the ids it matches (§114.2).
     *
     * It cannot be a WHERE clause directly: whether a branch is open right now
     * comes from today's hours, today's exceptions, and the clock — and that
     * rule lives in `openNowByLocation`. Rewriting it in SQL would put the same
     * rule in two languages, which is the drift §44 moved the cheapest price
     * into a column to avoid.
     *
     * It used to be a filter on the page AFTER it was fetched, and that was
     * wrong twice over. `total` counted rows the filter then removed, so a
     * client paginating on it asked for a page that does not exist. Worse, the
     * filter ran after `take`/`skip`, so a page of 25 came back with 19 rows
     * while more open branches waited on page two — and page two skipped 25,
     * not 19, so some were never reachable at all.
     *
     * Resolving the ids first costs one extra query, and only when the filter is
     * asked for. The map it produces is reused for the page's own flag below, so
     * nothing is computed twice.
     */
    let openNowByCandidate: Map<string, boolean> | null = null;
    let openIds: string[] | null = null;
    if (query.openNow) {
      const candidates = await this.prisma.location.findMany({
        where: this.buildWhere(query, restrictTo),
        select: { id: true },
      });
      openNowByCandidate = await this.openNowByLocation(candidates.map((c) => c.id));
      openIds = candidates.map((c) => c.id).filter((id) => openNowByCandidate!.get(id));
      if (openIds.length === 0) return this.emptyPage(limit, offset, distance);
    }

    const where = this.buildWhere(query, intersectIds(restrictTo, openIds));

    // Two orders cannot be expressed as a column Prisma can sort by: distance
    // lives in raw SQL, and popularity is a count from another table weighted by
    // a rating (§135.1). Both take every candidate and order them here. That is
    // bounded by the number of bookable branches on the platform, which is
    // small; the day it is not, popularity becomes a maintained column the way
    // the cheapest price did (§44).
    const sortedInMemory =
      query.sort === DiscoverySort.DISTANCE || query.sort === DiscoverySort.POPULAR;

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
        ...(sortedInMemory ? {} : { take: limit, skip: offset }),
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
          // The place, with its province (§104). Shown on the card, because
          // "Remera" means more to someone in Kigali than a street name.
          district: {
            select: {
              id: true,
              name: true,
              province: { select: { id: true, name: true } },
            },
          },
          business: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              // The picture a card leads with (§133). Null is normal, and a
              // client falls back to a tinted tile rather than a hole.
              coverImageUrl: true,
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

    // Counted for every candidate when it decides the order, and reused for the
    // page below so it is never asked for twice.
    let bookingsByCandidate: Map<string, number> | null = null;
    if (query.sort === DiscoverySort.POPULAR) {
      bookingsByCandidate = await this.bookingsByLocation(locations.map((l) => l.id));
      const counts = bookingsByCandidate;
      const rank = (l: (typeof locations)[number]) => ({
        bookings: counts.get(l.id) ?? 0,
        ratingAvg: l.ratingAvg ? Number(l.ratingAvg) : null,
        ratingCount: l.ratingCount,
        name: l.name,
      });
      rows = [...locations]
        .sort((a, b) => byPopularity(rank(a), rank(b)))
        .slice(offset, offset + limit);
    }

    // (4) and (5): the open-now inputs for the whole page. Never per row.
    //
    // The cheapest price no longer needs a query at all — it is a column on the
    // location now (§44), maintained on write. That is one fewer query per page
    // AND the reason `sort=price` can order rows this page never fetched.
    const [pageOpenNow, rate, saved, bookings] = await Promise.all([
      // Already known when the filter was applied, and every row on this page is
      // one of those candidates.
      openNowByCandidate ?? this.openNowByLocation(rows.map((l) => l.id)),
      // One rate read per response, reused for every amount in it (§39).
      this.settings.getExchangeRateForDisplay(),
      // One query for the page, never one per row — and none at all for a
      // signed-out caller, which is most of them (§120).
      this.favourites.savedAmong(viewerId, rows.map((l) => l.id)),
      bookingsByCandidate ?? this.bookingsByLocation(rows.map((l) => l.id)),
    ]);
    const openNow = pageOpenNow;

    return {
      total: sortedInMemory ? locations.length : total,
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
            // Flattened: a caller wants "Remera, City of Kigali", not a
            // two-level object to walk.
            district: location.district
              ? {
                  id: location.district.id,
                  name: location.district.name,
                  provinceId: location.district.province.id,
                  provinceName: location.district.province.name,
                }
              : null,
            business: location.business,
            ratingAvg: location.ratingAvg ? Number(location.ratingAvg) : null,
            ratingCount: location.ratingCount,
            fromPriceMinor,
            ...this.priceSettlement(fromPriceMinor, rate),
            bookingCount: bookings.get(location.id) ?? 0,
            openNow: openNow.get(location.id) ?? false,
            // Absent rather than false when nobody is signed in: there is no
            // answer to "have you saved this" without a "you", and false would
            // render an empty heart that cannot be filled.
            ...(viewerId ? { saved: saved.has(location.id) } : {}),
            ...(distanceById.has(location.id)
              ? { distanceKm: round2(distanceById.get(location.id)!) }
              : {}),
          };
        })
      // No post-filter any more. maxPriceMinor and openNow are both resolved in
      // the QUERY, so `total`, the page and every filter agree (§114.2).
    };
  }

  // ---------- Services, across every shop ----------

  /**
   * Every bookable service on the platform, as one list (§135.2).
   *
   * Until now a service could only be seen from inside its shop: a customer who
   * wanted "a manicure" had to open each salon in turn to find who offers one
   * and for how much. This is the shop window — the thing itself, with its
   * price, wherever it is sold.
   *
   * A row is a service AT A BRANCH, because that is what is booked (§72).
   *
   * It takes the SAME query as the place search and narrows by the same rules,
   * through `buildWhere`, so a branch that is closed, paused or not approved is
   * absent from both and the two cannot drift. Two filters mean something
   * narrower here and are applied to the offer instead of the branch:
   *
   * - `q` matches the SERVICE's own name as well as its shop's. Searching
   *   "manicure" returns manicures, not every service at a salon that happens
   *   to do them.
   * - `maxPriceMinor` caps THIS service's price, not the shop's cheapest.
   *
   * Ordered in memory, for every sort. The interesting one — popularity — is a
   * count from another table weighted by a rating, which no index orders by;
   * and having ordered one in memory, doing the rest the same way means one
   * code path instead of five. Bounded by the number of live offers on the
   * platform. The same note as the place search: when that hurts, the count
   * becomes a maintained column (§44).
   *
   * Five queries regardless of page size, six with a position. None per row.
   */
  async searchServices(
    query: DiscoverLocationsDto,
    viewerId?: string,
  ): Promise<DiscoveredServicePageDto> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const distance = this.resolveDistance(query);

    if (query.sort === DiscoverySort.DISTANCE && !distance) {
      throw new BadRequestException('sort=distance requires lat and lng.');
    }

    const nearby = distance ? await this.locationIdsWithin(distance) : null;
    const restrictTo =
      distance?.radiusKm !== undefined ? (nearby?.map((r) => r.id) ?? null) : null;

    // The branch rules, minus the two filters that belong to the offer.
    const { q, maxPriceMinor, ...branchQuery } = query;
    const locationWhere = this.buildWhere(branchQuery as DiscoverLocationsDto, restrictTo);
    const contains = q ? { contains: q, mode: 'insensitive' as const } : null;

    const offers = await this.prisma.serviceLocation.findMany({
      where: {
        isOffered: true,
        ...(maxPriceMinor !== undefined ? { priceMinor: { lte: maxPriceMinor } } : {}),
        service: { isActive: true },
        location: locationWhere,
        ...(contains
          ? {
              OR: [
                { service: { name: contains } },
                { location: { name: contains } },
                { location: { business: { name: contains } } },
              ],
            }
          : {}),
      },
      select: {
        priceMinor: true,
        locationId: true,
        serviceId: true,
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            durationMinutes: true,
            currency: true,
            depositPercentage: true,
            createdAt: true,
            // Only the cover. The rest are on the booking screen (§132).
            images: {
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              take: 1,
              select: { url: true },
            },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            ratingAvg: true,
            ratingCount: true,
            district: { select: { id: true, name: true } },
            business: {
              select: {
                id: true,
                name: true,
                logoUrl: true,
                coverImageUrl: true,
                category: { select: { id: true, name: true, icon: true } },
                subcategory: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const locationIds = [...new Set(offers.map((o) => o.locationId))];
    const [openNow, grouped] = await Promise.all([
      this.openNowByLocation(locationIds),
      // One grouped count for every candidate offer at once.
      offers.length === 0
        ? Promise.resolve([])
        : this.prisma.appointment.groupBy({
            by: ['serviceId', 'locationId'],
            where: {
              serviceId: { in: [...new Set(offers.map((o) => o.serviceId))] },
              locationId: { in: locationIds },
              status: { in: COUNTED_BOOKING_STATUSES },
            },
            _count: { _all: true },
          }),
    ]);

    const key = (serviceId: string, locationId: string) => `${serviceId}:${locationId}`;
    const bookings = new Map(
      grouped.map((g) => [key(g.serviceId, g.locationId), g._count._all]),
    );
    const distanceById = new Map(nearby?.map((r) => [r.id, r.distance_km]) ?? []);

    // `openNow` is a filter on the BRANCH, resolved the way the place search
    // resolves it: from the one function that knows the rule (§114.2).
    const candidates = query.openNow
      ? offers.filter((o) => openNow.get(o.locationId))
      : offers;

    const rating = (o: (typeof offers)[number]) =>
      o.location.ratingAvg ? Number(o.location.ratingAvg) : null;
    const rank = (o: (typeof offers)[number]) => ({
      bookings: bookings.get(key(o.serviceId, o.locationId)) ?? 0,
      ratingAvg: rating(o),
      ratingCount: o.location.ratingCount,
      // The service's name, then the branch's: stable when one service is sold
      // at two branches with the same score.
      name: `${o.service.name} ${o.location.name}`,
    });
    const popular = (a: (typeof offers)[number], b: (typeof offers)[number]) =>
      byPopularity(rank(a), rank(b));

    const sorted = [...candidates].sort((a, b) => {
      switch (query.sort) {
        case DiscoverySort.PRICE:
          return a.priceMinor - b.priceMinor || popular(a, b);
        case DiscoverySort.RATING:
          return (rating(b) ?? -1) - (rating(a) ?? -1) || popular(a, b);
        case DiscoverySort.NEWEST:
          return b.service.createdAt.getTime() - a.service.createdAt.getTime() || popular(a, b);
        case DiscoverySort.DISTANCE:
          return (
            (distanceById.get(a.locationId) ?? Infinity) -
              (distanceById.get(b.locationId) ?? Infinity) || popular(a, b)
          );
        default:
          // Popular is the default here, unlike the place search: a shelf of
          // services in alphabetical order would be a shelf nobody arranged.
          return popular(a, b);
      }
    });

    const page = sorted.slice(offset, offset + limit);
    const savedServices = await this.favourites.savedServicesAmong(
      viewerId,
      page.map((o) => ({ serviceId: o.serviceId, locationId: o.locationId })),
    );

    return {
      total: sorted.length,
      limit,
      offset,
      services: page.map((o) => ({
        id: o.service.id,
        name: o.service.name,
        description: o.service.description,
        durationMinutes: o.service.durationMinutes,
        currency: o.service.currency,
        priceMinor: o.priceMinor,
        depositPercentage: o.service.depositPercentage.toFixed(2),
        imageUrl: o.service.images[0]?.url ?? null,
        bookingCount: bookings.get(key(o.serviceId, o.locationId)) ?? 0,
        location: {
          id: o.location.id,
          name: o.location.name,
          district: o.location.district,
          ratingAvg: rating(o),
          ratingCount: o.location.ratingCount,
          openNow: openNow.get(o.locationId) ?? false,
          ...(distanceById.has(o.locationId)
            ? { distanceKm: round2(distanceById.get(o.locationId)!) }
            : {}),
        },
        business: o.location.business,
        ...(viewerId ? { saved: savedServices.has(key(o.serviceId, o.locationId)) } : {}),
      })),
    };
  }

  /** Paid, not-called-off bookings per branch — one grouped query (§135.1). */
  private async bookingsByLocation(locationIds: string[]): Promise<Map<string, number>> {
    if (locationIds.length === 0) return new Map();
    const grouped = await this.prisma.appointment.groupBy({
      by: ['locationId'],
      where: { locationId: { in: locationIds }, status: { in: COUNTED_BOOKING_STATUSES } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.locationId, g._count._all]));
  }

  // ---------- Detail ----------

  /**
   * Everything a customer needs before booking, in one response.
   *
   * Reviews are deliberately NOT embedded: `GET /locations/:id/reviews` already
   * exists, is paginated and has its own exposure rules (§31). Duplicating them
   * here would mean two places to keep those rules right.
   */
  async findOne(locationId: string, viewerId?: string) {
    // findFirst, not findUnique: a closed branch must 404 for a customer the
    // same way it is absent from search (§89), and `where` on findUnique takes
    // only unique fields.
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        // The place, as the list carries it (§104). A shop page that omits it
        // while the card showed it reads as the data having been lost.
        district: {
          select: {
            id: true,
            name: true,
            province: { select: { id: true, name: true } },
          },
        },
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
            pausedAt: true,
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
    if (!location || !isPubliclyBookable(location.business)) {
      throw new NotFoundException('Location not found.');
    }

    const today = this.localToday();
    const [services, exceptions, todayException, rate] = await Promise.all([
      // What THIS branch offers, at THIS branch's prices (§72). Reading the
      // business's services here would list work the branch does not do, and
      // price it from somewhere else.
      this.prisma.serviceLocation.findMany({
        where: { locationId, isOffered: true, service: { isActive: true } },
        orderBy: { priceMinor: 'asc' },
        select: {
          priceMinor: true,
          service: {
            select: {
              id: true,
              name: true,
              title: true,
              description: true,
              instructions: true,
              durationMinutes: true,
              depositPercentage: true,
              currency: true,
              quantityMode: true,
              maxQuantity: true,
              // What the service actually looks like (§132). Ordered here, so
              // the first one is the cover on every client.
              images: {
                orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, url: true, displayOrder: true },
              },
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

    const saved = await this.favourites.savedAmong(viewerId, [location.id]);
    const savedServices = await this.favourites.savedServicesAmong(
      viewerId,
      services.map((offer) => ({ serviceId: offer.service.id, locationId })),
    );

    return {
      // Absent for a signed-out reader: there is no answer to "have you saved
      // this" without a "you" (§120).
      ...(viewerId ? { saved: saved.has(location.id) } : {}),
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
        quantityMode: offer.service.quantityMode,
        maxQuantity: offer.service.maxQuantity,
        ...(viewerId ? { saved: savedServices.has(`${offer.service.id}:${locationId}`) } : {}),
        ...(rate
          ? {
              approxSettlement: {
                priceMinor: approxSettlementFor(offer.priceMinor, rate),
              },
            }
          : {}),
      })),
      district: location.district
        ? {
            id: location.district.id,
            name: location.district.name,
            provinceId: location.district.province.id,
            provinceName: location.district.province.name,
          }
        : null,
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

  /**
   * Where the customer is, and optionally how far they will travel (§107).
   *
   * `lat` and `lng` go together — half a coordinate is not a place. `radiusKm`
   * is **optional and separate**: without it, distance is computed for
   * ordering and display and **nothing is excluded**.
   *
   * That split is the whole point. Knowing where somebody is should put the
   * nearest shop first, not hide the one across town — a filter is something a
   * customer asks for (§106.2).
   */
  private resolveDistance(query: DiscoverLocationsDto) {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;

    if (!hasLat && !hasLng) {
      if (query.radiusKm !== undefined) {
        throw new BadRequestException(
          'radiusKm needs lat and lng — a radius has to be a radius around something.',
        );
      }
      return null;
    }
    if (hasLat !== hasLng) {
      throw new BadRequestException('lat and lng must be supplied together.');
    }

    return { lat: query.lat!, lng: query.lng!, radiusKm: query.radiusKm };
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
    radiusKm?: number;
  }): Promise<DistanceRow[]> {
    // No radius: distance for everything that has coordinates, excluding
    // nothing (§107). The bounding box exists to let the index narrow the set
    // before the trigonometry; with nothing to narrow to there is none, which
    // is a full scan over one country's branches and acceptable at this size.
    if (center.radiusKm === undefined) {
      return this.prisma.$queryRaw<DistanceRow[]>`
        SELECT l."id",
               ${EARTH_RADIUS_KM} * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(l."latitude" - ${center.lat}) / 2), 2)
                 + COS(RADIANS(${center.lat})) * COS(RADIANS(l."latitude"))
                 * POWER(SIN(RADIANS(l."longitude" - ${center.lng}) / 2), 2)
               )) AS "distance_km"
          FROM "locations" l
         WHERE l."latitude" IS NOT NULL AND l."longitude" IS NOT NULL
         ORDER BY "distance_km" ASC
      `;
    }

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
      // A closed branch is not bookable and must not be discoverable (§89).
      // Applied in buildWhere so the count and the page agree about it, the
      // same reason maxPriceMinor moved into the query.
      isActive: true,
      // Only publicly bookable businesses, through the single shared predicate
      // rather than a second status check (§42.1).
      business: {
        status: BusinessStatus.APPROVED,
        // A business that paused itself is out of search until it resumes
        // (§119.3). Bookings already made still happen; this stops new ones.
        pausedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
      },
      ...(ids ? { id: { in: ids } } : {}),
      // Place (§104). districtId is the narrower of the two, so it wins when
      // both are sent rather than being ANDed into a contradiction.
      ...(query.districtId
        ? { districtId: query.districtId }
        : query.provinceId
          ? { district: { provinceId: query.provinceId } }
          : {}),
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
        { business: { is: { name: contains, status: BusinessStatus.APPROVED, pausedAt: null } } },
        {
          business: {
            is: {
              status: BusinessStatus.APPROVED,
              pausedAt: null,
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
    if (query.sort === DiscoverySort.NEWEST) {
      // When the shop was listed, not when its row last changed: `updatedAt`
      // would reshuffle the list every time a business edited its opening hours.
      // Tie-broken by name so the order is stable across pages.
      return [{ createdAt: 'desc' }, { name: 'asc' }];
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
    distance: { lat: number; lng: number; radiusKm?: number } | null,
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
