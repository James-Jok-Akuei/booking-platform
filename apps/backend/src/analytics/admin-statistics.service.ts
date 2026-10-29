import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { CountriesService } from '../countries/countries.service';
import { localTime } from '../countries/local-time';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type {
  StatisticsBucketDto,
  StatisticsCohortDto,
  StatisticsLeftOutDto,
  StatisticsMoneyCheckDto,
  StatisticsMonthDto,
  StatisticsMonthsDto,
  StatisticsMonthsQueryDto,
  StatisticsPeriodDto,
  StatisticsPeriodQueryDto,
  StatisticsScopeQueryDto,
  StatisticsSliceDto,
  StatisticsSummaryDto,
  StatisticsTopShopDto,
  StatisticsTotalsDto,
  TestMarkDto,
} from './dto/admin-statistics.dto';
import {
  BOOKINGS,
  FEES,
  FEES_KEPT,
  LIVE,
  PAID,
  bookingScope,
  branchScope,
  customerScope,
  dayOn,
  daysBetween,
  mondayOf,
  num,
  onDays,
  onShopDays,
  shiftDay,
  shiftMonth,
  shopDay,
  shopScope,
  type StatisticsScope,
} from './statistics-sql';

/** The longest stretch the page asks for: ten years. */
const MAX_DAYS = 3660;
/** Up to this many days the chart has a bar a day, then a week, then a month. */
const DAILY_UP_TO = 92;
const WEEKLY_UP_TO = 731;
const TOP = 10;

type Daily = {
  bookings: Map<string, { paid: bigint; priced: bigint; value: bigint; done: bigint; deposits: bigint }>;
  fees: Map<string, bigint>;
  customers: Map<string, bigint>;
  shops: Map<string, bigint>;
};

/**
 * The console's statistics (§316): the whole platform added up, for pitching
 * and for seeing how the business is doing.
 *
 * Every figure is counted by the database from the records themselves. The
 * rules, kept the same everywhere on the page:
 *
 * - A booking counts on the day its deposit was paid, on its shop's clock
 *   (§315) — that is when it became real; an unpaid hold never counts.
 * - Its value is its full agreed price (the deposit and the rest paid at the
 *   shop, choices and sale included, §186/§300), and a cancelled booking has
 *   none.
 * - Fees kept are the ledger's: taken less handed back (`FEES`).
 * - Customers belong to no country or category, so sign-ups are the whole
 *   platform's, on the chosen country's clock (the default's when none is).
 * - Test shops and test customers, and everything they did, are left out
 *   unless asked for (§316). The money book, payouts and the wallet check
 *   never leave anything out; only these numbers do.
 */
@Injectable()
export class AdminStatisticsService {
  private readonly logger = new Logger(AdminStatisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
  ) {}

  // -------------------------------------------------------------------------
  // All time

