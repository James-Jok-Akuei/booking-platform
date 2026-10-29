import { BadRequestException, Injectable } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { BusinessAccessService } from './business-access.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { recalculateFromPrice } from './from-price';
import { SetLocationHoursDto } from './dto/set-hours.dto';
// One include, shared with the DTO that describes its result (§128.5).
import { LOCATION_INCLUDE } from './dto/business-response.dto';
import { branchIn } from './branch-scope';

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
    await this.assertDistrictInShopsCountry(businessId, dto.districtId);

    return this.prisma.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: { businessId, ...dto },
        include: LOCATION_INCLUDE,
      });
      // A new branch inherits the business's existing catalogue immediately —
      // it opens with a headline price, not with a blank that fills in when
      // someone next edits a service (§44).
      await recalculateFromPrice(tx, businessId);
      return tx.location.findUniqueOrThrow({
        where: { id: location.id },
        include: LOCATION_INCLUDE,
      });
    });
  }

  /**
   * A branch is in its shop's country (§315): its district must be one of
   * that country's. A district from anywhere else would put the branch on
   * the wrong clock and in the wrong country's search.
   */
  private async assertDistrictInShopsCountry(businessId: string, districtId: string | null | undefined) {
    if (!districtId) return;
    const [district, shop] = await Promise.all([
      this.prisma.district.findUnique({ where: { id: districtId }, select: { province: { select: { countryCode: true } } } }),
      this.prisma.businessProfile.findUniqueOrThrow({ where: { id: businessId }, select: { countryCode: true, country: { select: { name: true } } } }),
    ]);
    if (!district || district.province.countryCode !== shop.countryCode) {
      throw new BadRequestException(`Choose a district in ${shop.country.name} from the list.`);
    }
  }

  async findAll(userId: string) {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    const only = branchIn(scope);

    return this.prisma.location.findMany({
      // Only the branches they look after (§277) — every page that picks a
      // branch takes its list from here, so a branch that is not theirs is
      // never offered.
      where: { businessId, ...(only ? { id: only } : {}) },
      orderBy: { createdAt: 'asc' },
      include: LOCATION_INCLUDE,
    });
  }

  async update(userId: string, locationId: string, dto: UpdateLocationDto) {
    // A branch they look after (§277), or 404.
    const { businessId, location: existing } = await this.access.requireMemberBranch(userId, locationId);

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
    await this.assertDistrictInShopsCountry(businessId, dto.districtId);

    return this.prisma.location.update({
      where: { id: locationId },
      data: dto,
      include: LOCATION_INCLUDE,
    });
  }

  /**
   * Closes a branch. ~~Hard delete~~ — superseded in §89.
   *
   * The old comment said "a location has no historical appointment references
   * to preserve yet ... revisit when appointments start pointing at a
   * locationId". They do, and had for a long time. A hard delete cascaded
   * through every appointment ever made there, taking its reviews and chat
   * threads with them, and left ledger entries with `appointmentId` null —
   * money still on the books with nothing to explain it.
   *
   * So a branch is closed, exactly as a service is retired (§73): it stops
   * taking bookings and stops appearing to customers, and everything that
   * happened there stays readable. `Appointment.locationId` is `Restrict` as
   * well, so the destructive path is impossible rather than merely unused.
   */
  async close(userId: string, locationId: string): Promise<ActionMessageDto> {
    // A branch they look after (§277), or 404.
    const { businessId, location: existing } = await this.access.requireMemberBranch(userId, locationId);

    if (!existing.isActive) {
      throw new BadRequestException('That branch is already closed.');
    }

    const upcoming = await this.prisma.appointment.count({
      where: {
        locationId,
        status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.IN_PROGRESS] },
      },
    });
    if (upcoming > 0) {
      // Refusing is kinder than closing silently: these are real people with a
      // time booked. Cancelling them is a decision with refunds attached
      // (§25), and it is not one a "close branch" button should make.
      throw new BadRequestException(
        upcoming === 1
          ? 'This branch has 1 booking still to happen. Cancel or complete it first, then close it.'
          : `This branch has ${upcoming} bookings still to happen. Cancel or complete them first, then close it.`,
      );
    }

    await this.prisma.location.update({
      where: { id: locationId },
      data: { isActive: false },
    });

    return { message: 'Branch closed. Its history is kept and it can be reopened.' };
  }

  /** Puts a closed branch back into service. */
  async reopen(userId: string, locationId: string): Promise<ActionMessageDto> {
    // A branch they look after (§277), or 404.
    const { businessId, location: existing } = await this.access.requireMemberBranch(userId, locationId);

    if (existing.isActive) {
      throw new BadRequestException('That branch is already open.');
    }

    await this.prisma.location.update({
      where: { id: locationId },
      data: { isActive: true },
    });

    return { message: 'Branch reopened.' };
  }

  /**
   * Replaces a location's operating hours wholesale.
   *
   * Set-and-replace rather than incremental edits: the frontend edits a whole
   * week at once, and a delete-then-insert inside a transaction keeps the table
   * free of stale days left behind by a shrinking payload.
   */
  async setHours(userId: string, locationId: string, dto: SetLocationHoursDto) {
    // A branch they look after (§277), or 404.
    const { businessId } = await this.access.requireMemberBranch(userId, locationId);

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
   * Sets how many people this location serves at once — its places (§189). A
   * booking for three takes three of them.
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
  async setCapacity(
    userId: string,
    locationId: string,
    capacity: number,
  ) {
    // A branch they look after (§277), or 404.
    const { businessId } = await this.access.requireMemberBranch(userId, locationId);

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
