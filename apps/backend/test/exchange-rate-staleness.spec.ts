import { INTERNAL_CURRENCY } from '../src/payments/currency';
import { ForbiddenException } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import {
  PLATFORM_SETTING_ID,
  PlatformSettingsService,
} from '../src/settings/platform-settings.service';
import { ExchangeRateScheduler } from '../src/settings/exchange-rate.scheduler';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createAdmin } from './setup/factories';
import { MONEY_ADMINS } from '../src/users/money-access';

const HOUR = 3_600_000;

/**
 * The exchange rate is maintained by hand and has no feed behind it (§18), so
 * the only thing standing between a correct charge and a wrong one is somebody
 * remembering. These tests are about making forgetting VISIBLE — never about
 * blocking anything (§37.3).
 */
describe('Exchange-rate staleness (§37)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settings: PlatformSettingsService;
  let scheduler: ExchangeRateScheduler;
  let notifications: { notify: { mock: { calls: any[][] } } };

  let admin: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      PlatformSettingsService,
      ExchangeRateScheduler,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    settings = moduleRef.get(PlatformSettingsService);
    scheduler = moduleRef.get(ExchangeRateScheduler);
    notifications = moduleRef.get(NotificationsService) as never;
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    // Setting the rate is money work (§317): this admin is trusted with it.
    await prisma.user.update({ where: { id: admin.userId }, data: { moneyAccess: true } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.platformSetting.deleteMany({});
    notifications.notify.mock.calls.length = 0;
  });

  /** Sets the rate, then backdates it to a chosen age. */
  const rateAgedHours = async (hours: number, thresholdHours?: number) => {
    await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });
    if (thresholdHours !== undefined) {
      await settings.setExchangeRateStalenessHours(thresholdHours, { role: 'ADMIN' });
    }
    await prisma.platformSetting.update({
      where: { id: PLATFORM_SETTING_ID },
      data: { exchangeRateUpdatedAt: new Date(Date.now() - hours * HOUR) },
    });
  };

  describe('setting the rate records who and when', () => {
    it('records the acting admin', async () => {
      await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });
      expect(view.exchangeRateUpdatedBy).toEqual({
        id: admin.userId,
        email: admin.email,
      });
      expect(view.exchangeRateUpdatedAt).not.toBeNull();
    });

    it('moves the timestamp forward on every change', async () => {
      await rateAgedHours(48);
      const before = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      await settings.setExchangeRate(700, undefined, { userId: admin.userId, role: 'ADMIN' });

      const after = await settings.getExchangeRateSettings({ role: 'ADMIN' });
      expect(before.ageInHours).toBe(48);
      expect(after.ageInHours).toBe(0);
      expect(after.exchangeRateUsdToProviderCurrency).toBe('700.00000000');
      // The currency was not restated and must not have been overwritten.
      expect(after.providerCurrency).toBe('SSP');
    });
  });

  describe('reporting', () => {
    it('defaults the threshold to 24 hours', async () => {
      await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      expect(view.stalenessThresholdHours).toBe(24);
    });

    it('reports a rate older than the threshold as stale', async () => {
      await rateAgedHours(30);

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      expect(view.stale).toBe(true);
      expect(view.ageInHours).toBe(30);
      expect(view.warning).toMatch(/30 hours ago/);
      // The warning says the platform is still charging at it, because it is.
      expect(view.warning).toMatch(/still being charged/i);
    });

    it('reports a rate inside the threshold as not stale', async () => {
      await rateAgedHours(3);

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      expect(view.stale).toBe(false);
      // Null rather than an "everything is fine" string: the presence of the
      // key is the signal.
      expect(view.warning).toBeNull();
    });

    it('treats the threshold as inclusive at the boundary', async () => {
      await rateAgedHours(24);

      expect((await settings.getExchangeRateSettings({ role: 'ADMIN' })).stale).toBe(true);
    });

    it('honours a changed threshold', async () => {
      await rateAgedHours(10, 48);

      const relaxed = await settings.getExchangeRateSettings({ role: 'ADMIN' });
      await settings.setExchangeRateStalenessHours(6, { role: 'ADMIN' });
      const tightened = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      expect(relaxed.stale).toBe(false);
      expect(tightened.stale).toBe(true);
    });

    it('does not call an unset rate stale - that is a different problem', async () => {
      await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });

      // Missing, not old. Payment initiation already refuses outright on this
      // (§18), and filing it under "stale" would hide that.
      expect(view.configured).toBe(false);
      expect(view.stale).toBe(false);
      expect(view.warning).toBeNull();
    });
  });

  describe('the reminder is loud, not fatal', () => {
    it('notifies every admin with money access once when the rate goes stale, and nobody else (§317)', async () => {
      const secondAdmin = await createAdmin(prisma);
      await prisma.user.update({ where: { id: secondAdmin.userId }, data: { moneyAccess: true } });
      await createAdmin(prisma); // a helper without money access: not told
      await rateAgedHours(30);

      const result = await scheduler.checkStaleness();

      expect(result.stale).toBe(true);
      expect(result.notified).toBe(2);
      const recipients = notifications.notify.mock.calls.map((c) => c[0].recipientId);
      expect(recipients.sort()).toEqual([admin.userId, secondAdmin.userId].sort());
      expect(notifications.notify.mock.calls[0][0].type).toBe(
        NotificationType.EXCHANGE_RATE_STALE,
      );
    });

    it('does not notify again within the day', async () => {
      await rateAgedHours(30);
      await scheduler.checkStaleness();
      notifications.notify.mock.calls.length = 0;

      const again = await scheduler.checkStaleness();

      // A warning that arrives every hour is one people filter.
      expect(again.notified).toBe(0);
      expect(notifications.notify.mock.calls).toHaveLength(0);
    });

    it('notifies again once a day has passed and it is still stale', async () => {
      await rateAgedHours(30);
      await scheduler.checkStaleness();
      await prisma.platformSetting.update({
        where: { id: PLATFORM_SETTING_ID },
        data: { exchangeRateStaleNotifiedAt: new Date(Date.now() - 25 * HOUR) },
      });
      notifications.notify.mock.calls.length = 0;

      const again = await scheduler.checkStaleness();

      // Every admin with money access, however many exist by now — the point
      // is that it fired again, not how many accounts are in the database.
      const adminCount = await prisma.user.count({ where: MONEY_ADMINS });
      expect(again.notified).toBe(adminCount);
      expect(adminCount).toBeGreaterThan(0);
    });

    it('says nothing while the rate is fresh', async () => {
      await rateAgedHours(2);

      const result = await scheduler.checkStaleness();

      expect(result.stale).toBe(false);
      expect(notifications.notify.mock.calls).toHaveLength(0);
    });

    it('starts the reminder clock over when the rate is updated', async () => {
      await rateAgedHours(30);
      await scheduler.checkStaleness();

      await settings.setExchangeRate(700, undefined, { userId: admin.userId, role: 'ADMIN' });

      const setting = await prisma.platformSetting.findUniqueOrThrow({
        where: { id: PLATFORM_SETTING_ID },
      });
      // Left set, the next stale spell would be judged against an old
      // notification and its reminder would arrive a day late.
      expect(setting.exchangeRateStaleNotifiedAt).toBeNull();
    });

    it('still serves the rate while it is stale - nothing is blocked', async () => {
      await rateAgedHours(500);

      const { rate } = await settings.getExchangeRate();

      // The whole design decision, asserted: a stale rate is still a rate, and
      // bookings and payments carry on using it.
      expect(rate).not.toBeNull();
      expect(Number(rate)).toBe(650);
    });
  });

  describe('the threshold is validated', () => {
    it('accepts zero - always warn', async () => {
      await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });

      const view = await settings.setExchangeRateStalenessHours(0, { role: 'ADMIN' });

      expect(view.stalenessThresholdHours).toBe(0);
      expect(view.stale).toBe(true);
    });

    it('accepts the maximum', async () => {
      await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });

      const view = await settings.setExchangeRateStalenessHours(720, { role: 'ADMIN' });

      expect(view.stalenessThresholdHours).toBe(720);
    });
  });

  describe('every settings method asserts ADMIN in the service (§41)', () => {
    const NON_ADMINS = ['CUSTOMER', 'BUSINESS'];

    it.each(NON_ADMINS)('refuses a %s reading the platform fee', async (role) => {
      await expect(settings.getSettings({ role })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it.each(NON_ADMINS)('refuses a %s changing the platform fee', async (role) => {
      await expect(
        settings.setPlatformFeePercentage(30, { role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(NON_ADMINS)('refuses a %s reading the exchange rate', async (role) => {
      await expect(
        settings.getExchangeRateSettings({ role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(NON_ADMINS)('refuses a %s setting the exchange rate', async (role) => {
      await expect(
        settings.setExchangeRate(900, 'SSP', { userId: admin.userId, role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(NON_ADMINS)('refuses a %s changing the staleness threshold', async (role) => {
      await expect(
        settings.setExchangeRateStalenessHours(1, { role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('writes nothing when it refuses', async () => {
      await settings.setExchangeRate(650, 'SSP', {
        userId: admin.userId,
        role: 'ADMIN',
      });

      await expect(
        settings.setExchangeRate(999, 'SSP', { userId: admin.userId, role: 'CUSTOMER' }),
      ).rejects.toThrow();

      const view = await settings.getExchangeRateSettings({ role: 'ADMIN' });
      expect(view.exchangeRateUsdToProviderCurrency).toBe('650.00000000');
    });

    it('reads the LIVE rate for display without any role at all', async () => {
      await settings.setExchangeRate(650, 'SSP', {
        userId: admin.userId,
        role: 'ADMIN',
      });

      // The customer-facing display read (§39) is deliberately not admin-gated;
      // it exposes only a rate a customer is about to be charged at.
      const display = await settings.getExchangeRateForDisplay();
      expect(Number(display!.rate)).toBe(650);
    });
  });

  // ------------------------------------------------------------------
  /**
   * A rate that cannot be wrong cannot go stale (§69.1).
   *
   * When the platform collects in its own unit of account, §55.3 permits only a
   * rate of exactly 1 — so its age says nothing about whether it is correct.
   * Reporting it stale emails every admin, daily, about a number with one legal
   * value, and an alarm that cries wolf is worse than none: it trains people to
   * ignore the deployment where staleness really is money.
   */
  describe('a rate with nothing to convert never goes stale', () => {
    it('reports conversionInUse false and stale false, however old', async () => {
      await settings.setExchangeRate(1, INTERNAL_CURRENCY, { userId: admin.userId, role: 'ADMIN' });
      await prisma.platformSetting.update({
        where: { id: PLATFORM_SETTING_ID },
        data: { exchangeRateUpdatedAt: new Date(Date.now() - 365 * 24 * HOUR) },
      });

      const staleness = await settings.getExchangeRateStaleness();

      expect(staleness.conversionInUse).toBe(false);
      expect(staleness.stale).toBe(false);
    });

    it('so the sweep notifies nobody', async () => {
      await settings.setExchangeRate(1, INTERNAL_CURRENCY, { userId: admin.userId, role: 'ADMIN' });
      await prisma.platformSetting.update({
        where: { id: PLATFORM_SETTING_ID },
        data: { exchangeRateUpdatedAt: new Date(Date.now() - 365 * 24 * HOUR) },
      });
      notifications.notify.mock.calls.length = 0;

      const result = await scheduler.checkStaleness();

      expect(result.stale).toBe(false);
      expect(result.notified).toBe(0);
    });

    it('still goes stale for a currency that IS converted', async () => {
      await settings.setExchangeRate(650, 'SSP', { userId: admin.userId, role: 'ADMIN' });
      await prisma.platformSetting.update({
        where: { id: PLATFORM_SETTING_ID },
        data: { exchangeRateUpdatedAt: new Date(Date.now() - 365 * 24 * HOUR) },
      });

      const staleness = await settings.getExchangeRateStaleness();

      expect(staleness.conversionInUse).toBe(true);
      expect(staleness.stale).toBe(true);
    });
  });
});
