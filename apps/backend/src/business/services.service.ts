import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuantityMode } from '@prisma/client';
import { normaliseQuantityRule } from '../appointments/quantity';

/**
 * The sentences a shop writes about a service (§180), tidied: trimmed, and a
 * blank stored as NOTHING rather than as "". The DTO does the same on the way
 * in; this is for every caller that is not the HTTP layer, so no client ever
 * has to tell an empty description from a missing one.
 */
const tidyWords = <T extends { description?: string | null; instructions?: string | null }>(
  fields: T,
): T => ({
  ...fields,
  ...(fields.description !== undefined
    ? { description: fields.description?.trim() || null }
    : {}),
  ...(fields.instructions !== undefined
    ? { instructions: fields.instructions?.trim() || null }
    : {}),
});
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { LegalDocumentKind } from '@prisma/client';
import { LegalService } from '../legal/legal.service';
// One include, shared with the DTO describing its result (§128.5).
import { SERVICE_INCLUDE } from './dto/business-response.dto';
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


@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly settings: PlatformSettingsService,
    private readonly legal: LegalService,
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

    // Putting a service in front of customers is the business holding itself to
    // the Seller Agreement (§126), so this is the one action worth stopping
    // outright until it has been read. Only on CREATE: blocking an edit would
    // trap a shop with a wrong price it cannot correct.
    await this.legal.requireAccepted(userId, LegalDocumentKind.SELLER_AGREEMENT);

    await this.assertDepositCoversPlatformFee(dto.depositPercentage);
    await this.assertOwnsLocations(
      businessId,
      dto.offers.map((offer) => offer.locationId),
    );

    const { offers, quantityMode, maxQuantity, ...words } = dto;
    const fields = tidyWords(words);
    const quantityRule = normaliseQuantityRule(
      quantityMode ?? QuantityMode.SINGLE,
      maxQuantity,
    );

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
          ...quantityRule,
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
    const { offers, quantityMode, maxQuantity, ...patch } = dto;
    const rest = tidyWords(patch);

    // The rule is two columns that must agree (§136), so a patch naming either
    // is completed from the stored row before it is checked — sending only a
    // new maximum must not need the mode repeated, and must not slip past it.
    let fields: typeof rest & Partial<ReturnType<typeof normaliseQuantityRule>> = rest;
    if (quantityMode !== undefined || maxQuantity !== undefined) {
      const current = await this.prisma.service.findUniqueOrThrow({
        where: { id: serviceId },
        select: { quantityMode: true, maxQuantity: true },
      });
      fields = {
        ...rest,
        ...normaliseQuantityRule(
          quantityMode ?? current.quantityMode,
          maxQuantity ?? current.maxQuantity,
        ),
      };
    }

    if (offers) {
      await this.assertOwnsLocations(
        businessId,
        offers.map((offer) => offer.locationId),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Listed branches are on sale at the price given; any branch left out is
      // PAUSED, never deleted (§74). Deleting would discard that branch's price
      // the moment someone edited the service without thinking about it — and
      // the price is the thing worth keeping through a pause.
      if (offers) {
        const listed = new Set(offers.map((offer) => offer.locationId));

        for (const offer of offers) {
          await tx.serviceLocation.upsert({
            where: {
              serviceId_locationId: { serviceId, locationId: offer.locationId },
            },
            create: {
              serviceId,
              locationId: offer.locationId,
              priceMinor: offer.priceMinor,
              isOffered: true,
            },
            update: { priceMinor: offer.priceMinor, isOffered: true },
          });
        }

        await tx.serviceLocation.updateMany({
          where: { serviceId, locationId: { notIn: [...listed] } },
          data: { isOffered: false },
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
   * Turns a service on or off at ONE branch (§74).
   *
   * A toggle, not a deletion. The offer row is kept either way, so the price
   * survives a pause — a barber on leave for a month resumes with one click
   * rather than retyping what the cut costs.
   *
   * §73 deleted the row and argued that a second off-switch duplicated
   * `Service.isActive`. It does not: that one means "we have stopped doing this
   * at all, everywhere", and this means "not here, for now". Different facts,
   * and conflating them cost the price.
   *
   * Switching off the last branch is allowed and leaves the service paused
   * everywhere — recoverable, visible, and what the seller asked for. §73
   * auto-retired here because deletion made the state awkward to undo; a toggle
   * removes the reason.
   */
  async setOfferedAtLocation(
    userId: string,
    serviceId: string,
    locationId: string,
    isOffered: boolean,
  ) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);

    const offer = await this.prisma.serviceLocation.findUnique({
      where: { serviceId_locationId: { serviceId, locationId } },
    });
    if (!offer) {
      throw new NotFoundException(
        'That service has no price at that branch. Add one before turning it on.',
      );
    }

    const service = await this.prisma.$transaction(async (tx) => {
      await tx.serviceLocation.update({
        where: { serviceId_locationId: { serviceId, locationId } },
        data: { isOffered },
      });

      // The branch must stop — or start — advertising it immediately (§44).
      await recalculateFromPrice(tx, businessId);

      return tx.service.findUniqueOrThrow({
        where: { id: serviceId },
        include: SERVICE_INCLUDE,
      });
    });

    const stillOn = service.locations.filter((o) => o.isOffered).length;

    return {
      message: isOffered
        ? 'Back on sale at that branch.'
        : stillOn === 0
          ? 'Paused at that branch, and it was the last one — nobody can book it ' +
            'until you turn it on somewhere. The prices are kept.'
          : 'Paused at that branch. Unchanged everywhere else, and the price is kept.',
      isOffered,
      offeredAtCount: stillOn,
      service,
    };
  }

  /**
   * Turns a service on or off at EVERY branch at once (§76).
   *
   * "Everywhere" acts on the branches, not on `Service.isActive`. Flipping the
   * service flag instead left the two disagreeing: a service could be retired
   * while every branch still said it was on sale, and the screen then offered
   * to "stop offering here" for something already sold nowhere.
   *
   * One transaction and one recalculation, rather than the client looping — a
   * half-applied bulk change is exactly the state this exists to avoid.
   */
  async setOfferedEverywhere(userId: string, serviceId: string, isOffered: boolean) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);

    const service = await this.prisma.$transaction(async (tx) => {
      await tx.serviceLocation.updateMany({ where: { serviceId }, data: { isOffered } });
      await recalculateFromPrice(tx, businessId);
      return tx.service.findUniqueOrThrow({
        where: { id: serviceId },
        include: SERVICE_INCLUDE,
      });
    });

    return {
      message: isOffered
        ? 'Back on sale at every branch, at the prices you had.'
        : 'Stopped at every branch. The prices are kept, so you can put it back.',
      isOffered,
      offeredAtCount: service.locations.filter((o) => o.isOffered).length,
      service,
    };
  }

  /**
   * Retires a service EVERYWHERE — a soft delete that flips isActive, never
   * removing the row.
   *
   * The whole-business counterpart to `removeFromLocation`: this is "we have
   * stopped doing this at all", not "not at that shop".
   *
   * Appointments reference serviceId, and a completed booking has to keep
   * resolving to the service it was made for long after the business stops
   * offering it. A hard delete would either orphan those records or cascade
   * away booking history.
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

  /** One ownership check, shared with service photos (§132.1). */
  private async requireOwned(businessId: string, serviceId: string) {
    return this.access.requireOwnedService(businessId, serviceId);
  }
}
