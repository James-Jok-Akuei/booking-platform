import { BadRequestException } from '@nestjs/common';
import { LedgerEntryType, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { CurrencyGuard } from '../src/payments/currency-guard.service';
import { INTERNAL_CURRENCY } from '../src/payments/currency';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createAdmin, createBusiness } from './setup/factories';

/**
 * The unit of account, and the two ways it can be got wrong (§55).
 *
 * Both failures here are silent by nature — an unknown currency's exponent and
 * a redundant exchange rate both produce a number that looks like money and is
 * off by a factor of a hundred. Neither is caught by anything downstream,
 * because every downstream check compares amounts to each other rather than to
 * reality. So they are caught here, at the two points they can enter.
 */
describe('Internal unit of account (§55)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settings: PlatformSettingsService;
  let guard: CurrencyGuard;
  let admin: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      PlatformSettingsService,
      CurrencyGuard,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    settings = moduleRef.get(PlatformSettingsService);
    guard = moduleRef.get(CurrencyGuard);
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const AS_ADMIN = () => ({ userId: admin.userId, role: UserRole.ADMIN });

  // ==================================================================
  describe('the exchange rate cannot name a currency we cannot scale', () => {
    it('refuses a currency whose minor-unit exponent is unknown', async () => {
      await expect(settings.setExchangeRate(1200, 'ZZZ', AS_ADMIN())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('says how to fix it, rather than just refusing', async () => {
      await expect(settings.setExchangeRate(1200, 'ZZZ', AS_ADMIN())).rejects.toThrow(
        /MINOR_UNIT_EXPONENT/,
      );
    });

    it('accepts a zero-decimal currency that IS recorded', async () => {
      const result = await settings.setExchangeRate(1300, 'RWF', AS_ADMIN());

      expect(result.providerCurrency).toBe('RWF');
    });
  });

  // ==================================================================
  describe('a provider charging in our own unit of account needs no rate', () => {
    it('refuses any rate other than 1', async () => {
      await expect(
        settings.setExchangeRate(650, INTERNAL_CURRENCY, AS_ADMIN()),
      ).rejects.toThrow(/must be exactly 1/);
    });

    it('accepts exactly 1', async () => {
      const result = await settings.setExchangeRate(1, INTERNAL_CURRENCY, AS_ADMIN());

      expect(result.providerCurrency).toBe(INTERNAL_CURRENCY);
    });

    it('still allows a real rate for a genuinely foreign currency', async () => {
      const result = await settings.setExchangeRate(6500, 'SSP', AS_ADMIN());

      expect(result.providerCurrency).toBe('SSP');
    });
  });

  // ==================================================================
  describe('the boot guard refuses to reinterpret existing money', () => {
    it('starts cleanly when the ledger agrees with the configured currency', async () => {
      await expect(guard.onModuleInit()).resolves.toBeUndefined();
    });

    it('refuses to start when the ledger holds another currency', async () => {
      const business = await createBusiness(prisma);

      // A row written under a different unit of account. Nothing records the
      // unit beside the number anywhere else, so this entry is the only
      // evidence that the constant moved.
      await prisma.ledgerEntry.create({
        data: {
          businessId: business.businessId,
          type: LedgerEntryType.PLATFORM_FEE,
          amountCents: -250,
          currency: 'XOF',
        },
      });

      await expect(guard.onModuleInit()).rejects.toThrow(/already holds entries denominated in/);
    });

    it('names both currencies, so the fix is obvious', async () => {
      await expect(guard.onModuleInit()).rejects.toThrow(
        new RegExp(`INTERNAL_CURRENCY is "${INTERNAL_CURRENCY}"`),
      );
    });
  });
});
