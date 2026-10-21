import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

/**
 * The sentences a shop writes about a service (§180), tidied: trimmed, and a
 * blank stored as NOTHING rather than as "". The DTO does the same on the way
 * in; this is for every caller that is not the HTTP layer, so no client ever
 * has to tell an empty description from a missing one.
 */
const tidyWords = <
  T extends {
    title?: string | null;
    description?: string | null;
    instructions?: string | null;
    notePrompt?: string | null;
  },
>(
  fields: T,
): T => ({
  ...fields,
  ...(fields.title !== undefined ? { title: fields.title?.trim() || null } : {}),
  ...(fields.description !== undefined
    ? { description: fields.description?.trim() || null }
    : {}),
  ...(fields.instructions !== undefined
    ? { instructions: fields.instructions?.trim() || null }
    : {}),
  ...(fields.notePrompt !== undefined ? { notePrompt: fields.notePrompt?.trim() || null } : {}),
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
import { platformToday, ymd } from './discount';
import { branchIn } from './branch-scope';
import { assertFitsInADay, planChoiceGroups } from './service-choices';
import { loadChoiceGroups, saveChoiceGroups } from './choice-groups';
import { notePromptIn, priceAtShopFor, suggestionsFor, suggestionsIn } from './choice-suggestions';
import { KINDS_SELECT } from './kinds';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';

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
    private readonly config: ConfigService,
  ) {}

  /**
   * The sale columns to write (§186), from what was sent and what is stored.
   *
   * `discountPercent: null` ends a sale, and takes its last day with it. A last
   * day needs a percentage, and a NEW last day may not be in the past — the
   * stored one may be, and is accepted when sent back unchanged, so editing
   * the name of a service whose sale ended last week is not refused.
   */
  private discountColumns(
    sent: { discountPercent?: number | null; discountEndsOn?: string | null },
    stored?: { discountPercent: number | null; discountEndsOn: Date | null },
  ): { discountPercent?: number | null; discountEndsOn?: Date | null } {
    if (sent.discountPercent === undefined && sent.discountEndsOn === undefined) return {};
    if (sent.discountPercent === null) return { discountPercent: null, discountEndsOn: null };

    const percent = sent.discountPercent ?? stored?.discountPercent ?? null;
    const storedEnd = stored?.discountEndsOn ? ymd(stored.discountEndsOn) : null;
    const endsOn = sent.discountEndsOn !== undefined ? sent.discountEndsOn : storedEnd;

    if (endsOn !== null && percent === null) {
      throw new BadRequestException('A sale needs a percentage off as well as a last day.');
    }
    if (endsOn !== null) {
      const day = new Date(`${endsOn}T00:00:00Z`);
      if (Number.isNaN(day.getTime()) || ymd(day) !== endsOn) {
        throw new BadRequestException('discountEndsOn must be a real date, like 2026-10-31.');
      }
      const timeZone = this.config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
      if (endsOn !== storedEnd && day.getTime() < platformToday(timeZone).getTime()) {
        throw new BadRequestException('The last day of a sale cannot be in the past.');
      }
    }
    return {
      discountPercent: percent,
      discountEndsOn: endsOn === null ? null : new Date(`${endsOn}T00:00:00Z`),
    };
  }

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

    const { offers, discountPercent, discountEndsOn, choiceGroups, ...words } = dto;
    const fields = { ...tidyWords(words), ...this.discountColumns({ discountPercent, discountEndsOn }) };

    // The questions a customer answers while booking (§300), checked before
    // anything is written.
    const groups = planChoiceGroups(choiceGroups ?? [], []);
    assertFitsInADay(dto.durationMinutes, groups);

    // The service, its branch offers and every affected location's headline
    // price commit together (§44). A catalogue that has changed while the
    // listing has not is a listing advertising a price nobody can book at.
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
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
        select: { id: true },
      });
      await saveChoiceGroups(tx, created.id, groups, []);
      // After the questions: a required one can raise the cheapest price (§300.3).
      await recalculateFromPrice(tx, businessId);
      return tx.service.findUniqueOrThrow({ where: { id: created.id }, include: SERVICE_INCLUDE });
    });
  }

  /**
   * Returns inactive services too — this is the owner's own catalogue view.
   *
   * Someone who looks after some branches only (§277) sees the services priced
   * at those branches, and only those branches' prices: the rest of the
   * catalogue belongs to branches that are not theirs.
   */
  async findAll(userId: string) {
    const { businessId, scope } = await this.access.requireBusinessScope(userId);
    const only = branchIn(scope);

    return this.prisma.service.findMany({
      where: { businessId, ...(only ? { locations: { some: { locationId: only } } } : {}) },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: only
        ? { ...SERVICE_INCLUDE, locations: { ...SERVICE_INCLUDE.locations, where: { locationId: only } } }
        : SERVICE_INCLUDE,
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
    const { offers, discountPercent, discountEndsOn, choiceGroups, ...patch } = dto;
    const sale =
      discountPercent === undefined && discountEndsOn === undefined
        ? {}
        : this.discountColumns(
            { discountPercent, discountEndsOn },
            await this.prisma.service.findUniqueOrThrow({
              where: { id: serviceId },
              select: { discountPercent: true, discountEndsOn: true },
            }),
          );
    const fields = { ...tidyWords(patch), ...sale };

    if (offers) {
      await this.assertOwnsLocations(
        businessId,
        offers.map((offer) => offer.locationId),
      );
    }

    // The questions (§300): sent, they replace what is there; a new length
    // is checked against the ones that stay.
    const existing =
      choiceGroups !== undefined || dto.durationMinutes !== undefined
        ? await loadChoiceGroups(this.prisma, serviceId)
        : [];
    const groups = choiceGroups !== undefined ? planChoiceGroups(choiceGroups, existing) : null;
    if (groups || dto.durationMinutes !== undefined) {
      const length =
        dto.durationMinutes ??
        (await this.prisma.service.findUniqueOrThrow({ where: { id: serviceId }, select: { durationMinutes: true } }))
          .durationMinutes;
      assertFitsInADay(length, groups ?? existing);
    }

    return this.prisma.$transaction(async (tx) => {
      if (groups) await saveChoiceGroups(tx, serviceId, groups, existing);

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
    // Pausing a service at a branch is that branch's call (§277).
    const { businessId } = await this.access.requireMemberBranch(userId, locationId);
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

  /**
   * Ready-made questions for the shop's kinds (§300.2), its main kind first,
   * and the note box's words — for the service form to offer. Nothing is
   * added to any service until the shop saves it.
   */
  async choiceSuggestions(userId: string, locale: Locale = DEFAULT_LOCALE) {
    const businessId = await this.access.requireBusinessId(userId);
    const { kinds } = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: { kinds: KINDS_SELECT },
    });
    return {
      sections: suggestionsIn(locale, suggestionsFor(kinds)),
      notePrompt: notePromptIn(locale, kinds),
      priceAtShop: priceAtShopFor(kinds),
    };
  }

  /** One ownership check, shared with service photos (§132.1). */
  private async requireOwned(businessId: string, serviceId: string) {
    return this.access.requireOwnedService(businessId, serviceId);
  }
}
