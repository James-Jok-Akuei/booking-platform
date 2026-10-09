import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessStatus,
  LedgerEntryType,
  PayoutDestinationStatus,
  PayoutStatus,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import type {
  AdminOverviewDto,
  OverviewDayDto,
  OverviewPeriodDto,
} from './dto/admin-overview.dto';
import { PUBLIC_BUSINESS } from '../business/business-status';

/** The chart's length; the two weeks compared are its halves. */
export const OVERVIEW_DAYS = 14;

type DayRow = { day: string; n: bigint; minor: bigint | null };

/** "2026-10-09" minus some days, as a date string — calendar arithmetic, no clock. */
const shiftDay = (ymd: string, by: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

/**
 * The admin console's home page (§243): everything waiting, the platform's
 * last fourteen days, and its size — counted by the database in one round
 * trip, so the page that says "nothing is waiting" is never guessing.
 *
 * Days are the platform's own (PLATFORM_TIMEZONE), so "today" is Kigali's
 * today, not the server's. A booking counts on the day its deposit was paid:
 * that is when it became real — an unpaid hold that lapses never counts.
 * Fees come from the ledger, so a fee handed back when a business cancelled
 * (§25) is not counted as earned.
 */
@Injectable()
export class AdminOverviewService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
  }

  async overview(actor: { userId: string; role: string }): Promise<AdminOverviewDto> {
    // Asserted here as well as by the guard (§27.1).
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can read the overview.');
    }

    // Today, in the platform's time zone, and the first day of the chart.
    const [{ today }] = await this.prisma.$queryRaw<Array<{ today: string }>>`
      SELECT to_char((now() AT TIME ZONE ${this.timeZone})::date, 'YYYY-MM-DD') AS today
    `;
    const days = Array.from({ length: OVERVIEW_DAYS }, (_, i) => shiftDay(today, i - (OVERVIEW_DAYS - 1)));
    // A day of slack before the chart's first midnight, whatever the zone's
    // offset; rows on days outside the chart are dropped below.
    const [y, m, d] = days[0].split('-').map(Number);
    const since = new Date(Date.UTC(y, m - 1, d) - 86_400_000);

    const [
      waiting,
      bookings,
      fees,
      businesses,
      customers,
      liveBusinesses,
      liveBranches,
      customerTotal,
    ] = await Promise.all([
      this.waiting(),
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(("depositPaidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::date, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS n,
               SUM("depositAmountMinor")::bigint AS minor
        FROM "appointments"
        WHERE "depositPaidAt" >= ${since}
        GROUP BY 1
      `,
      // PLATFORM_FEE is negative and its reversal positive (§34); their sum,
      // turned round, is what the platform kept.
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::date, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS n,
               (-SUM("amountMinor"))::bigint AS minor
        FROM "ledger_entries"
        WHERE "createdAt" >= ${since}
          AND "type" IN (${LedgerEntryType.PLATFORM_FEE}::"LedgerEntryType", ${LedgerEntryType.PLATFORM_FEE_REVERSAL}::"LedgerEntryType")
        GROUP BY 1
      `,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::date, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS n, NULL::bigint AS minor
        FROM "business_profiles"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::date, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS n, NULL::bigint AS minor
        FROM "users"
        WHERE "createdAt" >= ${since}
          AND "role" = ${UserRole.CUSTOMER}::"UserRole"
        GROUP BY 1
      `,
      this.prisma.businessProfile.count({
        where: PUBLIC_BUSINESS,
      }),
      this.prisma.location.count({
        where: { isActive: true, business: PUBLIC_BUSINESS },
      }),
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER, closedAt: null } }),
    ]);

    const byDay = (rows: DayRow[]) => new Map(rows.map((r) => [r.day, r]));
    const b = byDay(bookings);
    const f = byDay(fees);
    const nb = byDay(businesses);
    const nc = byDay(customers);
    const series: OverviewDayDto[] = days.map((day) => ({
      day,
      bookings: Number(b.get(day)?.n ?? 0),
      depositsMinor: Number(b.get(day)?.minor ?? 0),
      feesMinor: Number(f.get(day)?.minor ?? 0),
      newBusinesses: Number(nb.get(day)?.n ?? 0),
      newCustomers: Number(nc.get(day)?.n ?? 0),
    }));

    const add = (rows: OverviewDayDto[]): OverviewPeriodDto =>
      rows.reduce(
        (sum, d) => ({
          bookings: sum.bookings + d.bookings,
          depositsMinor: sum.depositsMinor + d.depositsMinor,
          feesMinor: sum.feesMinor + d.feesMinor,
          newBusinesses: sum.newBusinesses + d.newBusinesses,
          newCustomers: sum.newCustomers + d.newCustomers,
        }),
        { bookings: 0, depositsMinor: 0, feesMinor: 0, newBusinesses: 0, newCustomers: 0 },
      );

    return {
      asOf: new Date().toISOString(),
      timeZone: this.timeZone,
      currency: INTERNAL_CURRENCY,
      waiting,
      days: series,
      thisWeek: add(series.slice(OVERVIEW_DAYS - 7)),
      lastWeek: add(series.slice(0, OVERVIEW_DAYS - 7)),
      totals: { liveBusinesses, liveBranches, customers: customerTotal },
    };
  }

  /** The four queues, each with its oldest item's arrival. */
  private async waiting() {
    const [
      businesses,
      oldestBusiness,
      destinations,
      oldestDestination,
      payouts,
      oldestPayout,
      payoutSums,
      tickets,
      oldestTicket,
      unassigned,
    ] = await Promise.all([
      // Shops that have asked to be reviewed (§255) — one still setting up is
      // not waiting on anyone, and is counted from when it asked.
      this.prisma.businessProfile.count({ where: { status: BusinessStatus.PENDING, submittedAt: { not: null } } }),
      this.prisma.businessProfile.findFirst({
        where: { status: BusinessStatus.PENDING, submittedAt: { not: null } },
        orderBy: { submittedAt: 'asc' },
        select: { submittedAt: true },
      }),
      this.prisma.payoutDestination.count({ where: { status: PayoutDestinationStatus.UNVERIFIED } }),
      this.prisma.payoutDestination.findFirst({
        where: { status: PayoutDestinationStatus.UNVERIFIED },
        orderBy: { submittedAt: 'asc' },
        select: { submittedAt: true },
      }),
      this.prisma.payout.count({ where: { status: PayoutStatus.PENDING } }),
      this.prisma.payout.findFirst({
        where: { status: PayoutStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.payout.groupBy({
        by: ['settlementCurrency'],
        where: { status: PayoutStatus.PENDING },
        _sum: { settlementAmountMinor: true },
      }),
      this.prisma.ticket.count({ where: { status: TicketStatus.OPEN } }),
      this.prisma.ticket.findFirst({
        where: { status: TicketStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.ticket.count({
        where: { status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] }, assignedAdminId: null },
      }),
    ]);

    return {
      businesses: { count: businesses, oldestAt: oldestBusiness?.submittedAt?.toISOString() ?? null },
      destinations: { count: destinations, oldestAt: oldestDestination?.submittedAt.toISOString() ?? null },
      payouts: {
        count: payouts,
        oldestAt: oldestPayout?.createdAt.toISOString() ?? null,
        amounts: payoutSums.map((row) => ({
          currency: row.settlementCurrency,
          amountMinor: row._sum.settlementAmountMinor ?? 0,
        })),
      },
      tickets: { count: tickets, oldestAt: oldestTicket?.createdAt.toISOString() ?? null, unassigned },
    };
  }
}
