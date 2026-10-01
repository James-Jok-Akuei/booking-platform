import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { BusinessAccessService } from './business-access.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { recalculateFromPrice } from './from-price';

/**
 * Services belong to the *business*, not to a location.
 *
 * A salon with three branches offers the same haircut at all three; duplicating
 * the row per location would mean editing the price three times and would make
 * "which of these three haircuts did the customer book?" a meaningless
 * question. Per-location availability is a scheduling concern and belongs to
 * the availability module, not to the service catalogue.
 */
/** Every service response carries where it is offered and for how much (§72). */
const SERVICE_INCLUDE = {
  locations: {
    select: {
      locationId: true,
      priceMinor: true,
      location: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * A service's deposit must be at least the platform's fee.
   *
   * Both percentages apply to the same base — the service price — so this floor
   * is exactly what guarantees the fee never exceeds the deposit it is taken
   * from, i.e. that businessAmountMinor can never be negative. At the floor the
   * business receives nothing from the deposit, which is legal but worth the
   * business understanding.
   *
   * Read LIVE on every write, never cached into a constant: an admin can change
   * the fee at runtime, and a service saved yesterday must be validated against
   * today's rule.
   */
  private async assertDepositCoversPlatformFee(depositPercentage?: number) {
    if (depositPercentage === undefined) return;

    const fee = await this.settings.getPlatformFeePercentage();
    if (new Prisma.Decimal(depositPercentage).lessThan(fee)) {
      throw new BadRequestException(
        `Deposit percentage must be at least ${fee.toFixed(2)}% — the platform fee is ` +
          `${fee.toFixed(2)}% of the service price and is taken out of the deposit. ` +
          'A smaller deposit would leave you owing money on every booking.',
      );
    }
  }

  /**
   * Confirms every branch named belongs to this business.
   *
   * Without it an owner could price their service at a competitor's shop — the
   * ids are opaque uuids, and nothing else in the write path compares them to
   * the caller. Ownership is checked structurally, by counting matches within
   * the business, rather than by trusting the ids (§10.7).
   */
  private async assertOwnsLocations(businessId: string, locationIds: string[]) {
    const unique = [...new Set(locationIds)];
    if (unique.length !== locationIds.length) {
      throw new BadRequestException('A branch is listed twice.');
    }

    const owned = await this.prisma.location.count({
      where: { businessId, id: { in: unique } },
    });
    if (owned !== unique.length) {
      throw new NotFoundException('One of those branches does not belong to you.');
    }
  }

  async create(userId: string, dto: CreateServiceDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.assertDepositCoversPlatformFee(dto.depositPercentage);
    await this.assertOwnsLocations(
      businessId,
      dto.offers.map((offer) => offer.locationId),
    );

    const { offers, ...fields } = dto;

    // The service, its branch offers and every affected location's headline
    // price commit together (§44). A catalogue that has changed while the
    // listing has not is a listing advertising a price nobody can book at.
    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        // The unit of account these prices are denominated in, said explicitly.
        // The column used to default to "USD" in the schema, which silently
        // mislabelled every price in a deployment priced in anything else
        // (§66.3).
        data: {
          businessId,
          currency: INTERNAL_CURRENCY,
          ...fields,
          locations: {
            create: offers.map((offer) => ({
              locationId: offer.locationId,
              priceMinor: offer.priceMinor,
            })),
          },
        },
        include: SERVICE_INCLUDE,
      });
      await recalculateFromPrice(tx, businessId);
      return service;
    });
  }

  /** Returns inactive services too — this is the owner's own catalogue view. */
  async findAll(userId: string) {
    const businessId = await this.access.requireBusinessId(userId);

    return this.prisma.service.findMany({
      where: { businessId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: SERVICE_INCLUDE,
    });
  }

  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);
    await this.assertDepositCoversPlatformFee(dto.depositPercentage);

    // Recomputed unconditionally rather than only when `priceMinor` is in the
    // patch: an update can also flip `isActive` back on, which changes the
    // cheapest price without touching a price field. Checking which fields
    // moved would be a second place to get the rule right.
    const { offers, ...fields } = dto;

    if (offers) {
      await this.assertOwnsLocations(
        businessId,
        offers.map((offer) => offer.locationId),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Offers are REPLACED wholesale when supplied, like the week of opening
      // hours (§12.7): the client sends the branches it wants, and whatever is
      // not in that list stops being offered. Merging instead would make
      // "remove this branch" impossible to express.
      if (offers) {
        await tx.serviceLocation.deleteMany({ where: { serviceId } });
        await tx.serviceLocation.createMany({
          data: offers.map((offer) => ({
            serviceId,
            locationId: offer.locationId,
            priceMinor: offer.priceMinor,
          })),
        });
      }

      const service = await tx.service.update({
        where: { id: serviceId },
        data: fields,
        include: SERVICE_INCLUDE,
      });
      await recalculateFromPrice(tx, businessId);
      return service;
    });
  }

  /**
   * Soft delete — flips isActive to false, never removes the row.
   *
   * Appointments will reference serviceId, and a completed booking has to keep
   * resolving to the service name and price it was made at long after the
   * business stops offering it. A hard delete would either orphan those records
   * or cascade away booking history.
   */
  async deactivate(userId: string, serviceId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);

    const service = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.service.update({
        where: { id: serviceId },
        data: { isActive: false },
      });
      // A retired service must stop setting the headline price immediately.
      await recalculateFromPrice(tx, businessId);
      return updated;
    });

    return {
      message:
        'Service deactivated. It is hidden from customers but kept so past appointments still resolve.',
      service,
    };
  }

  private async requireOwned(businessId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: { id: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }
}
