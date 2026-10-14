import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { EVERY_BRANCH, MEMBERSHIP_SCOPE_SELECT, assertBranch, branchIn, scopeOf } from '../business/branch-scope';

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 365;

/**
 * Statuses in which the deposit is known to have been collected.
 *
 * A deposit is taken at booking and the appointment only leaves PENDING_PAYMENT
 * once the provider confirms it (§17.3), so every status beyond that implies
 * money arrived.
 *
 * CANCELLED is not in this list because status alone cannot answer the question
 * for a cancelled row — it may have been an unpaid hold released by the §17.4
 * sweep, or a paid deposit later called off. It is added back separately, by
 * `depositPaidAt`, which records the answer directly (§33).
 */
export const DEPOSIT_COLLECTED_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
];

@Injectable()
export class AnalyticsService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
  }

  /**
   * Business performance over a period.
   *
   * Access is checked here as well as by the guard: an admin may read any
   * business, a business user only their own. The guard establishes the role;
   * this establishes which business.
   */
  async getAnalytics(
    viewer: { userId: string; role: string },
    businessId: string,
    query: AnalyticsQueryDto,
  ) {
    const { from, to } = this.resolveRange(query);
    const scope = await this.assertMayRead(viewer, businessId);

    // The branches counted (§277): the one asked for — which must be one they
    // look after — or, with none asked for, every branch they look after.
    // `undefined` is the whole business.
    if (query.locationId) assertBranch(scope, query.locationId);
    const ids = query.locationId ? [query.locationId] : branchIn(scope)?.in;

    // The whole scope in one place. Omitting locationId gives the business-wide
    // roll-up — the same aggregate over more rows, never a loop over locations.
    const where: Prisma.AppointmentWhereInput = {
      location: { businessId, ...(ids ? { id: { in: ids } } : {}) },
      // Half-open [from, to), matching the convention already used by
      // GET /appointments: `gte` on from, `lt` on to.
      startTime: { gte: from, lt: to },
    };

    if (query.locationId) {
      // Proven to belong to this business, so a valid location id from another
      // tenant cannot be used to read across the boundary.
      const owned = await this.prisma.location.count({
        where: { id: query.locationId, businessId },
      });
      if (owned === 0) throw new NotFoundException('Location not found.');
    }

    const [counts, money, reviews, busiest] = await Promise.all([
      this.countsByStatus(where),
      this.moneyCollected(where),
      this.reviewStats(businessId, ids, from, to),
      this.busiestPeriods(businessId, ids, from, to),
    ]);

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return {
      businessId,
      locationId: query.locationId ?? null,
      scope: query.locationId ? ('LOCATION' as const) : ('BUSINESS' as const),
      /** The branches counted when not one and not all (§277); null otherwise. */
      locationIds: !query.locationId && ids ? ids : null,
      range: { from, to, days: Math.round((+to - +from) / 86_400_000) },

      appointments: {
        total,
        byStatus: counts,
        // Null, not 0, on an empty period: "no appointments" and "0% completed"
        // are different claims, the same reasoning as ratingAvg (§28.5).
        completionRate: this.rate(counts.COMPLETED, total),
        cancellationRate: this.rate(counts.CANCELLED, total),
        noShowRate: this.rate(counts.NO_SHOW, total),
      },

      money,
      reviews,
      busiest,
    };
  }

  // ---------- Access ----------

  private async assertMayRead(
    viewer: { userId: string; role: string },
    businessId: string,
  ) {
    if (viewer.role === UserRole.ADMIN) return EVERY_BRANCH;

    const row = await this.prisma.businessMembership.findFirst({
      where: { userId: viewer.userId, businessProfileId: businessId, status: BusinessMemberStatus.ACTIVE },
      select: MEMBERSHIP_SCOPE_SELECT,
    });
    const membership = row ? { role: row.role, scope: scopeOf(row) } : null;

    // Forbidden rather than 404: the caller is asking about a business id they
    // supplied, and every business profile is discoverable through public
    // browsing anyway, so there is no existence to protect here.
    if (!membership) {
      throw new ForbiddenException('You cannot read analytics for this business.');
    }
    // Takings and rates are for whoever runs the place, not the front desk (§277).
    if (membership.role === BusinessMemberRole.STAFF) {
      throw new ForbiddenException('How the business is going is for the owner and managers.');
    }
    return membership.scope;
  }

  // ---------- Range ----------

  private resolveRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);

    if (Number.isNaN(+from) || Number.isNaN(+to)) {
      throw new BadRequestException('from and to must be valid date-times.');
    }
    if (from >= to) {
      throw new BadRequestException('from must be earlier than to.');
    }

    const days = (+to - +from) / 86_400_000;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `The maximum reporting range is ${MAX_RANGE_DAYS} days. Requested ${Math.ceil(days)}.`,
      );
    }

    return { from, to };
  }

  /** Null on a zero denominator — never NaN, never a misleading 0. */
  private rate(numerator: number, denominator: number): number | null {
    if (denominator === 0) return null;
    return Number(((numerator / denominator) * 100).toFixed(2));
  }

  // ---------- Metrics ----------

  private async countsByStatus(
    where: Prisma.AppointmentWhereInput,
  ): Promise<Record<AppointmentStatus, number>> {
    const grouped = await this.prisma.appointment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    // Every status present, so a caller can render a chart without inferring
    // that a missing key means zero.
    const counts = Object.fromEntries(
      Object.values(AppointmentStatus).map((s) => [s, 0]),
    ) as Record<AppointmentStatus, number>;

    for (const row of grouped) counts[row.status] = row._count._all;
    return counts;
  }

  /**
   * Money the platform can actually account for.
   *
   * Deliberately NOT summed into one "revenue" figure. The platform sees the
   * deposit and nothing else: the remaining balance is settled directly between
   * customer and business (§2) and is not recoverable from this data — see
   * `balanceOwedToBusiness` below.
   */
  private async moneyCollected(baseWhere: Prisma.AppointmentWhereInput) {
    const where: Prisma.AppointmentWhereInput = {
      ...baseWhere,
      OR: [
        { status: { in: DEPOSIT_COLLECTED_STATUSES } },
        // A cancellation whose deposit was confirmed before it was called off.
        // The money arrived and, per §2, was not refunded — excluding it
        // understated what the platform actually took. `depositPaidAt` is what
        // makes this answerable at all (§33).
        { status: AppointmentStatus.CANCELLED, depositPaidAt: { not: null } },
      ],
    };

    const [totals, unknown] = await Promise.all([
      this.prisma.appointment.aggregate({
        where,
        _sum: {
          depositAmountMinor: true,
          platformFeeAmountMinor: true,
          businessAmountMinor: true,
        },
        _count: { _all: true },
      }),
      // Cancelled rows from BEFORE §33, and only those: every cancellation
      // since records cancelledBy, so a null one is by construction a row that
      // predates the migration. Their payment state is not recoverable, so they
      // are excluded and counted rather than guessed at.
      this.prisma.appointment.count({
        where: {
          ...baseWhere,
          status: AppointmentStatus.CANCELLED,
          depositPaidAt: null,
          cancelledBy: null,
        },
      }),
    ]);

    return {
      /**
       * ~~'USD', hardcoded~~ — fixed in §96, the open finding from §67.4.
       *
       * These totals are sums over `Appointment.depositAmountMinor`, which is
       * denominated in `Appointment.currency`. Summing across rows is only
       * sound because every row holds INTERNAL_CURRENCY — CurrencyGuard
       * refuses to boot otherwise — so that is the currency to report. The
       * literal was correct on the day it was written and silently wrong from
       * the moment the deployment moved to RWF (§55).
       */
      currency: INTERNAL_CURRENCY,
      collectedThroughPlatform: {
        depositsMinor: totals._sum.depositAmountMinor ?? 0,
        // What the business actually received of those deposits, after the fee.
        businessShareOfDepositsMinor: totals._sum.businessAmountMinor ?? 0,
        appointmentCount: totals._count._all,
        // Named the same way balanceOwedToBusiness reports its own gaps: a
        // partial total that does not announce itself is the number a business
        // acts on and then stops trusting.
        cancelledWithUnknownPaymentState: unknown,
        complete: unknown === 0,
        note:
          'Deposits confirmed as collected, including appointments cancelled ' +
          'after their deposit was taken — those are not refunded (§2).' +
          (unknown > 0
            ? ` Excludes ${unknown} cancelled appointment(s) from before ` +
              'payment state was recorded, whose deposits may or may not have ' +
              'been taken. Every cancellation since then is accounted for exactly.'
            : ' Every cancellation in this range is accounted for exactly.'),
      },
      platformFeesPaidMinor: totals._sum.platformFeeAmountMinor ?? 0,
      balanceOwedToBusiness: await this.balanceOwed(baseWhere),
    };
  }

  /**
   * What customers still owe the business directly, on completed appointments.
   *
   * Computable only since pricing inputs began being snapshotted: it is
   * `servicePriceMinor - depositAmountMinor`, and the price at booking time is
   * not otherwise recoverable (§29.1).
   *
   * Two things this figure is NOT, both stated in the response rather than left
   * to the reader:
   *
   * - It is not money the platform has seen. §2 places settlement of the
   *   balance directly between customer and business, and nothing records
   *   whether it was ever collected. It is an expectation, not a receipt.
   * - It is not necessarily complete. Appointments booked before snapshotting
   *   have no price recorded and are excluded, so the count of those is
   *   returned alongside — a partial total that does not say it is partial is
   *   the kind of number a business acts on and then distrusts.
   */
  private async balanceOwed(baseWhere: Prisma.AppointmentWhereInput) {
    const completed: Prisma.AppointmentWhereInput = {
      ...baseWhere,
      status: AppointmentStatus.COMPLETED,
    };

    const [withSnapshot, missing] = await Promise.all([
      this.prisma.appointment.aggregate({
        where: { ...completed, servicePriceMinor: { not: null } },
        _sum: { servicePriceMinor: true, depositAmountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.appointment.count({
        where: { ...completed, servicePriceMinor: null },
      }),
    ]);

    const price = withSnapshot._sum.servicePriceMinor ?? 0;
    const deposits = withSnapshot._sum.depositAmountMinor ?? 0;

    return {
      amountMinor: price - deposits,
      fromAppointments: withSnapshot._count._all,
      appointmentsMissingSnapshot: missing,
      // The one flag a caller should branch on before presenting the number.
      complete: missing === 0,
      note:
        'Expected to be settled directly between customer and business. The ' +
        'platform never sees this money and cannot confirm it was paid.' +
        (missing > 0
          ? ` Excludes ${missing} completed appointment(s) booked before pricing ` +
            'was snapshotted, whose original price is not recoverable.'
          : ''),
    };
  }

  private async reviewStats(
    businessId: string,
    locationIds: string[] | undefined,
    from: Date,
    to: Date,
  ) {
    const aggregate = await this.prisma.review.aggregate({
      where: {
        businessId,
        ...(locationIds ? { locationId: { in: locationIds } } : {}),
        hiddenAt: null, // hidden reviews never count, here or in §28's aggregates
        createdAt: { gte: from, lt: to },
      },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return {
      count: aggregate._count._all,
      averageRating:
        aggregate._count._all > 0 && aggregate._avg.rating !== null
          ? Number(aggregate._avg.rating.toFixed(2))
          : null,
    };
  }

  /**
   * Busiest day of week and hour, in the platform's local timezone.
   *
   * Raw SQL because Prisma's groupBy cannot express EXTRACT over a timezone
   * conversion — but the aggregation still happens in the database, which is
   * the point. Grouping in JavaScript would mean loading every appointment.
   *
   * `AT TIME ZONE` twice is the standard Postgres idiom: the first labels the
   * stored timestamp as UTC, the second converts it. Without it, "busiest hour"
   * would be reported in UTC and be wrong by the offset.
   */
  private async busiestPeriods(
    businessId: string,
    locationIds: string[] | undefined,
    from: Date,
    to: Date,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{ dow: number; hour: number; count: bigint }>
    >`
      SELECT
        EXTRACT(DOW  FROM a."startTime" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::int AS dow,
        EXTRACT(HOUR FROM a."startTime" AT TIME ZONE 'UTC' AT TIME ZONE ${this.timeZone})::int AS hour,
        COUNT(*)::bigint AS count
      FROM "appointments" a
      JOIN "locations" l ON l."id" = a."locationId"
      WHERE l."businessId" = ${businessId}
        AND (${locationIds ? 1 : 0} = 0 OR a."locationId" = ANY(${locationIds ?? []}::text[]))
        AND a."startTime" >= ${from}
        AND a."startTime" <  ${to}
      GROUP BY dow, hour
    `;

    if (rows.length === 0) {
      return { dayOfWeek: null, hour: null, timeZone: this.timeZone };
    }

    const byDay = new Map<number, number>();
    const byHour = new Map<number, number>();
    for (const row of rows) {
      const n = Number(row.count);
      byDay.set(row.dow, (byDay.get(row.dow) ?? 0) + n);
      byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + n);
    }

    const peak = (m: Map<number, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

    const [dow, dowCount] = peak(byDay);
    const [hour, hourCount] = peak(byHour);

    return {
      // 0 = Sunday, matching LocationHours.dayOfWeek (§10.4).
      dayOfWeek: { day: dow, appointments: dowCount },
      hour: { hour, appointments: hourCount },
      timeZone: this.timeZone,
    };
  }
}
