import { jest } from '@jest/globals';
import {
  AppointmentStatus,
  BusinessStatus,
  LedgerEntryType,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { splitSettlement } from '../src/ledger/settlement';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

const DAY = 86_400_000;

/**
 * Settlement amounts on the ledger (§45).
 *
 * The rule under test is one sentence: the pair must sum exactly, in BOTH
 * currencies, for every amount — including the ones that do not divide evenly,
 * which is where a second independent rounding would show up.
 */
describe('Settlement currency on the ledger (§45)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let settings: PlatformSettingsService;

  let business: TestBusiness;
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      PayoutsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    settings = moduleRef.get(PlatformSettingsService);
    await resetDatabase(prisma);
    await settings.setPlatformFeePercentage(10, { role: 'ADMIN' });
    business = await createBusiness(prisma, { priceCents: 4500, depositPercentage: 20 });
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  // ------------------------------------------------------------------
  describe('the split itself', () => {
    /**
     * Amounts chosen so several do NOT divide evenly — 7/3, 1001/7, primes.
     * An even split would pass under a broken implementation that rounds both
     * sides independently.
     */
    const CASES: Array<[string, number, number, number]> = [
      ['a clean tenth', 585_000, 900, 450],
      ['an odd charged amount', 585_001, 900, 450],
      ['a prime charged amount', 104_729, 900, 450],
      ['a fee that is a third', 1_000, 900, 300],
      ['a fee that is a seventh', 1_001, 700, 100],
      ['one minor unit charged', 1, 900, 450],
      ['a large charge', 999_999_99, 4500, 450],
      ['fee equal to deposit', 585_000, 900, 900],
      ['a fee of zero', 585_000, 900, 0],
    ];

    it.each(CASES)(
      'sums exactly with %s',
      (_label, chargedMinor, depositAmountCents, platformFeeAmountCents) => {
        const split = splitSettlement({
          chargedMinor,
          depositAmountCents,
          platformFeeAmountCents,
        });

        // The invariant, in the settlement currency: deposit − fee = business.
        expect(split.depositMinor - split.feeMinor).toBe(split.businessMinor);
        expect(split.depositMinor).toBe(chargedMinor);
      },
    );

    it.each(CASES)(
      'never lets the fee exceed the charge with %s',
      (_label, chargedMinor, depositAmountCents, platformFeeAmountCents) => {
        const split = splitSettlement({
          chargedMinor,
          depositAmountCents,
          platformFeeAmountCents,
        });

        // Guaranteed by deposit >= fee (§40), so the business share is never
        // negative in settlement currency either.
        expect(split.feeMinor).toBeLessThanOrEqual(chargedMinor);
        expect(split.businessMinor).toBeGreaterThanOrEqual(0);
      },
    );

    it('gives the business exactly zero when the fee equals the deposit', () => {
      const split = splitSettlement({
        chargedMinor: 585_000,
        depositAmountCents: 900,
        platformFeeAmountCents: 900,
      });

      // The proportion is exactly 1: the fee takes the whole charged amount.
      expect(split.feeMinor).toBe(585_000);
      expect(split.businessMinor).toBe(0);
    });

    it('rounds ONCE, on the fee, leaving the remainder to the business', () => {
      // 1001 × 1/3 = 333.67 -> 334 on the fee, and 667 left over. If both were
      // rounded independently the two would be 334 and 667 = 1001 only by luck;
      // the point is that the remainder is DERIVED, never rounded.
      const split = splitSettlement({
        chargedMinor: 1001,
        depositAmountCents: 900,
        platformFeeAmountCents: 300,
      });

      expect(split.feeMinor + split.businessMinor).toBe(1001);
    });

    it('does not divide by zero when nothing was charged', () => {
      const split = splitSettlement({
        chargedMinor: 0,
        depositAmountCents: 0,
        platformFeeAmountCents: 0,
      });

      expect(split).toEqual({ depositMinor: 0, feeMinor: 0, businessMinor: 0 });
    });
  });

  // ------------------------------------------------------------------
  describe('through the real deposit path', () => {
    /**
     * A paid appointment whose charged amount is recorded, as
     * `initiateDepositPayment` would have recorded it.
     */
    const paid = async (options: {
      chargedMinor: number;
      depositPercentage?: number;
      rate?: number;
      /** Overrides the factory's hardcoded 900/450/450 money fields. */
      amounts?: { deposit: number; fee: number };
    }) => {
      const shop = await createBusiness(prisma, {
        priceCents: 4500,
        depositPercentage: options.depositPercentage ?? 20,
      });
      const buyer = await createCustomer(prisma);
      const appointment = await createAppointment(prisma, {
        business: shop,
        customerId: buyer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      const reference = `ref-settle-${appointment.id}`;
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          paymentProviderReferenceId: reference,
          paymentInitiatedAt: new Date(),
          providerCurrency: 'SSP',
          providerCurrencyAmountCents: options.chargedMinor,
          exchangeRateUsed: options.rate ?? 650,
          startTime: new Date(Date.now() - DAY - 3_600_000),
          endTime: new Date(Date.now() - DAY),
          ...(options.amounts
            ? {
                depositAmountCents: options.amounts.deposit,
                platformFeeAmountCents: options.amounts.fee,
                businessAmountCents: options.amounts.deposit - options.amounts.fee,
              }
            : {}),
        },
      });
      await appointments.applyPaymentResult(appointment.id, reference, 'SUCCESSFUL');
      const row = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      return { shop, appointment: row };
    };

    const entriesFor = (appointmentId: string) =>
      prisma.ledgerEntry.findMany({ where: { appointmentId }, orderBy: { type: 'asc' } });

    const byType = async (appointmentId: string) =>
      Object.fromEntries(
        (await entriesFor(appointmentId)).map((e) => [e.type, e]),
      ) as Record<string, { amountCents: number; settlementAmountMinor: number | null; settlementCurrency: string | null; bookingExchangeRate: unknown }>;

    it('records the CHARGED figure, not a recomputation', async () => {
      // 585 001 is deliberately not 900 × 650 = 585 000. If the code recomputed
      // from the rate it would silently produce the round number instead of the
      // figure the provider actually took.
      const { appointment } = await paid({ chargedMinor: 585_001 });

      const entries = await byType(appointment.id);

      expect(entries[LedgerEntryType.DEPOSIT_RECEIVED].settlementAmountMinor).toBe(
        585_001,
      );
      expect(entries[LedgerEntryType.DEPOSIT_RECEIVED].settlementCurrency).toBe('SSP');
    });

    it.each([585_000, 585_001, 104_729, 1])(
      'sums exactly in BOTH currencies for a charge of %s',
      async (chargedMinor) => {
        const { appointment } = await paid({ chargedMinor });

        const entries = await entriesFor(appointment.id);
        const usd = entries.reduce((sum, e) => sum + e.amountCents, 0);
        const settlement = entries.reduce(
          (sum, e) => sum + (e.settlementAmountMinor ?? 0),
          0,
        );

        expect(usd).toBe(appointment.businessAmountCents);
        // The same invariant, in the currency the business is actually paid in.
        const split = splitSettlement({
          chargedMinor,
          depositAmountCents: appointment.depositAmountCents,
          platformFeeAmountCents: appointment.platformFeeAmountCents,
        });
        expect(settlement).toBe(split.businessMinor);
      },
    );

    it('gives a zero settlement share when deposit == fee', async () => {
      // A 10% deposit against a 10% platform fee: the business keeps nothing.
      const { appointment } = await paid({
        chargedMinor: 292_500,
        // A 10% deposit against a 10% platform fee — the §40 floor exactly.
        amounts: { deposit: 450, fee: 450 },
      });

      const entries = await entriesFor(appointment.id);

      expect(appointment.businessAmountCents).toBe(0);
      expect(entries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0);
      // Exactly zero in the settlement currency too — not "about zero".
      expect(
        entries.reduce((sum, e) => sum + (e.settlementAmountMinor ?? 0), 0),
      ).toBe(0);
    });

    it('stores the booking rate on every entry', async () => {
      const { appointment } = await paid({ chargedMinor: 585_000, rate: 700 });

      const entries = await entriesFor(appointment.id);

      expect(
        entries.every((e) => Number(e.bookingExchangeRate) === 700),
      ).toBe(true);
    });

    it('leaves settlement null when the appointment never recorded a charge', async () => {
      const appointment = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
        // The pre-§45 shape: no charged amount was ever recorded.
        providerCharge: null,
      });
      const reference = `ref-nocharge-${appointment.id}`;
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { paymentProviderReferenceId: reference },
      });

      await appointments.applyPaymentResult(appointment.id, reference, 'SUCCESSFUL');

      const entries = await entriesFor(appointment.id);
      // Not converted at a guessed rate. Payouts exclude these.
      expect(entries.every((e) => e.settlementAmountMinor === null)).toBe(true);
      expect(entries.every((e) => e.settlementCurrency === null)).toBe(true);
      // The USD figures are still complete.
      expect(entries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }))
          .businessAmountCents,
      );
    });

    // ----------------------------------------------------------------
    describe('a refund copies the exact negatives', () => {
      it('returns the business to precisely zero in both currencies', async () => {
        const { shop, appointment } = await paid({ chargedMinor: 585_001 });

        await appointments.cancel(shop.userId, appointment.id, {
          reason: 'Closed.',
          gatewayChargeMinor: 0,
        });

        const entries = await entriesFor(appointment.id);
        expect(entries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0);
        // The whole reason the originals are copied rather than recomputed.
        expect(
          entries.reduce((sum, e) => sum + (e.settlementAmountMinor ?? 0), 0),
        ).toBe(0);
      });

      it('the refund pair is the exact negative of the original pair', async () => {
        const { shop, appointment } = await paid({ chargedMinor: 104_729 });
        const before = await byType(appointment.id);

        await appointments.cancel(shop.userId, appointment.id, {
          reason: 'Closed.',
          gatewayChargeMinor: 0,
        });

        const after = await byType(appointment.id);
        expect(after[LedgerEntryType.DEPOSIT_REFUND].settlementAmountMinor).toBe(
          -before[LedgerEntryType.DEPOSIT_RECEIVED].settlementAmountMinor!,
        );
        expect(
          after[LedgerEntryType.PLATFORM_FEE_REVERSAL].settlementAmountMinor,
        ).toBe(-before[LedgerEntryType.PLATFORM_FEE].settlementAmountMinor!);
      });

      it('is unaffected by a rate change between booking and refund', async () => {
        const { shop, appointment } = await paid({ chargedMinor: 585_000, rate: 650 });
        const before = await byType(appointment.id);

        // The rate doubles. The refund must still cancel the original exactly.
        await settings.setExchangeRate(1300, 'SSP', { role: 'ADMIN' });
        await appointments.cancel(shop.userId, appointment.id, {
          reason: 'Closed.',
          gatewayChargeMinor: 0,
        });

        const after = await byType(appointment.id);
        expect(after[LedgerEntryType.DEPOSIT_REFUND].settlementAmountMinor).toBe(
          -before[LedgerEntryType.DEPOSIT_RECEIVED].settlementAmountMinor!,
        );
        const entries = await entriesFor(appointment.id);
        expect(
          entries.reduce((sum, e) => sum + (e.settlementAmountMinor ?? 0), 0),
        ).toBe(0);
      });

      it('records the gateway charge in settlement currency', async () => {
        const { shop, appointment } = await paid({ chargedMinor: 585_000, rate: 650 });

        await appointments.cancel(shop.userId, appointment.id, {
          reason: 'Closed.',
          // 6500 SSP, which is what the provider charged — not 6500 USD cents.
          gatewayChargeMinor: 6_500,
        });

        const entries = await byType(appointment.id);
        const debit = entries[LedgerEntryType.GATEWAY_FEE_DEBIT];
        expect(debit.settlementAmountMinor).toBe(-6_500);
        expect(debit.settlementCurrency).toBe('SSP');
        // The USD figure is a reporting equivalent at the booking rate: 6500/650.
        expect(debit.amountCents).toBe(-10);
      });

      it('leaves the business exactly minus the gateway charge', async () => {
        const { shop, appointment } = await paid({ chargedMinor: 585_000, rate: 650 });

        await appointments.cancel(shop.userId, appointment.id, {
          reason: 'Closed.',
          gatewayChargeMinor: 6_500,
        });

        const entries = await entriesFor(appointment.id);
        expect(
          entries.reduce((sum, e) => sum + (e.settlementAmountMinor ?? 0), 0),
        ).toBe(-6_500);
      });
    });
  });

  // ------------------------------------------------------------------
  /**
   * THE TEST THAT IS THE DECISION (§46).
   *
   * The business's payable is fixed at the booking-date rate. If this suite is
   * ever failing and someone is tempted to delete or relax it, the thing being
   * deleted is not a test — it is the guarantee that a business is paid what it
   * was promised, whatever the currency does afterwards.
   */
  describe('A RATE CHANGE MUST NOT MOVE A PAYOUT — do not delete this', () => {
    const payouts = () => moduleRef.get(PayoutsService);
    const AS_ADMIN = { userId: 'admin', role: 'ADMIN' };

    /** Books, pays, resolves and matures one appointment so it is payable. */
    const payableBooking = async (rate: number) => {
      const shop = await createBusiness(prisma, {
        priceCents: 4500,
        depositPercentage: 20,
      });
      const buyer = await createCustomer(prisma);
      const appointment = await createAppointment(prisma, {
        business: shop,
        customerId: buyer.userId,
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      const reference = `ref-fixed-${appointment.id}`;
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          paymentProviderReferenceId: reference,
          paymentInitiatedAt: new Date(),
          providerCurrency: 'SSP',
          providerCurrencyAmountCents: 900 * rate,
          exchangeRateUsed: rate,
          startTime: new Date(Date.now() - 2 * DAY - 3_600_000),
          endTime: new Date(Date.now() - 2 * DAY),
        },
      });
      await appointments.applyPaymentResult(appointment.id, reference, 'SUCCESSFUL');
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.BOOKED },
      });
      await appointments.noShow(shop.userId, appointment.id);
      await prisma.ledgerEntry.updateMany({
        where: { appointmentId: appointment.id },
        data: { availableAt: new Date(Date.now() - DAY) },
      });
      return { shop, appointmentId: appointment.id };
    };

    it('pays the same amount whether the rate doubles, halves, or does not move', async () => {
      const booked = await settings.setExchangeRate(650, 'SSP', { role: 'ADMIN' });
      expect(booked.exchangeRateUsdToProviderCurrency).toBe('650.00000000');
      const { shop } = await payableBooking(650);

      // 900 USD cents charged at 650 = 585 000 SSP; the fee is half of it.
      const expected = 292_500;

      // The rate moves violently between booking and payout.
      await settings.setExchangeRate(1300, 'SSP', { role: 'ADMIN' });
      await payouts().run();

      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      // Not 585 000, not 146 250 — exactly what the entries were created with.
      expect(payout.settlementAmountMinor).toBe(expected);
      expect(payout.settlementCurrency).toBe('SSP');
    });

    it('reads no exchange rate at all during a run', async () => {
      await settings.setExchangeRate(650, 'SSP', { role: 'ADMIN' });
      await payableBooking(650);
      const live = jest.spyOn(settings, 'getExchangeRate');
      const display = jest.spyOn(settings, 'getExchangeRateForDisplay');

      await payouts().run();

      // A payout that consulted a rate could be moved by one. This one cannot.
      expect(live).toHaveBeenCalledTimes(0);
      expect(display).toHaveBeenCalledTimes(0);
    });

    it('pays what the entries carry even if the rate is UNSET at payout time', async () => {
      await settings.setExchangeRate(650, 'SSP', { role: 'ADMIN' });
      const { shop } = await payableBooking(650);

      // An admin clears the rate. A conversion-at-payout design would now be
      // unable to pay anybody.
      await prisma.platformSetting.updateMany({
        data: { exchangeRateUsdToProviderCurrency: null },
      });
      await payouts().run();

      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      expect(payout.settlementAmountMinor).toBe(292_500);
    });

    it('the USD figure is carried for reporting but is not what is sent', async () => {
      await settings.setExchangeRate(650, 'SSP', { role: 'ADMIN' });
      const { shop } = await payableBooking(650);

      await payouts().run();

      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      expect(payout.amountCents).toBe(450);
      expect(payout.currency).toBe('USD');
      expect(payout.settlementAmountMinor).toBe(292_500);
      expect(payout.settlementCurrency).toBe('SSP');
    });
  });

  // ------------------------------------------------------------------
  describe('a run groups by business AND settlement currency', () => {
    const payouts = () => moduleRef.get(PayoutsService);

    const entry = (
      businessId: string,
      settlementCurrency: string | null,
      settlementAmountMinor: number | null,
    ) =>
      prisma.ledgerEntry.create({
        data: {
          businessId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountCents: 1000,
          currency: 'USD',
          settlementCurrency,
          settlementAmountMinor,
          availableAt: new Date(Date.now() - DAY),
        },
      });

    it('never mixes two settlement currencies in one payout', async () => {
      const shop = await createBusiness(prisma);
      await entry(shop.businessId, 'SSP', 100_000);
      await entry(shop.businessId, 'EUR', 5_000);

      await payouts().run();

      const created = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
        orderBy: { settlementCurrency: 'asc' },
      });
      // Two payouts, not one summing figures that share no unit.
      expect(created).toHaveLength(2);
      expect(created.map((p) => p.settlementCurrency)).toEqual(['EUR', 'SSP']);
      expect(created.map((p) => p.settlementAmountMinor)).toEqual([5_000, 100_000]);
    });

    it('excludes and REPORTS entries with no settlement amount', async () => {
      const shop = await createBusiness(prisma);
      await entry(shop.businessId, 'SSP', 100_000);
      await entry(shop.businessId, null, null);

      const summary = await payouts().run();

      expect(summary.entriesWithoutSettlement).toBeGreaterThanOrEqual(1);
      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      // The unpayable entry is not silently folded in at today's rate.
      expect(payout.settlementAmountMinor).toBe(100_000);
      const orphan = await prisma.ledgerEntry.findFirst({
        where: { businessId: shop.businessId, settlementAmountMinor: null },
      });
      expect(orphan!.payoutId).toBeNull();
    });

    it('carries a negative balance forward in settlement currency', async () => {
      const shop = await createBusiness(prisma);
      await entry(shop.businessId, 'SSP', -20_000);

      const first = await payouts().run();
      expect(
        await prisma.payout.count({ where: { businessId: shop.businessId } }),
      ).toBe(0);

      await entry(shop.businessId, 'SSP', 50_000);
      await payouts().run();

      const [payout] = await prisma.payout.findMany({
        where: { businessId: shop.businessId },
      });
      // 50 000 − 20 000, netted in the currency the money is actually in.
      expect(first.payoutsCreated).toBe(0);
      expect(payout.settlementAmountMinor).toBe(30_000);
    });

    it('still skips a suspended business (§42.4)', async () => {
      const shop = await createBusiness(prisma);
      await entry(shop.businessId, 'SSP', 100_000);
      await prisma.businessProfile.update({
        where: { id: shop.businessId },
        data: { status: BusinessStatus.SUSPENDED },
      });

      const summary = await payouts().run();

      expect(summary.pausedForSuspension).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.payout.count({ where: { businessId: shop.businessId } }),
      ).toBe(0);
    });
  });
});
