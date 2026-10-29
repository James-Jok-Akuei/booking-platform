import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AdminInvitationsService } from '../src/users/admin-invitations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MONEY_ACCESS_KEY } from '../src/common/decorators/money-access.decorator';
import { MONEY_ADMINS, hasMoneyAccess } from '../src/users/money-access';
import { AdminStatisticsController } from '../src/analytics/admin-statistics.controller';
import { AdminLedgerController } from '../src/ledger/admin-ledger.controller';
import { AdminRefundsController } from '../src/refunds/refunds.controller';
import { AdminPayoutDestinationsController } from '../src/payouts/payout-destinations.controller';
import { AdminPayoutsController, BusinessPayoutsController } from '../src/payouts/payouts.controller';
import { AdminSettingsController } from '../src/settings/admin-settings.controller';
import { AdminCountriesService } from '../src/countries/admin-countries.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import type { AuthenticatedUser } from '../src/common/decorators/current-user.decorator';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createCustomer } from './setup/factories';

/**
 * Money access (§317): the primary administrator, and those they trust with
 * money, see and move the platform's money; every other administrator does
 * the daily work without it. The guard itself is exercised over HTTP in
 * guard-chain.e2e.spec.ts; this proves which routes carry it and the switch.
 */
describe('Money access (§317)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let invitations: AdminInvitationsService;
  let countries: AdminCountriesService;
  let primary: AuthenticatedUser;
  let helper: AuthenticatedUser;

  beforeAll(async () => {
    moduleRef = await createTestModule([AdminInvitationsService, AdminCountriesService, PlatformSettingsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    invitations = moduleRef.get(AdminInvitationsService);
    countries = moduleRef.get(AdminCountriesService);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const p = await prisma.user.create({ data: { email: `primary.${Date.now()}@test.local`, role: UserRole.ADMIN, isPrimaryAdmin: true } });
    const h = await prisma.user.create({ data: { email: `helper.${Date.now()}@test.local`, role: UserRole.ADMIN } });
    primary = { userId: p.id, email: p.email, role: 'ADMIN' };
    helper = { userId: h.id, email: h.email, role: 'ADMIN' };
  });

  it('is on every money route, and off the fee every administrator sees', () => {
    for (const controller of [
      AdminStatisticsController,
      AdminLedgerController,
      AdminRefundsController,
      AdminPayoutDestinationsController,
      AdminPayoutsController,
      BusinessPayoutsController,
      AdminSettingsController,
    ]) {
      expect([controller.name, Reflect.getMetadata(MONEY_ACCESS_KEY, controller)]).toEqual([controller.name, true]);
    }
    expect(Reflect.getMetadata(MONEY_ACCESS_KEY, AdminSettingsController.prototype.getPlatformFee)).toBe(false);
  });

  it('is always the primary’s, and nobody else’s until given', async () => {
    expect(await invitations.accessOf(primary)).toMatchObject({ isPrimaryAdmin: true, moneyAccess: true });
    expect(await invitations.accessOf(helper)).toMatchObject({ isPrimaryAdmin: false, moneyAccess: false });
    expect(hasMoneyAccess({ role: 'CUSTOMER', isPrimaryAdmin: false, moneyAccess: true })).toBe(false);
  });

  it('is given and taken by the primary, saying who', async () => {
    const given = await invitations.setMoneyAccess(primary, helper.userId, true);
    expect(given).toMatchObject({ moneyAccess: true, moneyAccessBy: primary.email });
    expect((await invitations.accessOf(helper)).moneyAccess).toBe(true);
    await invitations.setMoneyAccess(primary, helper.userId, false);
    expect((await invitations.accessOf(helper)).moneyAccess).toBe(false);
  });

  it('is decided by nobody but the primary', async () => {
    const other = await prisma.user.create({ data: { email: `other.${Date.now()}@test.local`, role: UserRole.ADMIN, moneyAccess: true } });
    const trusted = { userId: other.id, email: other.email, role: 'ADMIN' as const };
    await expect(invitations.setMoneyAccess(trusted, helper.userId, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is never switched for the primary, and only ever given to an administrator', async () => {
    await expect(invitations.setMoneyAccess(primary, primary.userId, false)).rejects.toBeInstanceOf(BadRequestException);
    const customer = await createCustomer(prisma);
    await expect(invitations.setMoneyAccess(primary, customer.userId, true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(invitations.setMoneyAccess(primary, '00000000-0000-4000-8000-000000000000', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('goes when administrator access goes', async () => {
    await invitations.setMoneyAccess(primary, helper.userId, true);
    await invitations.revokeAdmin(primary, helper.userId);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: helper.userId } });
    expect(row).toMatchObject({ role: UserRole.CUSTOMER, moneyAccess: false });
  });

  it('sends the notices about money only to those who can act on them', async () => {
    await invitations.setMoneyAccess(primary, helper.userId, false);
    const ids = (await prisma.user.findMany({ where: MONEY_ADMINS, select: { id: true } })).map((u) => u.id);
    expect(ids).toEqual([primary.userId]);
  });

  it('is needed to change a country’s fee, and not to read the countries', async () => {
    await expect(countries.update(helper, 'RW', { platformFeePercentage: 7 })).rejects.toMatchObject({
      response: { code: 'MONEY_ACCESS_REQUIRED' },
    });
    expect(await countries.list()).not.toHaveLength(0);
    await countries.update(primary, 'RW', { platformFeePercentage: 7 });
    await countries.update(primary, 'RW', { platformFeePercentage: null });
  });
});
