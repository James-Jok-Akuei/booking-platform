import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';

/**
 * The single settings row's primary key.
 *
 * A fixed sentinel rather than a generated uuid: there is exactly one row, and
 * pinning the id means every read and write targets it by primary key with no
 * "find the first row" ambiguity and no way to end up with two.
 */
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
  }> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: {
        providerCurrency: true,
        exchangeRateUsdToProviderCurrency: true,
        exchangeRateUpdatedAt: true,
      },
    });

    if (!setting) {
      this.logger.error(
        `Platform settings row "${PLATFORM_SETTING_ID}" is missing; no exchange rate available.`,
      );
      return { providerCurrency: 'EUR', rate: null, updatedAt: null };
    }

    return {
      providerCurrency: setting.providerCurrency,
      rate: setting.exchangeRateUsdToProviderCurrency,
      updatedAt: setting.exchangeRateUpdatedAt,
    };
  }

  /** Admin-facing view, including how stale the rate has become. */
  async getExchangeRateSettings() {
    const { providerCurrency, rate, updatedAt } = await this.getExchangeRate();

    return {
      internalCurrency: INTERNAL_CURRENCY,
      providerCurrency,
      exchangeRateUsdToProviderCurrency: rate ? rate.toFixed(8) : null,
      exchangeRateUpdatedAt: updatedAt,
      // Surfaced explicitly so a stale manual rate is visible without anyone
      // having to do date arithmetic in their head.
      ageInHours: updatedAt
        ? Math.floor((Date.now() - updatedAt.getTime()) / 3_600_000)
        : null,
      configured: rate !== null,
      note:
        rate === null
          ? 'No exchange rate is set. Deposit payments will fail until one is configured.'
          : `1 ${INTERNAL_CURRENCY} = ${rate.toFixed(8)} ${providerCurrency}. Set manually; not a live feed.`,
    };
  }

  /**
   * `providerCurrency` is optional: omitting it keeps whatever is stored, so a
   * rate can be corrected without restating the currency. Defaulting it to a
   * literal here would silently overwrite a configured currency on every rate
   * tweak.
   */
  async setExchangeRate(rate: number, providerCurrency?: string) {
    const updated = await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      update: {
        // undefined tells Prisma to leave the column alone.
        providerCurrency: providerCurrency ?? undefined,
        exchangeRateUsdToProviderCurrency: rate,
        exchangeRateUpdatedAt: new Date(),
      },
      create: {
        id: PLATFORM_SETTING_ID,
        providerCurrency: providerCurrency ?? 'EUR',
        exchangeRateUsdToProviderCurrency: rate,
        exchangeRateUpdatedAt: new Date(),
      },
    });

    this.logger.log(
      `Exchange rate set: 1 ${INTERNAL_CURRENCY} = ${updated.exchangeRateUsdToProviderCurrency?.toFixed(8)} ${updated.providerCurrency}. ` +
        'Applies to future charges only; appointments already paid keep the rate they were charged at.',
    );

    return this.getExchangeRateSettings();
  }

  /** Full settings record for the admin endpoint. */
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