  async summary(actor: AuthenticatedUser, query: StatisticsScopeQueryDto): Promise<StatisticsSummaryDto> {
    this.assertAdmin(actor);
    const s = await this.scopeOf(query);
    const scope = bookingScope(s);

    const [[bookings], [cameBack], [made], customers, [shops], [branches], rating, languages, leftOutShops, leftOutCustomers, check] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ paid: bigint; value: bigint; deposits: bigint; customers: bigint; first: string | null }>>`
          SELECT COUNT(*)::bigint AS paid,
                 COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value,
                 COALESCE(SUM(a."depositAmountMinor"), 0)::bigint AS deposits,
                 COUNT(DISTINCT a."customerId")::bigint AS customers,
                 to_char(MIN(${shopDay('a."depositPaidAt"')}), 'YYYY-MM-DD') AS first
          ${BOOKINGS}
          WHERE TRUE ${PAID} ${scope}`,
        this.prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT COUNT(*)::bigint AS n FROM (
            SELECT a."customerId" ${BOOKINGS}
            WHERE TRUE ${PAID} ${scope}
            GROUP BY a."customerId" HAVING COUNT(*) >= 2
          ) twice`,
        this.prisma.$queryRaw<Array<{ minor: bigint }>>`SELECT ${FEES_KEPT} AS minor ${FEES} ${scope}`,
        this.prisma.user.count({
          where: { role: UserRole.CUSTOMER, closedAt: null, ...(s.includeTest ? {} : { isTest: false }) },
        }),
        this.prisma.$queryRaw<Array<{ n: bigint; categories: bigint }>>`
          SELECT COUNT(*)::bigint AS n, COUNT(DISTINCT b."categoryId")::bigint AS categories
          FROM "business_profiles" b
          WHERE TRUE ${LIVE} ${shopScope(s)}`,
        this.prisma.$queryRaw<Array<{ n: bigint; areas: bigint }>>`
          SELECT COUNT(*)::bigint AS n, COUNT(DISTINCT l."districtId")::bigint AS areas
          FROM "locations" l JOIN "business_profiles" b ON b."id" = l."businessId"
          WHERE l."isActive" ${LIVE} ${branchScope(s)}`,
        this.rating(s, null),
        this.prisma.user.groupBy({
          by: ['locale'],
          where: { role: UserRole.CUSTOMER, closedAt: null, ...(s.includeTest ? {} : { isTest: false }) },
          _count: { _all: true },
        }),
        this.prisma.businessProfile.count({ where: { isTest: true } }),
        this.prisma.user.count({ where: { isTest: true, role: UserRole.CUSTOMER } }),
        this.check(s, null),
      ]);

    return {
      asOf: new Date().toISOString(),
      currency: INTERNAL_CURRENCY,
      since: bookings.first,
      madeMinor: num(made.minor),
      bookings: num(bookings.paid),
      bookingValueMinor: num(bookings.value),
      depositsMinor: num(bookings.deposits),
      customers,
      customersWhoBooked: num(bookings.customers),
      cameBack: num(cameBack.n),
      liveShops: num(shops.n),
      openBranches: num(branches.n),
      areas: num(branches.areas),
      categories: num(shops.categories),
      rating,
      languages: languages
        .map((row) => ({ key: row.locale, count: row._count._all }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      leftOut: { shops: leftOutShops, customers: leftOutCustomers },
      check,
    };
  }

  // -------------------------------------------------------------------------
  // A stretch of time

  async period(actor: AuthenticatedUser, query: StatisticsPeriodQueryDto): Promise<StatisticsPeriodDto> {
    this.assertAdmin(actor);
    const s = await this.scopeOf(query);
    const zone = await this.zoneOf(s);
    const today = localTime(new Date(), zone).date;

    const to = query.to ?? today;
    const compared = query.from !== undefined;
    const from = query.from ?? (await this.firstDay(s, zone)) ?? to;
    if (from > to) throw new BadRequestException('The first day is after the last one.');
    const days = daysBetween(from, to);
    if (days > MAX_DAYS) throw new BadRequestException('Choose ten years or less.');
    const bucket = days <= DAILY_UP_TO ? 'day' : days <= WEEKLY_UP_TO ? 'week' : 'month';
    const before = compared ? { from: shiftDay(from, -days), to: shiftDay(from, -1) } : null;

    const [daily, booked, previousDaily, previousBooked, bookings, customers, shops, wants, check] = await Promise.all([
      this.daily(s, zone, from, to),
      this.customersBooked(s, from, to),
      before ? this.daily(s, zone, before.from, before.to) : null,
      before ? this.customersBooked(s, before.from, before.to) : null,
      this.bookingsDetail(s, from, to),
      this.customersDetail(s, zone, from, to),
      this.shopsDetail(s, from, to),
      this.wants(s, zone, from, to),
      this.check(s, { from, to }),
    ]);

    return {
      asOf: new Date().toISOString(),
      currency: INTERNAL_CURRENCY,
      from,
      to,
      days,
      bucket,
      compared,
      totals: totalsOf(daily, booked),
      previous: previousDaily && previousBooked !== null ? totalsOf(previousDaily, previousBooked) : null,
      series: seriesOf(daily, from, to, bucket),
      previousSeries: previousDaily && before ? seriesOf(previousDaily, before.from, before.to, bucket) : null,
      bookings,
      customers,
      shops,
      wants,
      check,
    };
  }

  /** Each day's bookings, fees, sign-ups and shops that went live. */
  private async daily(s: StatisticsScope, zone: string, from: string, to: string): Promise<Daily> {
    const [bookings, fees, customers, shops] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: string; paid: bigint; priced: bigint; value: bigint; done: bigint; deposits: bigint }>>`
        SELECT to_char(${shopDay('a."depositPaidAt"')}, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS paid,
               COUNT(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED')::bigint AS priced,
               COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value,
               COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" = 'COMPLETED'), 0)::bigint AS done,
               COALESCE(SUM(a."depositAmountMinor"), 0)::bigint AS deposits
        ${BOOKINGS}
        WHERE TRUE ${onShopDays('a."depositPaidAt"', from, to)} ${bookingScope(s)}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: string; minor: bigint }>>`
        SELECT to_char(${shopDay('e."createdAt"')}, 'YYYY-MM-DD') AS day, ${FEES_KEPT} AS minor
        ${FEES} ${onShopDays('e."createdAt"', from, to)} ${bookingScope(s)}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
        SELECT to_char(${dayOn('u."createdAt"', zone)}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS n
        FROM "users" u
        WHERE u."role" = 'CUSTOMER' ${onDays('u."createdAt"', zone, from, to)} ${customerScope(s)}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
        SELECT to_char(${shopDay('b."publishedAt"')}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS n
        FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode"
        WHERE TRUE ${onShopDays('b."publishedAt"', from, to)} ${shopScope(s)}
        GROUP BY 1`,
    ]);
    return {
      bookings: new Map(bookings.map((r) => [r.day, r])),
      fees: new Map(fees.map((r) => [r.day, r.minor])),
      customers: new Map(customers.map((r) => [r.day, r.n])),
      shops: new Map(shops.map((r) => [r.day, r.n])),
    };
  }

  /** Customers with at least one paid booking in the stretch. */
  private async customersBooked(s: StatisticsScope, from: string, to: string) {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT a."customerId")::bigint AS n
      ${BOOKINGS}
      WHERE TRUE ${onShopDays('a."depositPaidAt"', from, to)} ${bookingScope(s)}`;
    return num(row.n);
  }

  private async bookingsDetail(s: StatisticsScope, from: string, to: string): Promise<StatisticsPeriodDto['bookings']> {
    const paidIn = Prisma.sql`${onShopDays('a."depositPaidAt"', from, to)} ${bookingScope(s)}`;
    const [outcomes, [started], lead, heat, [refunds], [payouts]] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: string; by: string | null; n: bigint }>>`
        SELECT a."status"::text AS status, a."cancelledBy"::text AS by, COUNT(*)::bigint AS n
        ${BOOKINGS} WHERE TRUE ${paidIn}
        GROUP BY 1, 2`,
      // Started in the stretch, paid or not: how many who began a booking paid for it.
      this.prisma.$queryRaw<Array<{ started: bigint; paid: bigint }>>`
        SELECT COUNT(*)::bigint AS started, COUNT(a."depositPaidAt")::bigint AS paid
        ${BOOKINGS}
        WHERE TRUE ${onShopDays('a."createdAt"', from, to)} ${bookingScope(s)}`,
      // How far ahead: the visit's day against the day it was paid, both on the shop's clock.
      this.prisma.$queryRaw<Array<{ gap: string; n: bigint }>>`
        SELECT CASE
                 WHEN ${shopDay('a."startTime"')} - ${shopDay('a."depositPaidAt"')} <= 0 THEN 'sameDay'
                 WHEN ${shopDay('a."startTime"')} - ${shopDay('a."depositPaidAt"')} = 1 THEN 'nextDay'
                 WHEN ${shopDay('a."startTime"')} - ${shopDay('a."depositPaidAt"')} <= 7 THEN 'withinWeek'
                 ELSE 'later'
               END AS gap,
               COUNT(*)::bigint AS n
        ${BOOKINGS} WHERE TRUE ${paidIn}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ weekday: number; hour: number; n: bigint }>>`
        SELECT EXTRACT(ISODOW FROM (a."startTime" AT TIME ZONE 'UTC' AT TIME ZONE c."timeZone"))::int AS weekday,
               EXTRACT(HOUR FROM (a."startTime" AT TIME ZONE 'UTC' AT TIME ZONE c."timeZone"))::int AS hour,
               COUNT(*)::bigint AS n
        ${BOOKINGS} WHERE a."status" <> 'CANCELLED' ${paidIn}
        GROUP BY 1, 2`,
      // Refunds that reached the customer (§313), in the platform's money.
      this.prisma.$queryRaw<Array<{ n: bigint; minor: bigint }>>`
        SELECT COUNT(*)::bigint AS n, COALESCE(SUM(r."amountMinor"), 0)::bigint AS minor
        FROM "refunds" r
        JOIN "appointments" a ON a."id" = r."appointmentId"
        JOIN "locations" l ON l."id" = a."locationId"
        JOIN "business_profiles" b ON b."id" = l."businessId"
        JOIN "countries" c ON c."code" = b."countryCode"
        JOIN "users" u ON u."id" = a."customerId"
        WHERE r."status" = 'SENT' AND r."currency" = ${INTERNAL_CURRENCY}
          ${onShopDays('COALESCE(r."doneAt", r."updatedAt")', from, to)} ${bookingScope(s)}`,
      // Payouts that reached shops. A payout is a whole shop's, so a district does not narrow it.
      this.prisma.$queryRaw<Array<{ n: bigint; minor: bigint }>>`
        SELECT COUNT(*)::bigint AS n, COALESCE(SUM(p."amountMinor"), 0)::bigint AS minor
        FROM "payouts" p
        JOIN "business_profiles" b ON b."id" = p."businessId"
        JOIN "countries" c ON c."code" = b."countryCode"
        WHERE p."status" = 'PAID' AND p."currency" = ${INTERNAL_CURRENCY}
          ${onShopDays('p."paidAt"', from, to)} ${shopScope({ ...s, district: undefined })}`,
    ]);

    const count = (status: string, by?: string | null) =>
      outcomes.filter((o) => o.status === status && (by === undefined || o.by === by)).reduce((sum, o) => sum + num(o.n), 0);
    const cancelled = count('CANCELLED');
    const byCustomer = count('CANCELLED', 'CUSTOMER');
    const byShop = count('CANCELLED', 'BUSINESS');
    const gap = (key: string) => num(lead.find((l) => l.gap === key)?.n);

    return {
      outcomes: {
        done: count('COMPLETED'),
        missed: count('NO_SHOW'),
        cancelledByCustomer: byCustomer,
        cancelledByShop: byShop,
        cancelledOther: cancelled - byCustomer - byShop,
        upcoming: count('BOOKED') + count('IN_PROGRESS'),
      },
      started: num(started.started),
      startedPaid: num(started.paid),
      leadTime: { sameDay: gap('sameDay'), nextDay: gap('nextDay'), withinWeek: gap('withinWeek'), later: gap('later') },
      heat: heat.map((h) => ({ weekday: h.weekday, hour: h.hour, count: num(h.n) })),
      refunds: num(refunds.n),
      refundsMinor: num(refunds.minor),
      payouts: num(payouts.n),
      payoutsMinor: num(payouts.minor),
    };
  }

  private async customersDetail(s: StatisticsScope, zone: string, from: string, to: string): Promise<StatisticsPeriodDto['customers']> {
    const scope = bookingScope(s);
    const dayBefore = shiftDay(from, -1);
    const [[split], [joined], [follows]] = await Promise.all([
      // Of the customers who booked in the stretch, those who had booked before it.
      this.prisma.$queryRaw<Array<{ booked: bigint; returning: bigint; paid: bigint }>>`
        WITH inside AS (
          SELECT a."customerId" AS id, COUNT(*)::bigint AS paid
          ${BOOKINGS}
          WHERE TRUE ${onShopDays('a."depositPaidAt"', from, to)} ${scope}
          GROUP BY 1
        ), earlier AS (
          SELECT DISTINCT a."customerId" AS id
          ${BOOKINGS}
          WHERE TRUE ${PAID} AND ${shopDay('a."depositPaidAt"')} <= ${dayBefore}::date ${scope}
        )
        SELECT COUNT(*)::bigint AS booked,
               COUNT(*) FILTER (WHERE inside.id IN (SELECT id FROM earlier))::bigint AS returning,
               COALESCE(SUM(inside.paid), 0)::bigint AS paid
        FROM inside`,
      // Accounts opened in the stretch that have paid for a booking since — the whole platform, like sign-ups.
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n
        FROM "users" u
        WHERE u."role" = 'CUSTOMER' ${onDays('u."createdAt"', zone, from, to)} ${customerScope(s)}
          AND EXISTS (SELECT 1 FROM "appointments" a WHERE a."customerId" = u."id" AND a."depositPaidAt" IS NOT NULL)`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n
        FROM "shop_follows" f
        JOIN "business_profiles" b ON b."id" = f."businessId"
        JOIN "countries" c ON c."code" = b."countryCode"
        JOIN "users" u ON u."id" = f."userId"
        WHERE TRUE ${onShopDays('f."createdAt"', from, to)} ${shopScope(s)} ${customerScope(s)}`,
    ]);
    const booked = num(split.booked);
    return {
      firstTime: booked - num(split.returning),
      returning: num(split.returning),
      bookingsPerCustomer: booked ? Math.round((num(split.paid) / booked) * 100) / 100 : null,
      joinedAndBooked: num(joined.n),
      follows: num(follows.n),
    };
  }

  private async shopsDetail(s: StatisticsScope, from: string, to: string): Promise<StatisticsPeriodDto['shops']> {
    const scope = shopScope(s);
    const paidIn = Prisma.sql`${onShopDays('a."depositPaidAt"', from, to)} ${bookingScope(s)}`;
    const [[joined], [applied], [withBookings], [now], [median], top, categories, liveByCategory, districts, liveByDistrict] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode"
        WHERE TRUE ${onShopDays('b."createdAt"', from, to)} ${scope}`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode"
        WHERE TRUE ${onShopDays('b."submittedAt"', from, to)} ${scope}`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT b."id")::bigint AS n ${BOOKINGS} WHERE TRUE ${paidIn}`,
      this.prisma.$queryRaw<Array<{ live: bigint; paused: bigint; suspended: bigint }>>`
        SELECT COUNT(*) FILTER (WHERE b."status" = 'APPROVED' AND b."publishedAt" IS NOT NULL AND b."pausedAt" IS NULL)::bigint AS live,
               COUNT(*) FILTER (WHERE b."status" = 'APPROVED' AND b."publishedAt" IS NOT NULL AND b."pausedAt" IS NOT NULL)::bigint AS paused,
               COUNT(*) FILTER (WHERE b."status" = 'SUSPENDED')::bigint AS suspended
        FROM "business_profiles" b WHERE TRUE ${scope}`,
      this.prisma.$queryRaw<Array<{ days: number | null }>>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (b."publishedAt" - b."createdAt")) / 86400)::float AS days
        FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode"
        WHERE TRUE ${onShopDays('b."publishedAt"', from, to)} ${scope}`,
      this.prisma.$queryRaw<Array<{ id: string; name: string | null; category: string | null; bookings: bigint; value: bigint; rating: number | null; by_bookings: bigint; by_value: bigint }>>`
        WITH booked AS (
          SELECT b."id", b."name", cat."name" AS category,
                 COUNT(*)::bigint AS bookings,
                 COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value
          ${BOOKINGS}
          LEFT JOIN "categories" cat ON cat."id" = b."categoryId"
          WHERE TRUE ${paidIn}
          GROUP BY b."id", b."name", cat."name"
        ), ranked AS (
          SELECT booked.*,
                 ROW_NUMBER() OVER (ORDER BY bookings DESC, value DESC, name) AS by_bookings,
                 ROW_NUMBER() OVER (ORDER BY value DESC, bookings DESC, name) AS by_value
          FROM booked
        )
        SELECT ranked.*,
               (SELECT ROUND(AVG(rv."rating")::numeric, 2)::float FROM "reviews" rv WHERE rv."businessId" = ranked."id" AND rv."hiddenAt" IS NULL) AS rating
        FROM ranked
        WHERE by_bookings <= ${TOP} OR by_value <= ${TOP}`,
      this.prisma.$queryRaw<Array<{ id: string | null; name: string | null; bookings: bigint; value: bigint }>>`
        SELECT b."categoryId" AS id, cat."name" AS name, COUNT(*)::bigint AS bookings,
               COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value
        ${BOOKINGS}
        LEFT JOIN "categories" cat ON cat."id" = b."categoryId"
        WHERE TRUE ${paidIn}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ id: string | null; name: string | null; n: bigint }>>`
        SELECT b."categoryId" AS id, cat."name" AS name, COUNT(*)::bigint AS n
        FROM "business_profiles" b LEFT JOIN "categories" cat ON cat."id" = b."categoryId"
        WHERE TRUE ${LIVE} ${scope}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ id: string | null; name: string | null; bookings: bigint; value: bigint }>>`
        SELECT l."districtId" AS id, d."name" AS name, COUNT(*)::bigint AS bookings,
               COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value
        ${BOOKINGS}
        LEFT JOIN "districts" d ON d."id" = l."districtId"
        WHERE TRUE ${paidIn}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ id: string | null; name: string | null; n: bigint }>>`
        SELECT l."districtId" AS id, d."name" AS name, COUNT(DISTINCT b."id")::bigint AS n
        FROM "locations" l
        JOIN "business_profiles" b ON b."id" = l."businessId"
        LEFT JOIN "districts" d ON d."id" = l."districtId"
        WHERE l."isActive" ${LIVE} ${branchScope(s)}
        GROUP BY 1, 2`,
    ]);

    const shop = (r: (typeof top)[number]): StatisticsTopShopDto => ({
      id: r.id,
      name: r.name,
      category: r.category,
      bookings: num(r.bookings),
      bookingValueMinor: num(r.value),
      rating: r.rating === null ? null : Number(r.rating),
    });

    return {
      joined: num(joined.n),
      applied: num(applied.n),
      withBookings: num(withBookings.n),
      liveNow: num(now.live),
      pausedNow: num(now.paused),
      suspendedNow: num(now.suspended),
      medianDaysToLive: median.days === null ? null : Math.round(Number(median.days) * 10) / 10,
      topByBookings: top.filter((r) => num(r.by_bookings) <= TOP).sort((a, b) => num(a.by_bookings) - num(b.by_bookings)).map(shop),
      topByValue: top
        .filter((r) => num(r.by_value) <= TOP && num(r.value) > 0)
        .sort((a, b) => num(a.by_value) - num(b.by_value))
        .map(shop),
      byCategory: slices(categories, liveByCategory, 'Without a category'),
      byDistrict: slices(districts, liveByDistrict, 'No district given').slice(0, 12),
    };
  }

  private async wants(s: StatisticsScope, zone: string, from: string, to: string): Promise<StatisticsPeriodDto['wants']> {
    const paidIn = Prisma.sql`${onShopDays('a."depositPaidAt"', from, to)} ${bookingScope(s)}`;
    const defaultCode = (await this.countries.defaultCountry()).code;
    // A search is the whole platform's unless it named a place (§170); one
    // that named none was made where the app is offered, the default country.
    const searchScope = Prisma.sql`
      ${
        s.country
          ? s.country === defaultCode
            ? Prisma.sql`AND (p."countryCode" = ${s.country} OR q."districtId" IS NULL)`
            : Prisma.sql`AND p."countryCode" = ${s.country}`
          : Prisma.empty
      }
      ${s.district ? Prisma.sql`AND q."districtId" = ${s.district}` : Prisma.empty}`;
    const searches = Prisma.sql`
      FROM "search_queries" q
      LEFT JOIN "districts" d ON d."id" = q."districtId"
      LEFT JOIN "provinces" p ON p."id" = d."provinceId"
      WHERE TRUE ${onDays('q."createdAt"', zone, from, to)} ${searchScope}`;

    const [services, [counts], top, emptyTop, reviews] = await Promise.all([
      this.prisma.$queryRaw<Array<{ name: string; bookings: bigint; shops: bigint }>>`
        SELECT mode() WITHIN GROUP (ORDER BY btrim(sv."name")) AS name,
               COUNT(*)::bigint AS bookings,
               COUNT(DISTINCT b."id")::bigint AS shops
        ${BOOKINGS}
        JOIN "services" sv ON sv."id" = a."serviceId"
        WHERE TRUE ${paidIn}
        GROUP BY lower(btrim(sv."name"))
        ORDER BY 2 DESC, 1
        LIMIT ${TOP}`,
      this.prisma.$queryRaw<Array<{ total: bigint; empty: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE q."results" = 0)::bigint AS empty ${searches}`,
      this.prisma.$queryRaw<Array<{ term: string; n: bigint }>>`
        SELECT q."term" AS term, COUNT(*)::bigint AS n ${searches} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP}`,
      this.prisma.$queryRaw<Array<{ term: string; n: bigint }>>`
        SELECT q."term" AS term, COUNT(*)::bigint AS n ${searches} AND q."results" = 0 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP}`,
      this.rating(s, { from, to }),
    ]);

    return {
      topServices: services.map((r) => ({ name: r.name, bookings: num(r.bookings), shops: num(r.shops) })),
      searches: {
        total: num(counts.total),
        empty: num(counts.empty),
        top: top.map((r) => ({ term: r.term, count: num(r.n) })),
        emptyTop: emptyTop.map((r) => ({ term: r.term, count: num(r.n) })),
      },
      reviews,
    };
  }

  // -------------------------------------------------------------------------
  // Month by month

  async months(actor: AuthenticatedUser, query: StatisticsMonthsQueryDto): Promise<StatisticsMonthsDto> {
    this.assertAdmin(actor);
    const s = await this.scopeOf(query);
    const zone = await this.zoneOf(s);
    const today = localTime(new Date(), zone).date;
    const thisMonth = today.slice(0, 7);

    // The months asked for, from the first that had anything in it.
    const first = (await this.firstDay(s, zone))?.slice(0, 7) ?? thisMonth;
    let start = shiftMonth(thisMonth, -((query.months ?? 12) - 1));
    if (first > start) start = first;
    const months: string[] = [];
    for (let m = start; m <= thisMonth; m = shiftMonth(m, 1)) months.push(m);
    const from = `${start}-01`;
    const scope = bookingScope(s);

    const [bookings, fees, customers, shops, cohorts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ month: string; paid: bigint; value: bigint; deposits: bigint; active: bigint }>>`
        SELECT to_char(${shopDay('a."depositPaidAt"')}, 'YYYY-MM') AS month,
               COUNT(*)::bigint AS paid,
               COALESCE(SUM(a."servicePriceMinor") FILTER (WHERE a."status" <> 'CANCELLED'), 0)::bigint AS value,
               COALESCE(SUM(a."depositAmountMinor"), 0)::bigint AS deposits,
               COUNT(DISTINCT a."customerId")::bigint AS active
        ${BOOKINGS}
        WHERE TRUE ${onShopDays('a."depositPaidAt"', from, today)} ${scope}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ month: string; minor: bigint }>>`
        SELECT to_char(${shopDay('e."createdAt"')}, 'YYYY-MM') AS month, ${FEES_KEPT} AS minor
        ${FEES} ${onShopDays('e."createdAt"', from, today)} ${scope}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ month: string; n: bigint }>>`
        SELECT to_char(${dayOn('u."createdAt"', zone)}, 'YYYY-MM') AS month, COUNT(*)::bigint AS n
        FROM "users" u
        WHERE u."role" = 'CUSTOMER' ${onDays('u."createdAt"', zone, from, today)} ${customerScope(s)}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ month: string; n: bigint }>>`
        SELECT to_char(${shopDay('b."publishedAt"')}, 'YYYY-MM') AS month, COUNT(*)::bigint AS n
        FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode"
        WHERE TRUE ${onShopDays('b."publishedAt"', from, today)} ${shopScope(s)}
        GROUP BY 1`,
      // Each customer's first month with a paid booking, and every month they had one.
      this.prisma.$queryRaw<Array<{ first: string; month: string; n: bigint }>>`
        WITH paid AS (
          SELECT a."customerId" AS id, to_char(${shopDay('a."depositPaidAt"')}, 'YYYY-MM') AS month
          ${BOOKINGS}
          WHERE TRUE ${PAID} ${scope}
        ), firsts AS (
          SELECT id, MIN(month) AS first FROM paid GROUP BY id
        )
        SELECT firsts.first, paid.month, COUNT(DISTINCT paid.id)::bigint AS n
        FROM firsts JOIN paid ON paid.id = firsts.id
        WHERE firsts.first >= ${start}
        GROUP BY 1, 2`,
    ]);

    const by = <T extends { month: string }>(rows: T[]) => new Map(rows.map((r) => [r.month, r]));
    const b = by(bookings);
    const f = by(fees);
    const c = by(customers);
    const sh = by(shops);

    const rows: StatisticsMonthDto[] = months.map((month) => ({
      month,
      bookings: num(b.get(month)?.paid),
      bookingValueMinor: num(b.get(month)?.value),
      depositsMinor: num(b.get(month)?.deposits),
      feesKeptMinor: num(f.get(month)?.minor),
      newCustomers: num(c.get(month)?.n),
      shopsWentLive: num(sh.get(month)?.n),
      activeCustomers: num(b.get(month)?.active),
    }));

    const cohortRows: StatisticsCohortDto[] = months.map((month) => {
      const of = cohorts.filter((r) => r.first === month);
      const back: number[] = [];
      for (let m = shiftMonth(month, 1); m <= thisMonth; m = shiftMonth(m, 1)) {
        back.push(num(of.find((r) => r.month === m)?.n));
      }
      return { month, customers: num(of.find((r) => r.month === month)?.n), back };
    });

    return { asOf: new Date().toISOString(), currency: INTERNAL_CURRENCY, months: rows, cohorts: cohortRows };
  }

  // -------------------------------------------------------------------------
  // Test accounts (§316)

  async leftOut(actor: AuthenticatedUser): Promise<StatisticsLeftOutDto> {
    this.assertAdmin(actor);
    const [shops, customers] = await Promise.all([
      this.prisma.businessProfile.findMany({
        where: { isTest: true },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        take: 500,
        select: { id: true, name: true, testMarkedAt: true, testMarkedBy: true },
      }),
      this.prisma.user.findMany({
        where: { isTest: true, role: UserRole.CUSTOMER },
        orderBy: { email: 'asc' },
        take: 500,
        select: { id: true, email: true, displayName: true, testMarkedAt: true, testMarkedBy: true },
      }),
    ]);
    return {
      shops: shops.map((b) => ({ id: b.id, name: b.name, markedAt: b.testMarkedAt?.toISOString() ?? null, markedBy: b.testMarkedBy })),
      customers: customers.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        markedAt: u.testMarkedAt?.toISOString() ?? null,
        markedBy: u.testMarkedBy,
      })),
    };
  }

  async markShop(actor: AuthenticatedUser, id: string, isTest: boolean): Promise<TestMarkDto> {
    this.assertAdmin(actor);
    const shop = await this.prisma.businessProfile.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!shop) throw new NotFoundException('Business not found.');
    const updated = await this.prisma.businessProfile.update({
      where: { id },
      data: { isTest, testMarkedAt: new Date(), testMarkedBy: actor.email },
      select: { id: true, isTest: true, testMarkedAt: true, testMarkedBy: true },
    });
    this.logger.log(`${shop.name ?? id} ${isTest ? 'marked as a test shop' : 'counted in the statistics again'} by ${actor.email}.`);
    return { id: updated.id, isTest: updated.isTest, markedAt: updated.testMarkedAt?.toISOString() ?? null, markedBy: updated.testMarkedBy };
  }

  async markCustomer(actor: AuthenticatedUser, id: string, isTest: boolean): Promise<TestMarkDto> {
    this.assertAdmin(actor);
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        'Only a customer account is marked here. A shop is marked on its own panel, and administrators are never counted.',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isTest, testMarkedAt: new Date(), testMarkedBy: actor.email },
      select: { id: true, isTest: true, testMarkedAt: true, testMarkedBy: true },
    });
    this.logger.log(`Customer ${id} ${isTest ? 'marked as a test account' : 'counted in the statistics again'} by ${actor.email}.`);
    return { id: updated.id, isTest: updated.isTest, markedAt: updated.testMarkedAt?.toISOString() ?? null, markedBy: updated.testMarkedBy };
  }

  // -------------------------------------------------------------------------
  // Shared

  /** Visible reviews' average and count, all time or written in a stretch. */
  private async rating(s: StatisticsScope, days: { from: string; to: string } | null) {
    const [row] = await this.prisma.$queryRaw<Array<{ average: number | null; n: bigint }>>`
      SELECT ROUND(AVG(r."rating")::numeric, 2)::float AS average, COUNT(*)::bigint AS n
      FROM "reviews" r
      JOIN "business_profiles" b ON b."id" = r."businessId"
      JOIN "countries" c ON c."code" = b."countryCode"
      JOIN "users" u ON u."id" = r."customerId"
      JOIN "locations" l ON l."id" = r."locationId"
      WHERE r."hiddenAt" IS NULL ${days ? onShopDays('r."createdAt"', days.from, days.to) : Prisma.empty} ${bookingScope(s)}`;
    return { average: row.average === null ? null : Number(row.average), count: num(row.n) };
  }

  /**
   * Whether the bookings and the money book agree, for the same paid bookings
   * (§316): each one's deposit and fee against the entries written for it.
   */
  private async check(s: StatisticsScope, days: { from: string; to: string } | null): Promise<StatisticsMoneyCheckDto> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ n: bigint; deposits: bigint; fees: bigint; ledger_deposits: bigint; ledger_fees: bigint; missing: bigint }>
    >`
      SELECT COUNT(*)::bigint AS n,
             COALESCE(SUM(a."depositAmountMinor"), 0)::bigint AS deposits,
             COALESCE(SUM(a."platformFeeAmountMinor"), 0)::bigint AS fees,
             COALESCE(SUM(dr.minor), 0)::bigint AS ledger_deposits,
             COALESCE(SUM(pf.minor), 0)::bigint AS ledger_fees,
             COUNT(*) FILTER (WHERE dr.minor IS NULL)::bigint AS missing
      ${BOOKINGS}
      LEFT JOIN LATERAL (
        SELECT SUM(e."amountMinor") AS minor FROM "ledger_entries" e
        WHERE e."appointmentId" = a."id" AND e."type" = 'DEPOSIT_RECEIVED'
      ) dr ON TRUE
      LEFT JOIN LATERAL (
        SELECT -SUM(e."amountMinor") AS minor FROM "ledger_entries" e
        WHERE e."appointmentId" = a."id" AND e."type" = 'PLATFORM_FEE'
      ) pf ON TRUE
      WHERE TRUE ${days ? onShopDays('a."depositPaidAt"', days.from, days.to) : PAID} ${bookingScope(s)}`;
    const result = {
      bookings: num(row.n),
      bookingDepositsMinor: num(row.deposits),
      ledgerDepositsMinor: num(row.ledger_deposits),
      bookingFeesMinor: num(row.fees),
      ledgerFeesMinor: num(row.ledger_fees),
      missingEntries: num(row.missing),
    };
    return {
      ok:
        result.missingEntries === 0 &&
        result.bookingDepositsMinor === result.ledgerDepositsMinor &&
        result.bookingFeesMinor === result.ledgerFeesMinor,
      ...result,
    };
  }

  /**
   * The first day anything happened in this part of the platform: a booking
   * paid, a shop joined, or — the whole platform's, like every sign-up — a
   * customer joined.
   */
  private async firstDay(s: StatisticsScope, zone: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ first: string | null }>>`
      SELECT to_char(LEAST(
        (SELECT MIN(${shopDay('a."depositPaidAt"')}) ${BOOKINGS} WHERE TRUE ${PAID} ${bookingScope(s)}),
        (SELECT MIN(${shopDay('b."createdAt"')}) FROM "business_profiles" b JOIN "countries" c ON c."code" = b."countryCode" WHERE TRUE ${shopScope(s)}),
        (SELECT MIN(${dayOn('u."createdAt"', zone)}) FROM "users" u WHERE u."role" = 'CUSTOMER' ${customerScope(s)})
      ), 'YYYY-MM-DD') AS first`;
    return row.first;
  }

  /** The clock for what belongs to no shop: the chosen country's, else the default's. */
  private async zoneOf(s: StatisticsScope) {
    return s.country ? (await this.countries.get(s.country)).timeZone : this.countries.platformZone();
  }

  private async scopeOf(query: StatisticsScopeQueryDto): Promise<StatisticsScope> {
    // An unknown country is said as one, rather than counted as nothing.
    if (query.country) await this.countries.get(query.country);
    return {
      country: query.country,
      category: query.category,
      district: query.district,
      includeTest: query.includeTest ?? false,
    };
  }

  private assertAdmin(actor: { role: string }) {
    // Asserted here as well as by the guard (§27.1).
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only an administrator can read the statistics.');
  }
}

/** A stretch's figures, added up from its days. */
function totalsOf(daily: Daily, customersBooked: number): StatisticsTotalsDto {
  let bookings = 0;
  let priced = 0;
  let value = 0;
  let done = 0;
  let deposits = 0;
  for (const row of daily.bookings.values()) {
    bookings += num(row.paid);
    priced += num(row.priced);
    value += num(row.value);
    done += num(row.done);
    deposits += num(row.deposits);
  }
  const sum = (map: Map<string, bigint>) => [...map.values()].reduce((total, v) => total + num(v), 0);
  return {
    bookings,
    bookingValueMinor: value,
    doneValueMinor: done,
    depositsMinor: deposits,
    feesKeptMinor: sum(daily.fees),
    averageBookingMinor: priced ? Math.round(value / priced) : null,
    averageDepositMinor: bookings ? Math.round(deposits / bookings) : null,
    newCustomers: sum(daily.customers),
    customersBooked,
    shopsWentLive: sum(daily.shops),
  };
}

/** The chart's bars: each day folded into its day, week (from Monday) or month. */
function seriesOf(daily: Daily, from: string, to: string, bucket: 'day' | 'week' | 'month'): StatisticsBucketDto[] {
  const keyOf = (day: string) => (bucket === 'day' ? day : bucket === 'week' ? mondayOf(day) : day.slice(0, 7));
  const out: StatisticsBucketDto[] = [];
  let key: string | null = null;
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    if (keyOf(day) !== key) {
      key = keyOf(day);
      out.push({ start: day, end: day, bookings: 0, bookingValueMinor: 0, depositsMinor: 0, feesKeptMinor: 0, newCustomers: 0, shopsWentLive: 0 });
    }
    const bar = out[out.length - 1];
    bar.end = day;
    const b = daily.bookings.get(day);
    bar.bookings += num(b?.paid);
    bar.bookingValueMinor += num(b?.value);
    bar.depositsMinor += num(b?.deposits);
    bar.feesKeptMinor += num(daily.fees.get(day));
    bar.newCustomers += num(daily.customers.get(day));
    bar.shopsWentLive += num(daily.shops.get(day));
  }
  return out;
}

/** Bookings by category or district, beside the live shops there, busiest first. */
function slices(
  booked: Array<{ id: string | null; name: string | null; bookings: bigint; value: bigint }>,
  live: Array<{ id: string | null; name: string | null; n: bigint }>,
  none: string,
): StatisticsSliceDto[] {
  const out = new Map<string, StatisticsSliceDto>();
  const at = (id: string | null, name: string | null) => {
    const key = id ?? '';
    if (!out.has(key)) out.set(key, { id, name: name ?? none, bookings: 0, bookingValueMinor: 0, liveShops: 0 });
    return out.get(key)!;
  };
  for (const row of booked) {
    const slice = at(row.id, row.name);
    slice.bookings += num(row.bookings);
    slice.bookingValueMinor += num(row.value);
  }
  for (const row of live) at(row.id, row.name).liveShops += num(row.n);
  return [...out.values()].sort(
    (a, b) => b.bookings - a.bookings || b.liveShops - a.liveShops || a.name.localeCompare(b.name),
  );
}
