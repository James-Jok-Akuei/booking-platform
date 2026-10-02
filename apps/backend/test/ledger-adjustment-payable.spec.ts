import { LedgerEntryType } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/**
 * The database refuses a billing ADJUSTMENT that cannot be paid out (§115).
 *
 * §68 fixed the code that was writing them. This asserts the rule the code no
 * longer needs to be trusted with: a `CHECK` constraint, so a seed script, a
 * psql session, a future service or a bug in this one all hit the same wall.
 *
 * Every test here goes through raw SQL on purpose. Prisma's own types would
 * stop most of this at compile time, which is exactly why it proves nothing
 * about the database — and the entries §67.5 found were written by code that
 * type-checked perfectly.
 *
 * The last test is the one that keeps the rule honest. A DEPOSIT_RECEIVED entry
 * with no settlement figure is LEGAL, and must stay legal: forbidding it would
 * put this constraint inside the transaction that confirms a deposit.
 */
describe('A billing adjustment must be payable (§115)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let business: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const insert = (
    id: string,
    settlementCurrency: string | null,
    settlementAmountMinor: number | null,
    type: LedgerEntryType = LedgerEntryType.ADJUSTMENT,
  ) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "ledger_entries"
         ("id", "businessId", "type", "amountMinor", "currency",
          "settlementCurrency", "settlementAmountMinor", "createdAt")
       VALUES ($1, $2, $3::"LedgerEntryType", $4, $5, $6, $7, now())`,
      id,
      business.businessId,
      type,
      100,
      'USD',
      settlementCurrency,
      settlementAmountMinor,
    );

  it('refuses one with no settlement figure at all', async () => {
    // What §67.5 found in the live database: an adjustment nobody could ever be
    // paid, sitting in a balance and counted in a total.
    await expect(insert('no-settlement', null, null)).rejects.toThrow(
      /ledger_entries_adjustment_payable/,
    );
  });

  it('refuses one with a currency but no amount', async () => {
    await expect(insert('currency-only', 'USD', null)).rejects.toThrow(
      /ledger_entries_adjustment_payable/,
    );
  });

  it('refuses one with an amount but no currency', async () => {
    // The worse half: an amount with no currency is a number nobody can send.
    await expect(insert('amount-only', null, 100)).rejects.toThrow(
      /ledger_entries_adjustment_payable/,
    );
  });

  it('accepts a complete one', async () => {
    await expect(insert('complete', 'USD', 100)).resolves.toBe(1);

    const written = await prisma.ledgerEntry.findUnique({ where: { id: 'complete' } });
    expect(written?.settlementAmountMinor).toBe(100);
  });

  it('accepts a NEGATIVE settlement amount — a correction is not an error', async () => {
    // The constraint is about presence, not sign. An adjustment that takes money
    // back is exactly what §68's billing adjustments write, and a constraint
    // that refused it would break the feature it exists to protect.
    await expect(insert('negative', 'USD', -250)).resolves.toBe(1);
  });

  it('leaves a DEPOSIT_RECEIVED with no settlement alone, which it must', async () => {
    // The pre-§45 shape: an appointment that never went through the payment
    // initiation recording what was charged. Payouts exclude these rather than
    // convert at a guessed rate, and that is the designed behaviour.
    //
    // If this ever starts failing, the constraint has been widened and the cost
    // is a deposit confirmation rolling back AFTER the operator took the money.
    await expect(
      insert('legacy-deposit', null, null, LedgerEntryType.DEPOSIT_RECEIVED),
    ).resolves.toBe(1);
    await expect(
      insert('legacy-fee', null, null, LedgerEntryType.PLATFORM_FEE),
    ).resolves.toBe(1);
  });

  it('still cannot be set to null afterwards — the entry is append-only', async () => {
    await insert('frozen', 'USD', 100);

    // Two rules meet here. The trigger is what refuses it first, and either
    // refusal is the right outcome: a settled entry does not become unsettled.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "ledger_entries" SET "settlementAmountMinor" = NULL WHERE "id" = 'frozen'`,
      ),
    ).rejects.toThrow(/append-only|ledger_entries_adjustment_payable/);
  });
});
