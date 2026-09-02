import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LedgerEntryType, PayoutStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  asUser,
  createAdmin,
  createBusiness,
  createCustomer,
} from './setup/factories';

const DAY = 86_400_000;

/**
 * Payout runs (§35).
 *
 * Entries are created directly here rather than through the booking flow: what
 * is under test is which entries a run selects and what it does to them, and
 * building each case from an appointment would bury that behind availability
 * rules that have their own suite.
 */
describe('Payouts (§35)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payouts: PayoutsService;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([PayoutsService]);
    prisma = moduleRef.get(PrismaService);
    payouts = moduleRef.get(PayoutsService);
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.payout.deleteMany({});
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');
  const AS_ALPHA = () => asUser(alpha.userId, 'BUSINESS');
  const AS_BETA = () => asUser(beta.userId, 'BUSINESS');

  /** One ledger entry, with control over the two fields a run cares about. */
  const entry = (
    business: TestBusiness,
    amountCents: number,
    availableAt: Date | null = new Date(Date.now() - DAY),
  ) =>
    prisma.ledgerEntry.create({
      data: {
        businessId: business.businessId,
        type:
          amountCents >= 0
            ? LedgerEntryType.DEPOSIT_RECEIVED
            : LedgerEntryType.PLATFORM_FEE,
        amountCents,
        currency: 'USD',
        // Payouts settle in settlement currency (§46), so a fixture entry must
        // carry one or it is correctly excluded as unpayable. Mirroring the USD
        // figure keeps every amount in this suite readable as one number.
        settlementCurrency: 'USD',
        settlementAmountMinor: amountCents,
        bookingExchangeRate: 1,
        availableAt,
      },
    });

  const entriesOf = (business: TestBusiness) =>
    prisma.ledgerEntry.findMany({ where: { businessId: business.businessId } });

  describe('a run pays only what is available and unstamped', () => {
    it('creates one payout for the sum of available entries', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(1);
      const [payout] = await prisma.payout.findMany();
      expect(payout.amountCents).toBe(3600);
      expect(payout.status).toBe(PayoutStatus.PENDING);
      expect(payout.businessId).toBe(alpha.businessId);
    });

    it('stamps every entry it paid with that payout id', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);

      await payouts.run();

      const [payout] = await prisma.payout.findMany();
      const stamped = await entriesOf(alpha);
      expect(stamped.every((e) => e.payoutId === payout.id)).toBe(true);
    });

    it('excludes entries whose availableAt is still in the future', async () => {
      await entry(alpha, 4500, new Date(Date.now() - DAY));
      await entry(alpha, 7000, new Date(Date.now() + 3 * DAY));

      await payouts.run();

      const [payout] = await prisma.payout.findMany();
      // Only the matured entry. The other is money the platform holds but does
      // not owe yet.
      expect(payout.amountCents).toBe(4500);
      const future = (await entriesOf(alpha)).find((e) => e.amountCents === 7000)!;
      expect(future.payoutId).toBeNull();
    });

    it('excludes entries with no availableAt at all', async () => {
      await entry(alpha, 4500, null);

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(0);
      expect(await prisma.payout.count()).toBe(0);
    });

    it('never pays the same entry twice across two runs', async () => {
      await entry(alpha, 4500);

      await payouts.run();
      const second = await payouts.run();

      expect(second.payoutsCreated).toBe(0);
      expect(await prisma.payout.count()).toBe(1);
    });

    it('keeps two businesses separate', async () => {
      await entry(alpha, 4500);
      await entry(beta, 2000);

      await payouts.run();

      const all = await prisma.payout.findMany({ orderBy: { amountCents: 'desc' } });
      expect(all).toHaveLength(2);
      expect(all[0].businessId).toBe(alpha.businessId);
      expect(all[1].businessId).toBe(beta.businessId);
    });
  });

  describe('a negative balance carries forward instead of being paid', () => {
    it('creates no payout when the available sum is negative', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -4500);
      await entry(alpha, -100);

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(0);
      expect(summary.skippedNonPositive).toBe(1);
      expect(await prisma.payout.count()).toBe(0);
    });

    it('leaves those entries unstamped, so the debt survives', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -5000);

      await payouts.run();

      // Stamping them would erase the negative and quietly forgive the debt.
      expect((await entriesOf(alpha)).every((e) => e.payoutId === null)).toBe(true);
    });

    it('creates no payout when the sum is exactly zero', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -4500);

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(0);
      expect(summary.skippedNonPositive).toBe(1);
    });

    it('nets a later positive entry against the carried-forward negative', async () => {
      await entry(alpha, -1000);
      await payouts.run();
      expect(await prisma.payout.count()).toBe(0);

      // The business earns again. The old debt is still in the pool.
      await entry(alpha, 2500);
      await payouts.run();

      const [payout] = await prisma.payout.findMany();
      expect(payout.amountCents).toBe(1500);
      // Both entries settled by that one payout, debt included.
      expect((await entriesOf(alpha)).every((e) => e.payoutId === payout.id)).toBe(true);
    });

    it('is the day-one case: a business whose only booking they cancelled', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);
      await entry(alpha, -4500);
      await entry(alpha, 900);
      await entry(alpha, -50);

      const summary = await payouts.run();

      // Net -50: the gateway's charge on the refund, borne by the business.
      expect(summary.payoutsCreated).toBe(0);
      expect(await prisma.payout.count()).toBe(0);
    });
  });

  describe('two runs cannot stamp the same entry twice', () => {
    it('produces one payout, and no entry stamped by two', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);

      await Promise.all([payouts.run(), payouts.run()]);

      const all = await prisma.payout.findMany();
      const stamped = await entriesOf(alpha);
      const distinct = new Set(stamped.map((e) => e.payoutId));

      // Whether the two interleave or serialise, the outcome is the same: the
      // money goes out once. A rolled-back run leaves no payout behind.
      expect(distinct.size).toBe(1);
      const paidOut = all.filter((p) => distinct.has(p.id));
      expect(paidOut).toHaveLength(1);
      expect(paidOut[0].amountCents).toBe(3600);
      expect(all.reduce((sum, p) => sum + p.amountCents, 0)).toBe(3600);
    });
  });

  describe('marking a payout paid', () => {
    const pending = async () => {
      await entry(alpha, 4500);
      await payouts.run();
      return prisma.payout.findFirstOrThrow();
    };

    it('records the reference and the time', async () => {
      const payout = await pending();

      const paid = await payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-123' });

      expect(paid.status).toBe(PayoutStatus.PAID);
      expect(paid.reference).toBe('MOMO-123');
      expect(paid.paidAt).not.toBeNull();
    });

    it('leaves its entries stamped', async () => {
      const payout = await pending();

      await payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-123' });

      expect((await entriesOf(alpha)).every((e) => e.payoutId === payout.id)).toBe(true);
    });

    it('refuses to pay the same payout twice', async () => {
      const payout = await pending();
      await payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-123' });

      await expect(
        payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a non-admin at the service level', async () => {
      const payout = await pending();

      await expect(
        payouts.markPaid(AS_ALPHA(), payout.id, { reference: 'MOMO-123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('marking a payout failed returns its money to the pool', () => {
    const pending = async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);
      await payouts.run();
      return prisma.payout.findFirstOrThrow();
    };

    it('unstamps every entry it held', async () => {
      const payout = await pending();

      await payouts.markFailed(AS_ADMIN(), payout.id, { reason: 'Wrong MoMo number.' });

      const after = await entriesOf(alpha);
      expect(after.every((e) => e.payoutId === null)).toBe(true);
      // The entries were never wrong; only the transfer failed.
      expect(after.every((e) => e.availableAt !== null)).toBe(true);
    });

    it('keeps the failed payout as the record of the attempt', async () => {
      const payout = await pending();

      const failed = await payouts.markFailed(AS_ADMIN(), payout.id, {
        reason: 'Wrong MoMo number.',
      });

      expect(failed.status).toBe(PayoutStatus.FAILED);
      expect(failed.failureReason).toBe('Wrong MoMo number.');
      expect(failed.amountCents).toBe(3600);
    });

    it('lets the next run pick that money up again', async () => {
      const payout = await pending();
      await payouts.markFailed(AS_ADMIN(), payout.id, { reason: 'Wrong MoMo number.' });

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(1);
      const fresh = await prisma.payout.findFirstOrThrow({
        where: { status: PayoutStatus.PENDING },
      });
      expect(fresh.amountCents).toBe(3600);
      expect(fresh.id).not.toBe(payout.id);
    });

    it('refuses to fail a payout that was already paid', async () => {
      const payout = await pending();
      await payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-123' });

      await expect(
        payouts.markFailed(AS_ADMIN(), payout.id, { reason: 'Too late.' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a non-admin at the service level', async () => {
      const payout = await pending();

      await expect(
        payouts.markFailed(AS_ALPHA(), payout.id, { reason: 'Not mine to fail.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('balance', () => {
    it('separates available, pending and unresolved money', async () => {
      await entry(alpha, 4500, new Date(Date.now() - DAY));
      await entry(alpha, -900, new Date(Date.now() - DAY));
      await entry(alpha, 7000, new Date(Date.now() + 3 * DAY));
      await entry(alpha, 2000, null);

      const balance = await payouts.balance(AS_ALPHA(), alpha.businessId);

      expect(balance.availableNowCents).toBe(3600);
      expect(balance.pendingCents).toBe(7000);
      expect(balance.unresolvedCents).toBe(2000);
    });

    it('counts lifetime paid from PAID payouts only', async () => {
      await entry(alpha, 4500);
      await payouts.run();
      const first = await prisma.payout.findFirstOrThrow();
      await payouts.markPaid(AS_ADMIN(), first.id, { reference: 'MOMO-1' });

      await entry(alpha, 1000);
      await payouts.run();

      const balance = await payouts.balance(AS_ALPHA(), alpha.businessId);

      // The second payout is PENDING — it has not gone out, so it is not paid.
      expect(balance.lifetimePaidCents).toBe(4500);
      expect(balance.payoutCount).toBe(1);
    });

    it('says so when the balance is negative', async () => {
      await entry(alpha, -1000);

      const balance = await payouts.balance(AS_ALPHA(), alpha.businessId);

      expect(balance.availableNowCents).toBe(-1000);
      expect(balance.note).toMatch(/negative/);
    });

    it('is a sum of entries, never a stored column', async () => {
      await entry(alpha, 4500);
      await entry(alpha, -900);

      const before = await payouts.balance(AS_ALPHA(), alpha.businessId);
      await entry(alpha, -600);
      const after = await payouts.balance(AS_ALPHA(), alpha.businessId);

      // Appending a row is the only way the figure moves, and it moves at once.
      expect(before.availableNowCents).toBe(3600);
      expect(after.availableNowCents).toBe(3000);
    });
  });

  describe('cross-tenant isolation', () => {
    it('refuses another business the balance - 404, not 403', async () => {
      await entry(alpha, 4500);

      await expect(
        payouts.balance(AS_BETA(), alpha.businessId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses another business the payout list', async () => {
      await entry(alpha, 4500);
      await payouts.run();

      await expect(
        payouts.listForBusiness(AS_BETA(), alpha.businessId, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an admin read any business', async () => {
      await entry(alpha, 4500);

      const balance = await payouts.balance(AS_ADMIN(), alpha.businessId);

      expect(balance.availableNowCents).toBe(4500);
    });

    it('scopes a business listing to its own payouts', async () => {
      await entry(alpha, 4500);
      await entry(beta, 2000);
      await payouts.run();

      const list = await payouts.listForBusiness(AS_ALPHA(), alpha.businessId, {});

      expect(list.payouts).toHaveLength(1);
      expect(list.payouts[0].businessId).toBe(alpha.businessId);
    });

    it('refuses a non-admin the admin listing', async () => {
      await expect(payouts.list(AS_ALPHA(), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a customer the admin run', async () => {
      await expect(
        payouts.list(asUser(customer.userId, 'CUSTOMER'), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('batch export (§47)', () => {
    const runWithPayouts = async () => {
      await entry(alpha, 4500);
      await entry(beta, 2000);
      await payouts.run();
      return prisma.payout.findMany({ orderBy: { amountCents: 'desc' } });
    };

    it('exports the whole RUN, one row per business, not just one payout', async () => {
      const [first] = await runWithPayouts();

      const { csv, payoutCount } = await payouts.exportRun(AS_ADMIN(), first.id);

      // Addressed by a payout id, but the unit of work is the run it came in.
      expect(payoutCount).toBe(2);
      const lines = csv.trim().split('\n');
      expect(lines[0]).toContain('businessId,businessName');
      // header + 2 businesses + 1 totals row (single currency)
      expect(lines).toHaveLength(4);
    });

    it('says NOT RECORDED for the payout destination, and does not invent one', async () => {
      const [first] = await runWithPayouts();

      const { csv } = await payouts.exportRun(AS_ADMIN(), first.id);

      // No payout destination exists in the schema (§47.2). A blank cell would
      // read as missing data; this reads as "nobody has ever collected one".
      expect(csv).toContain('NOT RECORDED');
      expect(csv).toContain('contactPhoneNotAPayoutDestination');
    });

    it('carries the settlement amount and currency, not just USD', async () => {
      const [first] = await runWithPayouts();

      const { csv } = await payouts.exportRun(AS_ADMIN(), first.id);

      expect(csv).toContain('settlementCurrency,settlementAmountMinor');
      expect(csv).toContain('USD,4500');
    });

    it('totals per currency, never one number across two', async () => {
      const shop = await createBusiness(prisma);
      await prisma.ledgerEntry.create({
        data: {
          businessId: shop.businessId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountCents: 1000,
          currency: 'USD',
          settlementCurrency: 'SSP',
          settlementAmountMinor: 650_000,
          availableAt: new Date(Date.now() - DAY),
        },
      });
      await entry(alpha, 4500);
      await payouts.run();
      const [any] = await prisma.payout.findMany();

      const { csv } = await payouts.exportRun(AS_ADMIN(), any.id);

      // A grand total across currencies would be a number with no unit.
      const totalLines = csv.split('\n').filter((l) => l.includes('TOTAL'));
      expect(totalLines).toHaveLength(2);
      expect(csv).toContain('SSP,650000');
      expect(csv).toContain('USD,4500');
    });

    it('quotes a business name containing a comma', async () => {
      await prisma.businessProfile.update({
        where: { id: alpha.businessId },
        data: { name: 'Nile Barbers, Juba' },
      });
      const [first] = await runWithPayouts();

      const { csv } = await payouts.exportRun(AS_ADMIN(), first.id);

      // Unquoted, this would split into two columns and shift every following
      // value — in a document someone reads amounts of money off.
      expect(csv).toContain('"Nile Barbers, Juba"');
    });

    it('includes the provider reference once a payout is marked paid', async () => {
      const [first] = await runWithPayouts();
      await payouts.markPaid(AS_ADMIN(), first.id, { reference: 'MOMO-9911' });

      const { csv } = await payouts.exportRun(AS_ADMIN(), first.id);

      expect(csv).toContain('MOMO-9911');
      expect(csv).toContain('PAID');
    });

    it.each(['CUSTOMER', 'BUSINESS'])('refuses a %s at the service level', async (role) => {
      const [first] = await runWithPayouts();

      await expect(
        payouts.exportRun({ role }, first.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s on a payout that does not exist', async () => {
      await expect(
        payouts.exportRun(AS_ADMIN(), '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
