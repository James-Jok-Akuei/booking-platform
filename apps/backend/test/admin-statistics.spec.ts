import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import {
  AppointmentStatus,
  BillingAdjustmentType,
  CancelledBy,
  LedgerEntryType,
  UserRole,
} from '@prisma/client';
import { AdminStatisticsService } from '../src/analytics/admin-statistics.service';
import { AdminOverviewService } from '../src/analytics/admin-overview.service';
import { shiftDay } from '../src/analytics/statistics-sql';
import { localTime } from '../src/countries/local-time';
import { PrismaService } from '../src/prisma/prisma.service';
import { isTestEmail } from '../src/users/test-accounts';
import type { AuthenticatedUser } from '../src/common/decorators/current-user.decorator';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAdmin, createAppointment, createBusiness, createCustomer } from './setup/factories';

const DAY = 86_400_000;
const KIGALI = 'Africa/Kigali';

/**
 * The console's statistics (§316): every figure counted from the records,
 * test accounts left out, days on each shop's clock, fees net of every fee
 * handed back, and the bookings checked against the money book.
 */
describe('The console statistics (§316)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let statistics: AdminStatisticsService;
  let overview: AdminOverviewService;
  let admin: AuthenticatedUser;
  let shop: TestBusiness;
  let testShop: TestBusiness;
  let c1: { userId: string };
  let c2: { userId: string };
  let testCustomer: { userId: string };
  let categoryId: string;
  let districtId: string;

  /** Kigali's today, and a day in the period. */
  const today = localTime(new Date(), KIGALI).date;
  const from = shiftDay(today, -29);
  /** A day three back, whose booking was paid half an hour after its midnight in Kigali — still the evening before in UTC. */
  const lateDay = shiftDay(today, -3);
  const lateAt = new Date(`${shiftDay(lateDay, -1)}T22:30:00.000Z`);

  /** A paid booking, with the two entries the ledger writes when a deposit lands (§34). */
  const paid = async (
    at: TestBusiness,
    customerId: string,
    options: { paidAt: Date; price: number; deposit: number; fee: number; status: AppointmentStatus; cancelledBy?: CancelledBy },
  ) => {
    const appointment = await createAppointment(prisma, { business: at, customerId, status: options.status });
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        depositPaidAt: options.paidAt,
        createdAt: options.paidAt,
        servicePriceMinor: options.price,
        depositAmountMinor: options.deposit,
        platformFeeAmountMinor: options.fee,
        businessAmountMinor: options.deposit - options.fee,
        currency: 'RWF',
        cancelledBy: options.cancelledBy ?? null,
      },
    });
    for (const [type, amount] of [
      [LedgerEntryType.DEPOSIT_RECEIVED, options.deposit],
      [LedgerEntryType.PLATFORM_FEE, -options.fee],
    ] as const) {
      await prisma.ledgerEntry.create({
        data: {
          businessId: at.businessId,
          appointmentId: appointment.id,
          type,
          amountMinor: amount,
          currency: 'RWF',
          settlementCurrency: 'RWF',
          settlementAmountMinor: amount,
          createdAt: options.paidAt,
        },
      });
    }
    return appointment;
  };

  beforeAll(async () => {
    moduleRef = await createTestModule([AdminStatisticsService, AdminOverviewService]);
    prisma = moduleRef.get(PrismaService);
    statistics = moduleRef.get(AdminStatisticsService);
    overview = moduleRef.get(AdminOverviewService);
    await resetDatabase(prisma);

    const a = await createAdmin(prisma);
    admin = { userId: a.userId, email: a.email, role: 'ADMIN' };

    categoryId = (await prisma.category.create({ data: { name: 'Statistics test category' } })).id;
    districtId = (await prisma.district.findFirstOrThrow({ where: { province: { countryCode: 'RW' } } })).id;

    shop = await createBusiness(prisma);
    await prisma.businessProfile.update({ where: { id: shop.businessId }, data: { categoryId } });
    await prisma.location.update({ where: { id: shop.locationId }, data: { districtId } });
    testShop = await createBusiness(prisma);
    await prisma.businessProfile.update({ where: { id: testShop.businessId }, data: { isTest: true } });

    c1 = await createCustomer(prisma);
    c2 = await createCustomer(prisma);
    testCustomer = await createCustomer(prisma);
    await prisma.user.update({ where: { id: testCustomer.userId }, data: { isTest: true } });

    const now = new Date();
    // In the thirty days: three real bookings.
    await paid(shop, c1.userId, { paidAt: now, price: 10_000, deposit: 2_000, fee: 200, status: AppointmentStatus.BOOKED });
    const done = await paid(shop, c1.userId, { paidAt: lateAt, price: 20_000, deposit: 4_000, fee: 400, status: AppointmentStatus.COMPLETED });
    const called = await paid(shop, c2.userId, {
      paidAt: new Date(now.getTime() - 5 * DAY),
      price: 5_000,
      deposit: 1_000,
      fee: 100,
      status: AppointmentStatus.CANCELLED,
      cancelledBy: CancelledBy.BUSINESS,
    });
    // The shop cancelled, so the fee went back (§25)…
    await prisma.ledgerEntry.create({
      data: {
        businessId: shop.businessId,
        appointmentId: called.id,
        type: LedgerEntryType.PLATFORM_FEE_REVERSAL,
        amountMinor: 100,
        currency: 'RWF',
        settlementCurrency: 'RWF',
        settlementAmountMinor: 100,
      },
    });
    // …and a fee refund was executed on the done one (§53).
    const adjustment = await prisma.billingAdjustment.create({
      data: {
        businessId: shop.businessId,
        appointmentId: done.id,
        type: BillingAdjustmentType.FEE_REFUND,
        amount: 50,
        reason: 'Goodwill',
        createdById: admin.userId,
        settledAt: now,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        businessId: shop.businessId,
        appointmentId: done.id,
        billingAdjustmentId: adjustment.id,
        type: LedgerEntryType.ADJUSTMENT,
        amountMinor: 50,
        currency: 'RWF',
        settlementCurrency: 'RWF',
        settlementAmountMinor: 50,
      },
    });
    // Forty days back: c2's first booking, in the thirty days before.
    await paid(shop, c2.userId, {
      paidAt: new Date(now.getTime() - 40 * DAY),
      price: 7_000,
      deposit: 1_400,
      fee: 140,
      status: AppointmentStatus.COMPLETED,
    });
    // Left out: a test customer at a real shop, and a real customer at a test shop.
    await paid(shop, testCustomer.userId, { paidAt: now, price: 99_000, deposit: 9_000, fee: 900, status: AppointmentStatus.BOOKED });
    await paid(testShop, c1.userId, { paidAt: now, price: 88_000, deposit: 8_000, fee: 800, status: AppointmentStatus.BOOKED });
    // Begun and never paid: started, not a booking.
    await createAppointment(prisma, { business: shop, customerId: c2.userId, status: AppointmentStatus.PENDING_PAYMENT });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  it('is for administrators only', async () => {
    const seller = { userId: shop.userId, email: 'x@test.local', role: 'BUSINESS' as const };
    await expect(statistics.summary(seller, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(statistics.period(seller, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(statistics.months(seller, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adds up the stretch: value of what was not cancelled, fees net of every fee handed back', async () => {
    const result = await statistics.period(admin, { from, to: today });
    expect(result).toMatchObject({ from, to: today, days: 30, bucket: 'day', compared: true, currency: 'RWF' });
    expect(result.totals).toEqual({
      bookings: 3,
      bookingValueMinor: 30_000,
      doneValueMinor: 20_000,
      depositsMinor: 7_000,
      // 200 + 400 + 100 taken, 100 handed back with the cancellation, 50 by the fee refund.
      feesKeptMinor: 550,
      averageBookingMinor: 15_000,
      averageDepositMinor: 2_333,
      newCustomers: 2,
      customersBooked: 2,
      shopsWentLive: 1,
    });
    expect(result.series).toHaveLength(30);
    expect(result.series.reduce((sum, bar) => sum + bar.bookings, 0)).toBe(3);
  });

  it('compares with the thirty days before', async () => {
    const { previous } = await statistics.period(admin, { from, to: today });
    expect(previous).toMatchObject({ bookings: 1, bookingValueMinor: 7_000, depositsMinor: 1_400, feesKeptMinor: 140 });
  });

  it('puts a booking on its shop’s day, not the server’s', async () => {
    const on = await statistics.period(admin, { from: lateDay, to: lateDay });
    const before = await statistics.period(admin, { from: shiftDay(lateDay, -1), to: shiftDay(lateDay, -1) });
    expect(on.totals.bookings).toBe(1);
    expect(before.totals.bookings).toBe(0);
  });

  it('says how bookings ended, how many paid, and who came back', async () => {
    const { bookings, customers } = await statistics.period(admin, { from, to: today });
    expect(bookings.outcomes).toEqual({ done: 1, missed: 0, cancelledByCustomer: 0, cancelledByShop: 1, cancelledOther: 0, upcoming: 1 });
    expect(bookings).toMatchObject({ started: 4, startedPaid: 3 });
    expect(bookings.heat.reduce((sum, cell) => sum + cell.count, 0)).toBe(2);
    // c2 had booked forty days back; c1 had not.
    expect(customers).toMatchObject({ firstTime: 1, returning: 1, bookingsPerCustomer: 1.5 });
  });

  it('ranks shops, and slices by category and district', async () => {
    const { shops } = await statistics.period(admin, { from, to: today });
    expect(shops.topByBookings.map((s) => s.id)).toEqual([shop.businessId]);
    expect(shops.byCategory[0]).toMatchObject({ id: categoryId, bookings: 3, bookingValueMinor: 30_000, liveShops: 1 });
    expect(shops.byDistrict[0]).toMatchObject({ id: districtId, bookings: 3 });
    expect(shops.liveNow).toBe(1);
  });

  it('gives the all-time numbers, with what the platform has made', async () => {
    const summary = await statistics.summary(admin, {});
    expect(summary).toMatchObject({
      bookings: 4,
      bookingValueMinor: 37_000,
      depositsMinor: 8_400,
      // 840 taken, 150 handed back.
      madeMinor: 690,
      customersWhoBooked: 2,
      cameBack: 2,
      liveShops: 1,
      leftOut: { shops: 1, customers: 1 },
    });
    expect(summary.check.ok).toBe(true);
  });

  it('counts test accounts only when asked', async () => {
    const all = await statistics.summary(admin, { includeTest: true });
    expect(all.bookings).toBe(6);
    expect(all.liveShops).toBe(2);
    const stretch = await statistics.period(admin, { from, to: today, includeTest: true });
    expect(stretch.totals.bookings).toBe(5);
  });

  it('narrows to a category, a district or a country', async () => {
    expect((await statistics.period(admin, { from, to: today, category: categoryId })).totals.bookings).toBe(3);
    expect((await statistics.period(admin, { from, to: today, district: districtId })).totals.bookings).toBe(3);
    expect((await statistics.period(admin, { from, to: today, country: 'RW' })).totals.bookings).toBe(3);
    const other = (await prisma.category.create({ data: { name: 'Statistics empty category' } })).id;
    expect((await statistics.period(admin, { from, to: today, category: other })).totals.bookings).toBe(0);
  });

  it('starts “since the beginning” at the first thing that happened, without comparing', async () => {
    const result = await statistics.period(admin, {});
    expect(result.compared).toBe(false);
    expect(result.previous).toBeNull();
    expect(result.from <= shiftDay(today, -39)).toBe(true);
    expect(result.totals.bookings).toBe(4);
  });

  it('refuses a stretch that ends before it starts', async () => {
    await expect(statistics.period(admin, { from: today, to: from })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('goes month by month, with how many came back', async () => {
    const result = await statistics.months(admin, { months: 3 });
    expect(result.months.reduce((sum, m) => sum + m.bookings, 0)).toBe(4);
    expect(result.months.reduce((sum, m) => sum + m.feesKeptMinor, 0)).toBe(690);
    expect(result.cohorts.reduce((sum, c) => sum + c.customers, 0)).toBe(2);
    expect(result.months[result.months.length - 1].month).toBe(today.slice(0, 7));
  });

  it('agrees with the overview, which leaves test accounts out too', async () => {
    const result = await overview.overview({ userId: admin.userId, role: UserRole.ADMIN });
    expect(result.thisWeek).toMatchObject({ bookings: 3, depositsMinor: 7_000, feesMinor: 550 });
    expect(result.totals).toMatchObject({ liveBusinesses: 1, customers: 2 });
  });

  it('marks and unmarks test accounts, saying who did', async () => {
    const marked = await statistics.markCustomer(admin, c1.userId, true);
    expect(marked).toMatchObject({ isTest: true, markedBy: admin.email });
    expect((await statistics.summary(admin, {})).bookings).toBe(2);
    expect((await statistics.leftOut(admin)).customers.map((c) => c.id)).toContain(c1.userId);
    await statistics.markCustomer(admin, c1.userId, false);
    expect((await statistics.summary(admin, {})).bookings).toBe(4);

    await statistics.markShop(admin, shop.businessId, true);
    expect((await statistics.summary(admin, {})).bookings).toBe(0);
    await statistics.markShop(admin, shop.businessId, false);

    await expect(statistics.markCustomer(admin, shop.userId, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('knows an address no real person holds', () => {
    expect(isTestEmail('demo-amal@example.com')).toBe(true);
    expect(isTestEmail('someone@shop.test')).toBe(true);
    expect(isTestEmail('amal@gmail.com')).toBe(false);
    // Where a closed account's address goes: a real person, once.
    expect(isTestEmail('closed-1234@closed.invalid')).toBe(false);
  });

  it('says so when the bookings and the money book disagree', async () => {
    const stray = await createAppointment(prisma, { business: shop, customerId: c2.userId, status: AppointmentStatus.BOOKED });
    await prisma.appointment.update({ where: { id: stray.id }, data: { depositPaidAt: new Date(), currency: 'RWF' } });
    const summary = await statistics.summary(admin, {});
    expect(summary.check).toMatchObject({ ok: false, missingEntries: 1 });
  });
});
