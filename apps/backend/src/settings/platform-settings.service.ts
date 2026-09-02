import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';

/**
 * The single settings row's primary key.
 *
 * A fixed sentinel rather than a generated uuid: there is exactly one row, and
 * pinning the id means every read and write targets it by primary key with no
 * "find the first row" ambiguity and no way to end up with two.
 */
/** How old a manually-set exchange rate may be before it is reported stale. */
export const DEFAULT_STALENESS_HOURS = 24;

/**
 * Days between an appointment resolving and its money becoming payable.
 *
 * The fallback when the settings row is missing, and the column's default. Two
 * days: long enough for a dispute to arrive, short enough that a business is
 * not financing the platform.
 */
export const DEFAULT_PAYOUT_HOLD_DAYS = 2;

/** The range an admin may set the hold to. */
export const MIN_PAYOUT_HOLD_DAYS = 0;
export const MAX_PAYOUT_HOLD_DAYS = 30;

export const PLATFORM_SETTING_ID = 'platform';

/** Fallback if the row is somehow missing — matches the column default. */
const DEFAULT_FEE_PERCENTAGE = new Prisma.Decimal('10.00');

/**
 * How long a read of the fee is reused before hitting the database again.
 *
 * Short on purpose. This value is read on every booking, so caching it avoids a
 * query per booking; but an admin who changes the fee must see the change take
 * effect without a restart, and a 30-second worst-case staleness is a fair
 * trade. Any write through this service clears the cache immediately, so the
 * window only ever applies to changes made outside the API (a direct SQL edit,
 * or another instance).
 */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cached: { value: Prisma.Decimal; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The live platform fee percentage.
   *
   * Returned as a Prisma.Decimal, never a JS number — this value multiplies
   * money, and going through binary floating point is exactly the mistake the
   * integer-cents rule exists to prevent.
   */
  async getPlatformFeePercentage(): Promise<Prisma.Decimal> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }

    const setting = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: { platformFeePercentage: true },
    });

    // The row is created by migration and by ensureRow() below, so a miss means
    // someone deleted it. Fall back to the documented default rather than
    // failing every booking on the platform.
    if (!setting) {
      this.logger.error(
        `Platform settings row "${PLATFORM_SETTING_ID}" is missing. Falling back to ${DEFAULT_FEE_PERCENTAGE}%.`,
      );
      return DEFAULT_FEE_PERCENTAGE;
    }

    this.cached = {
      value: setting.platformFeePercentage,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return setting.platformFeePercentage;
  }

  /**
   * The provider currency and the manual USD conversion rate.
   *
   * NOT cached, unlike the platform fee. The fee is read on every booking, so
   * caching it pays for itself; the rate is read only when a payment is
   * actually initiated, which is rare enough that a stale rate would be a
   * needless risk for no measurable saving. An admin correcting a wrong rate
   * takes effect on the very next charge.
   */
  async getExchangeRate(): Promise<{
    providerCurrency: string;
    rate: Prisma.Decimal | null;
    updatedAt: Date | null;
    updatedById: string | null;
    stalenessHours: number;
  }> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: {
        providerCurrency: true,
        exchangeRateUsdToProviderCurrency: true,
        exchangeRateUpdatedAt: true,
        exchangeRateUpdatedById: true,
        exchangeRateStalenessHours: true,
      },
    });

    if (!setting) {
      this.logger.error(
        `Platform settings row "${PLATFORM_SETTING_ID}" is missing; no exchange rate available.`,
      );
      return {
        providerCurrency: 'EUR',
        rate: null,
        updatedAt: null,
        updatedById: null,
        stalenessHours: DEFAULT_STALENESS_HOURS,
      };
    }

    return {
      providerCurrency: setting.providerCurrency,
      rate: setting.exchangeRateUsdToProviderCurrency,
      updatedAt: setting.exchangeRateUpdatedAt,
      updatedById: setting.exchangeRateUpdatedById,
      stalenessHours: setting.exchangeRateStalenessHours,
    };
  }

  /**
   * Whether the manual rate has gone past its configured age, and by how much.
   *
   * A rate that has NEVER been set is not "stale" — it is missing, which is a
   * different and already-fatal condition at payment time. Reporting it as
   * stale would file an unconfigured platform under the same heading as a
   * slightly old number.
   */
  async getExchangeRateStaleness() {
    const { rate, updatedAt, stalenessHours } = await this.getExchangeRate();

    if (rate === null || updatedAt === null) {
      return { configured: false, stale: false, ageInHours: null, stalenessHours };
    }

    const ageInHours = Math.floor((Date.now() - updatedAt.getTime()) / 3_600_000);

    return {
      configured: true,
      stale: ageInHours >= stalenessHours,
      ageInHours,
      stalenessHours,
    };
  }

  /** Admin-facing view, including how stale the rate has become. */
  async getExchangeRateSettings() {
    const { providerCurrency, rate, updatedAt, updatedById, stalenessHours } =
      await this.getExchangeRate();
    const staleness = await this.getExchangeRateStaleness();

    const updatedBy = updatedById
      ? await this.prisma.user.findUnique({
          where: { id: updatedById },
          select: { id: true, email: true },
        })
      : null;

    return {
      internalCurrency: INTERNAL_CURRENCY,
      providerCurrency,
      exchangeRateUsdToProviderCurrency: rate ? rate.toFixed(8) : null,
      exchangeRateUpdatedAt: updatedAt,
      // Surfaced explicitly so a stale manual rate is visible without anyone
      // having to do date arithmetic in their head.
      ageInHours: staleness.ageInHours,
      exchangeRateUpdatedBy: updatedBy,
      stalenessThresholdHours: stalenessHours,
      stale: staleness.stale,
      // A field, not just a flag: whoever reads this response should not have
      // to know what `stale: true` implies. Null when there is nothing wrong,
      // so the presence of the key is itself the signal.
      warning: staleness.stale
        ? `This exchange rate was last set ${staleness.ageInHours} hours ago, past the ` +
          `${stalenessHours}-hour threshold. Deposits are still being charged at it. ` +
          'Check it against the market rate.'
        : null,
      configured: rate !== null,
      note:
        rate === null
          ? 'No exchange rate is set. Deposit payments will fail until one is configured.'
          : `1 ${INTERNAL_CURRENCY} = ${rate.toFixed(8)} ${providerCurrency}. Set manually; not a live feed.`,
    };
  }

  /**
   * Changes how old the rate may get before it is reported stale.
   *
   * Zero is allowed and means "always report it stale" — a legitimate setting
   * for a currency moving fast enough that any stored rate is suspect.
   */
  async setExchangeRateStalenessHours(hours: number) {
    await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: { exchangeRateStalenessHours: hours },
      create: { id: PLATFORM_SETTING_ID, exchangeRateStalenessHours: hours },
    });

    this.logger.log(`Exchange-rate staleness threshold set to ${hours} hours.`);

    return this.getExchangeRateSettings();
  }

  /**
   * Records that admins have been told the rate is stale, so the reminder fires
   * once a day rather than on every sweep.
   */
  async markStaleNotified(at = new Date()) {
    await this.prisma.platformSetting.update({
      where: { id: PLATFORM_SETTING_ID },
      data: { exchangeRateStaleNotifiedAt: at },
    });
  }

  async getStaleNotifiedAt(): Promise<Date | null> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: { exchangeRateStaleNotifiedAt: true },
    });
    return setting?.exchangeRateStaleNotifiedAt ?? null;
  }

  /**
   * `providerCurrency` is optional: omitting it keeps whatever is stored, so a
   * rate can be corrected without restating the currency. Defaulting it to a
   * literal here would silently overwrite a configured currency on every rate
   * tweak.
   */
  async setExchangeRate(
    rate: number,
    providerCurrency?: string,
    updatedById?: string,
  ) {
    const updated = await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: {
        // undefined tells Prisma to leave the column alone.
        providerCurrency: providerCurrency ?? undefined,
        exchangeRateUsdToProviderCurrency: rate,
        exchangeRateUpdatedAt: new Date(),
        exchangeRateUpdatedById: updatedById ?? null,
        // A fresh rate is not stale, so the daily reminder starts over. Left
        // set, the next staleness would be judged against an old notification
        // and the reminder would be a day late.
        exchangeRateStaleNotifiedAt: null,
      },
      create: {
        id: PLATFORM_SETTING_ID,
        providerCurrency: providerCurrency ?? 'EUR',
        exchangeRateUsdToProviderCurrency: rate,
        exchangeRateUpdatedAt: new Date(),
        exchangeRateUpdatedById: updatedById ?? null,
      },
    });

    this.logger.log(
      `Exchange rate set: 1 ${INTERNAL_CURRENCY} = ${updated.exchangeRateUsdToProviderCurrency?.toFixed(8)} ${updated.providerCurrency}. ` +
        'Applies to future charges only; appointments already paid keep the rate they were charged at.',
    );

    return this.getExchangeRateSettings();
  }

  /** Full settings record for the admin endpoint. */
  /**
   * The payout hold currently in force, in days.
   *
   * Read at RESOLUTION time and then recorded on the appointment (§38.2). It is
   * never read again for that appointment: an `availableAt` already set is a
   * date a business has been shown, and moving it because an admin changed a
   * setting would be changing a promise after the fact.
   */
  async getPayoutHoldDays(): Promise<number> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: { payoutHoldDays: true },
    });

    // Same reasoning as the platform fee: a missing row means someone deleted
    // it, and falling back to the documented default beats stranding every
    // resolution on the platform.
    return setting?.payoutHoldDays ?? DEFAULT_PAYOUT_HOLD_DAYS;
  }

  /**
   * Admin-facing read.
   *
   * Takes the actor and checks the role here as well as in the guard, per
   * §27.1. The sibling fee and exchange-rate methods predate that rule and are
   * still guard-only; widening them is a refactor of its own, not something to
   * smuggle into a commit about the payout hold (§38.4).
   */
  async getPayoutHoldSettings(actor: { role: UserRole | string }) {
    this.assertAdmin(actor);
    const days = await this.getPayoutHoldDays();

    return {
      payoutHoldDays: days,
      note:
        `Funds become payable ${days} day(s) after an appointment resolves. ` +
        'Changing this affects appointments resolved afterwards; dates already ' +
        'set are never rewritten.',
    };
  }

  async setPayoutHoldDays(days: number, actor: { role: UserRole | string }) {
    this.assertAdmin(actor);

    await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: { payoutHoldDays: days },
      create: { id: PLATFORM_SETTING_ID, payoutHoldDays: days },
    });

    this.logger.log(
      `Payout hold set to ${days} day(s). Applies to appointments resolved from ` +
        'now on; entries that already have an availableAt keep it.',
    );

    return this.getPayoutHoldSettings(actor);
  }

  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }

  async getSettings() {
    const setting = await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: {},
      create: { id: PLATFORM_SETTING_ID },
    });

    return {
      platformFeePercentage: setting.platformFeePercentage.toFixed(2),
      updatedAt: setting.updatedAt,
    };
  }

  async setPlatformFeePercentage(percentage: number) {
    const updated = await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: { platformFeePercentage: percentage },
      create: { id: PLATFORM_SETTING_ID, platformFeePercentage: percentage },
    });

    // Invalidate immediately so the next booking uses the new fee rather than
    // waiting out the TTL.
    this.cached = null;

    this.logger.log(
      `Platform fee percentage set to ${updated.platformFeePercentage.toFixed(2)}%. ` +
        'Existing appointments keep the amounts snapshotted at their booking time.',
    );

    return {
      platformFeePercentage: updated.platformFeePercentage.toFixed(2),
      updatedAt: updated.updatedAt,
    };
  }
}
