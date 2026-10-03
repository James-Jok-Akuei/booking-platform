import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FavouriteStateDto,
  SavedPlacePageDto,
} from './dto/favourite-response.dto';

@Injectable()
export class FavouritesService {
  constructor(private readonly prisma: PrismaService) {}

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
