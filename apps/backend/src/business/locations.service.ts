import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessAccessService } from './business-access.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { recalculateFromPrice } from './from-price';
import { SetLocationHoursDto } from './dto/set-hours.dto';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
  ) {}

  async create(userId: string, dto: CreateLocationDto) {
    const businessId = await this.access.requireBusinessId(userId);

    // Coordinates are optional, but a lone latitude is meaningless — reject the
    // half-set pair rather than storing a point that can never be mapped.
    this.assertCoordinatePair(dto.latitude, dto.longitude);

    return this.prisma.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: { businessId, ...dto },
        include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
      });
      // A new branch inherits the business's existing catalogue immediately —
      // it opens with a headline price, not with a blank that fills in when
      // someone next edits a service (§44).
      await recalculateFromPrice(tx, businessId);
      return tx.location.findUniqueOrThrow({
        where: { id: location.id },
        include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
      });
    });
  }

  async findAll(userId: string) {
    const businessId = await this.access.requireBusinessId(userId);

    return this.prisma.location.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      include: {
        hours: { orderBy: { dayOfWeek: 'asc' } },
        _count: { select: { media: true } },
      },
    });
  }

  async update(userId: string, locationId: string, dto: UpdateLocationDto) {
    const businessId = await this.access.requireBusinessId(userId);
    const existing = await this.access.requireOwnedLocation(businessId, locationId);

    // Validate against the merged result, not just the patch: clearing one half
    // of an existing coordinate pair is as invalid as setting only one half.
    this.assertCoordinatePair(
      dto.latitude ?? existing.latitude ?? undefined,
      dto.longitude ?? existing.longitude ?? undefined,
    );

    // Coordinates that exist cannot be removed (§43.2). A location that has
    // them is discoverable; clearing them would drop it out of every distance
    // search silently, which looks to the business like the platform losing
    // their listing. Adding them to a location that lacks them is allowed and
    // is exactly how a pre-§43 row becomes discoverable.
    const clearing =
      (existing.latitude !== null && dto.latitude === null) ||
      (existing.longitude !== null && dto.longitude === null);
    if (clearing) {
      throw new BadRequestException(
        'Coordinates cannot be removed once set. Send corrected values instead — ' +
          'a location without them cannot appear in a distance search.',
      );
    }

    return this.prisma.location.update({
      where: { id: locationId },
      data: dto,
      include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
    });
  }

  async remove(userId: string, locationId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    // Hard delete, unlike services. A location has no historical appointment
    // references to preserve yet, and its hours and media cascade with it.
    // Revisit when appointments start pointing at a locationId.
    await this.prisma.location.delete({ where: { id: locationId } });

    return { message: 'Location deleted.' };
  }

  /**
   * Replaces a location's operating hours wholesale.
   *
   * Set-and-replace rather than incremental edits: the frontend edits a whole
   * week at once, and a delete-then-insert inside a transaction keeps the table
   * free of stale days left behind by a shrinking payload.
   */
  async setHours(userId: string, locationId: string, dto: SetLocationHoursDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const seen = new Set<number>();
    for (const entry of dto.hours) {
      if (seen.has(entry.dayOfWeek)) {
        throw new BadRequestException(
          `Duplicate entry for ${DAY_NAMES[entry.dayOfWeek]}. Send one row per day.`,
        );
      }
      seen.add(entry.dayOfWeek);

      // Only meaningful for open days — a closed day's times are normalised away below.
      if (!entry.isClosed && entry.closeTime <= entry.openTime) {
        throw new BadRequestException(
          `${DAY_NAMES[entry.dayOfWeek]}: closeTime must be later than openTime. ` +
            'Overnight hours are not supported yet.',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.locationHours.deleteMany({ where: { locationId } }),
      this.prisma.locationHours.createMany({
        data: dto.hours.map((entry) => ({
          locationId,
          dayOfWeek: entry.dayOfWeek,
          // A closed day stores 00:00–00:00 so the row is unambiguous and the
          // scheduling module never has to interpret leftover times.
          openTime: entry.isClosed ? '00:00' : entry.openTime,
          closeTime: entry.isClosed ? '00:00' : entry.closeTime,
          isClosed: entry.isClosed ?? false,
        })),
      }),
    ]);

    return this.prisma.locationHours.findMany({
      where: { locationId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  /**
   * Sets how many appointments this location can run at once.
   *
   * Its own endpoint rather than a field on the general location PATCH:
   * capacity changes what the availability engine will accept, so it is worth
   * being a deliberate, separately-audited action rather than something that
   * rides along with editing a phone number.
   *
   * Lowering capacity below the number of appointments already booked in some
   * slot is allowed and does NOT cancel anything — those bookings stand, and
   * the slot simply offers nothing further until they clear.
   */
  async setCapacity(userId: string, locationId: string, capacity: number) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    return this.prisma.location.update({
      where: { id: locationId },
      data: { capacity },
      select: { id: true, name: true, capacity: true, updatedAt: true },
    });
  }

  private assertCoordinatePair(latitude?: number | null, longitude?: number | null) {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'latitude and longitude must be provided together, or both omitted.',
      );
    }
  }
}
