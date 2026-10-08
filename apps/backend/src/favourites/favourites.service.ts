import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessStatus, Prisma } from '@prisma/client';
import { isPubliclyBookable } from '../business/business-status';
import { COUNTED_BOOKING_STATUSES } from '../discovery/popularity';
import {
  SavedServiceDto,
  SavedServicePageDto,
  ServiceFavouriteStateDto,
} from './dto/service-favourite.dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { liveDiscount, platformToday, priceFor } from '../business/discount';
import {
  FavouriteStateDto,
  SavedPlacePageDto,
} from './dto/favourite-response.dto';

@Injectable()
export class FavouritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Saves a place. Saving one already saved changes nothing (§120).
   *
   * Idempotent through the unique index rather than a read-then-write, which two
   * taps both pass — the same reasoning §21.1 used for inquiry threads.
   */
  async add(customerId: string, locationId: string): Promise<FavouriteStateDto> {
    // A branch that is closed, or whose business is not public, is not
    // something to save. 404 rather than 403: it does not exist to a customer.
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        isActive: true,
        business: { status: BusinessStatus.APPROVED },
      },
      select: { id: true },
    });
    if (!location) throw new NotFoundException('Location not found.');

    await this.prisma.favourite.upsert({
      where: { customerId_locationId: { customerId, locationId } },
      create: { customerId, locationId },
      update: {},
    });
    return { locationId, saved: true };
  }

  /** Removing one that is not saved is not an error — the end state is the same. */
  async remove(customerId: string, locationId: string): Promise<FavouriteStateDto> {
    await this.prisma.favourite.deleteMany({ where: { customerId, locationId } });
    return { locationId, saved: false };
  }

  /**
   * The saved places, newest first.
   *
   * A paused or closed branch is kept in the list and marked, not hidden. A
   * customer who saved their barber and cannot find it again would conclude the
   * app lost it; "this shop is not taking bookings right now" is the useful
   * answer, and it comes back on its own when the shop does.
   */
  async list(customerId: string): Promise<SavedPlacePageDto> {
    const rows = await this.prisma.favourite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            isActive: true,
            ratingAvg: true,
            ratingCount: true,
            fromPriceMinor: true,
            district: {
              select: { id: true, name: true, province: { select: { name: true } } },
            },
            business: {
              select: {
                id: true,
                name: true,
                status: true,
                pausedAt: true,
                logoUrl: true,
                coverImageUrl: true,
              },
            },
          },
        },
      },
    });

    return {
      total: rows.length,
      favourites: rows.map(({ createdAt, location }) => ({
        // An ISO string here as well as on the wire (§128.4). A response that is
        // ASSEMBLED declares its own shape, so the two differing by one field
        // would mean a bridge between them for nothing — nobody does arithmetic
        // on this, it is shown.
        savedAt: createdAt.toISOString(),
        id: location.id,
        name: location.name,
        address: location.address,
        ratingAvg: location.ratingAvg ? Number(location.ratingAvg) : null,
        ratingCount: location.ratingCount,
        fromPriceMinor: location.fromPriceMinor,
        district: location.district
          ? {
              id: location.district.id,
              name: location.district.name,
              provinceName: location.district.province.name,
            }
          : null,
        business: {
          id: location.business.id,
          name: location.business.name,
          logoUrl: location.business.logoUrl,
          coverImageUrl: location.business.coverImageUrl,
        },
        /**
         * Whether this can be booked right now. One field rather than three,
         * because the three reasons a customer cannot book — the branch closed,
         * the shop paused, the shop is no longer approved — all mean the same
         * thing to them, and two of the three are nobody's business.
         */
        bookable:
          location.isActive &&
          location.business.status === BusinessStatus.APPROVED &&
          location.business.pausedAt === null,
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Saved services (§158)
  // ---------------------------------------------------------------------

  /**
   * Saves a service at a branch. Only one a customer could book right now: a
   * service that is retired, not sold at that branch, or at a branch the
   * public cannot see is, to this caller, not there (§42.1).
   */
  async addService(
    customerId: string,
    serviceId: string,
    locationId: string,
  ): Promise<ServiceFavouriteStateDto> {
    const offer = await this.prisma.serviceLocation.findFirst({
      where: {
        serviceId,
        locationId,
        isOffered: true,
        service: { isActive: true },
        location: { isActive: true },
      },
      select: { location: { select: { business: { select: { status: true, pausedAt: true } } } } },
    });
    if (!offer || !isPubliclyBookable(offer.location.business)) {
      throw new NotFoundException('Service not found.');
    }
    await this.prisma.serviceFavourite.upsert({
      where: { customerId_serviceId_locationId: { customerId, serviceId, locationId } },
      create: { customerId, serviceId, locationId },
      update: {},
    });
    return { serviceId, locationId, saved: true };
  }

  async removeService(
    customerId: string,
    serviceId: string,
    locationId: string,
  ): Promise<ServiceFavouriteStateDto> {
    await this.prisma.serviceFavourite.deleteMany({ where: { customerId, serviceId, locationId } });
    return { serviceId, locationId, saved: false };
  }

  /**
   * The saved services, newest first, as the cards the home screen shows.
   *
   * Two kinds of "not now" (§158). TEMPORARY — the branch closed, the business
   * paused or not approved, the service paused at that branch — is kept and
   * marked `bookable: false`, like a saved place. GONE — the service retired by
   * the business, or its offer at that branch deleted — is taken off the list
   * here and now and counted in `removed`, so the list is never a row that
   * leads nowhere and the customer is told once why it is shorter.
   */
  async listServices(customerId: string): Promise<SavedServicePageDto> {
    const rows = await this.prisma.serviceFavourite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        serviceId: true,
        locationId: true,
        createdAt: true,
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            durationMinutes: true,
            currency: true,
            depositPercentage: true,
            isActive: true,
            discountPercent: true,
            discountEndsOn: true,
            images: {
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              take: 1,
              select: { url: true },
            },
            locations: { select: { locationId: true, priceMinor: true, isOffered: true } },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            isActive: true,
            ratingAvg: true,
            ratingCount: true,
            district: { select: { id: true, name: true } },
            business: {
              select: {
                id: true,
                name: true,
                logoUrl: true,
                coverImageUrl: true,
                status: true,
                pausedAt: true,
                category: { select: { id: true, name: true, icon: true } },
                subcategory: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const gone = rows.filter(
      (r) => !r.service.isActive || !r.service.locations.some((o) => o.locationId === r.locationId),
    );
    if (gone.length > 0) {
      await this.prisma.serviceFavourite.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
    }
    const kept = rows.filter((r) => !gone.includes(r));

    // Bookings per branch, for the "N booked" line, one grouped query.
    const locationIds = [...new Set(kept.map((r) => r.locationId))];
    const grouped =
      locationIds.length === 0
        ? []
        : await this.prisma.appointment.groupBy({
            by: ['locationId', 'serviceId'],
            where: { locationId: { in: locationIds }, status: { in: COUNTED_BOOKING_STATUSES } },
            _count: { _all: true },
          });
    const bookings = new Map(grouped.map((g) => [`${g.serviceId}:${g.locationId}`, g._count._all]));

    // At the price paid today: after a sale, if one is on (§186).
    const today = platformToday(this.config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba');
    const services: SavedServiceDto[] = kept.map((r) => {
      const offer = r.service.locations.find((o) => o.locationId === r.locationId)!;
      const price = priceFor(offer.priceMinor, liveDiscount(r.service, today));
      const { status, pausedAt, ...business } = r.location.business;
      return {
        id: r.service.id,
        name: r.service.name,
        description: r.service.description,
        durationMinutes: r.service.durationMinutes,
        currency: r.service.currency,
        priceMinor: price.priceMinor,
        discount: price.discount,
        depositPercentage: r.service.depositPercentage.toFixed(2),
        imageUrl: r.service.images[0]?.url ?? null,
        bookingCount: bookings.get(`${r.serviceId}:${r.locationId}`) ?? 0,
        location: {
          id: r.location.id,
          name: r.location.name,
          district: r.location.district,
          ratingAvg: r.location.ratingAvg ? Number(r.location.ratingAvg) : null,
          ratingCount: r.location.ratingCount,
          // Not computed here: the saved list is not a search, and a wrong
          // "open now" is worse than none. The card does not show it.
          openNow: false,
        },
        business,
        saved: true,
        savedAt: r.createdAt.toISOString(),
        bookable:
          offer.isOffered && r.location.isActive && isPubliclyBookable({ status, pausedAt }),
      };
    });

    return { total: services.length, services, removed: gone.length };
  }

  /**
   * Which of these service-at-branch pairs this customer has saved, as
   * "serviceId:locationId" keys. One query per page, like `savedAmong`.
   */
  async savedServicesAmong(
    customerId: string | undefined,
    pairs: Array<{ serviceId: string; locationId: string }>,
  ) {
    if (!customerId || pairs.length === 0) return new Set<string>();
    const rows = await this.prisma.serviceFavourite.findMany({
      where: {
        customerId,
        OR: pairs.map((p) => ({ serviceId: p.serviceId, locationId: p.locationId })),
      },
      select: { serviceId: true, locationId: true },
    });
    return new Set(rows.map((r) => `${r.serviceId}:${r.locationId}`));
  }

  /**
   * Which of these locations this customer has saved.
   *
   * One query for a whole page, never one per row — the same rule the rest of
   * discovery follows (§43's stated query budget). Returns an empty set for a
   * signed-out caller without asking the database anything.
   */
  async savedAmong(customerId: string | undefined, locationIds: string[]) {
    if (!customerId || locationIds.length === 0) return new Set<string>();
    const rows = await this.prisma.favourite.findMany({
      where: { customerId, locationId: { in: locationIds } },
      select: { locationId: true },
    });
    return new Set(rows.map((row) => row.locationId));
  }
}
