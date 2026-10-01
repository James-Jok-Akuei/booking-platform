import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReconciliationService } from '../src/ledger/reconciliation.service';
import type { WalletBalance } from '../src/payments/balance-reporting.interface';

/**
 * §87. The pairing exists for the DIFFERENCE, and the difference is the thing
 * most worth getting wrong quietly.
 *
 * So these test the refusals as hard as the arithmetic: a figure shown as
 * comparable when it is not would have someone chasing a shortfall that is an
 * artefact of the sandbox, or ignoring a real one because the number looked
 * plausible.
 */
describe('Reconciliation (§87)', () => {
  const held = (amountMinor: number | null, currency = 'RWF') => ({
    heldTotals: async () => ({
      asOf: new Date(),
      bySettlementCurrency:
        amountMinor === null
          ? []
          : [
              {
                settlementCurrency: currency,
                amountMinor,
                entryCount: 3,
                reportingInternalMinor: amountMinor,
              },
            ],
      entriesWithoutSettlement: 0,
      totalEntries: 3,
      note: '',
    }),
  });

  const operator = (wallets: WalletBalance[], isSandbox = false) => ({
    isSandbox,
    checkBalances: async () => wallets,
  });

  const ok = (
    wallet: 'COLLECTION' | 'DISBURSEMENT',
    reportedAmount: string,
    currency: string,
    amountMinor: number | null,
  ): WalletBalance => ({ wallet, status: 'OK', reportedAmount, currency, amountMinor });

  const down = (wallet: 'COLLECTION' | 'DISBURSEMENT'): WalletBalance => ({
    wallet,
    status: 'UNAVAILABLE',
    reason: 'The operator had an internal error.',
  });

  const build = (ledger: unknown, balances: unknown) =>
    new ReconciliationService(ledger as never, balances as never);

  const admin = { role: UserRole.ADMIN };

  it('refuses a non-admin', async () => {
    const service = build(held(100), operator([]));
    await expect(service.compare({ role: UserRole.BUSINESS })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('when it will NOT compare', () => {
    it('never compares in sandbox, even when the currencies match', async () => {
      const service = build(
        held(8305),
        operator([ok('COLLECTION', '8305', 'RWF', 8305)], true),
      );
      const result = await service.compare(admin);

      // The figures agree exactly, and it still refuses: sandbox numbers are
      // props. Agreeing by coincidence is the most dangerous case of all.
      expect(result.comparable).toBe(false);
      expect(result.notComparableReason).toBe('SANDBOX');
      expect(result.difference).toBeNull();
    });

    it('will not subtract two different currencies', async () => {
      const service = build(
        held(8305, 'RWF'),
        operator([ok('COLLECTION', '1000', 'EUR', 100000)]),
      );
      const result = await service.compare(admin);

      expect(result.comparable).toBe(false);
      expect(result.notComparableReason).toBe('DIFFERENT_CURRENCY');
      expect(result.note).toContain('RWF');
      expect(result.note).toContain('EUR');
    });

    it('treats no answer as no answer, not as a balance of zero', async () => {
      const service = build(held(8305), operator([down('COLLECTION')]));
      const result = await service.compare(admin);

      expect(result.comparable).toBe(false);
      expect(result.notComparableReason).toBe('BALANCE_UNAVAILABLE');
      expect(result.difference).toBeNull();
    });

    it('does not compare against the DISBURSEMENT wallet', async () => {
      // Money is paid FROM that one. Only the collection wallet holds what the
      // ledger is a claim about, so a disbursement figure alone is not enough.
      const service = build(
        held(8305),
        operator([ok('DISBURSEMENT', '8305', 'RWF', 8305)]),
      );
      const result = await service.compare(admin);

      expect(result.comparable).toBe(false);
      expect(result.notComparableReason).toBe('BALANCE_UNAVAILABLE');
    });

    it('still reports both wallets when it will not compare', async () => {
      const service = build(
        held(8305),
        operator([ok('COLLECTION', '-25', 'EUR', -2500), down('DISBURSEMENT')], true),
      );
      const result = await service.compare(admin);

      // Seeing the operator's number is useful even when subtracting is not.
      expect(result.wallets).toHaveLength(2);
      expect(result.isSandbox).toBe(true);
    });
  });

  describe('when it will compare', () => {
    it('says so when the two agree', async () => {
      const service = build(held(8305), operator([ok('COLLECTION', '8305', 'RWF', 8305)]));
      const result = await service.compare(admin);

      expect(result.comparable).toBe(true);
      expect(result.difference).toBe(0);
      expect(result.note).toContain('exactly');
    });

    it('a positive difference means money arrived that was not recorded', async () => {
      const service = build(held(8305), operator([ok('COLLECTION', '9000', 'RWF', 9000)]));
      const result = await service.compare(admin);

      expect(result.difference).toBe(695);
      expect(result.note).toContain('MORE');
    });

    it('a negative difference means money left that was not recorded', async () => {
      const service = build(held(8305), operator([ok('COLLECTION', '8000', 'RWF', 8000)]));
      const result = await service.compare(admin);

      expect(result.difference).toBe(-305);
      expect(result.note).toContain('LESS');
    });

    it('will not compare a balance whose minor units could not be worked out', async () => {
      // amountMinor null means the currency's exponent is unknown (§55.2).
      const service = build(held(8305), operator([ok('COLLECTION', '8305', 'RWF', null)]));
      const result = await service.compare(admin);

      expect(result.comparable).toBe(false);
      expect(result.notComparableReason).toBe('DIFFERENT_CURRENCY');
    });
  });
});
