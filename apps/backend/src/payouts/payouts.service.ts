import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  BusinessStatus,
  PayoutStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { ListPayoutsDto } from './dto/list-payouts.dto';
import { toCsvRow } from './payout-csv';
import { MarkPaidDto, MarkFailedDto } from './dto/mark-payout.dto';

export interface RunSummary {
  runAt: Date;
  businessesConsidered: number;
  payoutsCreated: number;
  totalCents: number;
  /** Businesses whose available balance was zero or negative — see §35.3. */
  skippedNonPositive: number;
  /** Businesses skipped because they are SUSPENDED — see §42.4. */
  pausedForSuspension: number;
  /** Entries with no settlement amount, which cannot be paid — see §46.3. */
  entriesWithoutSettlement: number;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- The run ----------

  /**
   * Pays out every business whose available balance is positive.
   *
   * "Available" means: entries with no payout, whose `availableAt` has passed.
   * Both halves matter — an unstamped entry that is not yet payable is money
   * the platform holds but does not owe yet.
   */
  /**
   * The admin-triggered run.
   *
   * A thin wrapper rather than a parameter on `run()`, because the scheduler is
   * a legitimate caller with no acting user (§41.2). Splitting them keeps
   * "system may run this" and "only an admin may ask for it" as two different
   * statements instead of one nullable actor that is easy to pass as undefined.
   */
  async runAsAdmin(actor: { role: UserRole | string }): Promise<RunSummary> {
    this.assertAdmin(actor);
    return this.run();
  }

  async run(now = new Date()): Promise<RunSummary> {
    // Grouped by (business, SETTLEMENT CURRENCY) — the pair a payout is actually
    // denominated in (§46.1). Grouped in the database rather than looped per
    // business: the set with money waiting is exactly what this returns.
    //
    // The sum is over settlementAmountMinor, and NO exchange rate is read
    // anywhere in this method. That is the whole decision: a payout carries the
    // amount its entries were created with.
    const owing = await this.prisma.ledgerEntry.groupBy({
      by: ['businessId', 'settlementCurrency'],
      where: {
        payoutId: null,
        availableAt: { not: null, lte: now },
        // Entries with no settlement figure cannot be paid — there is no
        // amount to send. Excluded and counted, never converted at today's
        // rate (§46.3).
        settlementCurrency: { not: null },
        settlementAmountMinor: { not: null },
      },
      _sum: { settlementAmountMinor: true, amountCents: true },
    });

    const entriesWithoutSettlement = await this.prisma.ledgerEntry.count({
      where: {
        payoutId: null,
        availableAt: { not: null, lte: now },
        OR: [{ settlementCurrency: null }, { settlementAmountMinor: null }],
      },
    });

    // Suspension pauses payouts (§42.4). Entries are NOT stamped and nothing is
    // written off — the money simply waits, and the next run after
    // reinstatement pays it. Suspension usually means something is wrong with
    // the money or the conduct, and paying out mid-investigation is hard to
    // undo; leaving the entries in the pool is not.
    const suspended = new Set(
      (
        await this.prisma.businessProfile.findMany({
          where: {
            status: BusinessStatus.SUSPENDED,
            id: { in: owing.map((g) => g.businessId) },
          },
          select: { id: true },
        })
      ).map((b) => b.id),
    );

    let created = 0;
    let total = 0;
    let skipped = 0;
    let pausedForSuspension = 0;

    for (const group of owing) {
      if (suspended.has(group.businessId)) {
        pausedForSuspension++;
        continue;
      }

      const sum = group._sum.settlementAmountMinor ?? 0;
      if (sum <= 0) {
        // NOT an error, and nothing is stamped. A business whose only booking
        // they cancelled themselves sits at a negative balance, and that
        // negative must carry forward to net against future earnings (§35.3).
        // Stamping the entries would erase the debt.
        skipped++;
        continue;
      }

      const payout = await this.payOne(
        group.businessId,
        group.settlementCurrency!,
        now,
      );
      if (payout) {
        created++;
        total += payout.settlementAmountMinor;
      }
    }

    const summary: RunSummary = {
      runAt: now,
      businessesConsidered: owing.length,
      payoutsCreated: created,
      totalCents: total,
      skippedNonPositive: skipped,
      pausedForSuspension,
      entriesWithoutSettlement,
    };

    if (created > 0 || skipped > 0 || pausedForSuspension > 0) {
      this.logger.log(
        `Payout run: ${created} payout(s) totalling ${total} minor unit(s) across ` +
          `${owing.length} business/currency group(s); ${skipped} skipped for a ` +
          `non-positive balance, ${pausedForSuspension} paused for suspension` +
          (entriesWithoutSettlement > 0
            ? `, ${entriesWithoutSettlement} entr(ies) skipped for having no settlement amount`
            : '') +
          '.',
      );
    }

    return summary;
  }

  /**
   * Creates one business's payout and stamps its entries, atomically.
   *
   * The stamp is conditional on `payoutId: null`, and the transaction is thrown
   * away unless every selected entry was still unstamped. That is what makes
   * two concurrent runs safe: the loser blocks on the row locks, re-evaluates
   * the condition, matches fewer rows than it selected, and rolls back its own
   * payout rather than paying the same money twice (§35.5).
   */
  private async payOne(businessId: string, settlementCurrency: string, now: Date) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const entries = await tx.ledgerEntry.findMany({
          where: {
            businessId,
            settlementCurrency,
            payoutId: null,
            availableAt: { not: null, lte: now },
            settlementAmountMinor: { not: null },
          },
          select: {
            id: true,
            amountCents: true,
            currency: true,
            settlementCurrency: true,
            settlementAmountMinor: true,
          },
        });
        if (entries.length === 0) return null;

        const settlementAmountMinor = entries.reduce(
          (sum, e) => sum + (e.settlementAmountMinor ?? 0),
          0,
        );
        if (settlementAmountMinor <= 0) return null;

        // The USD figure is carried alongside for reporting; it is never what
        // is sent, and it is never used to decide anything here (§46.1).
        const amountCents = entries.reduce((sum, e) => sum + e.amountCents, 0);

        // Belt and braces: the query is already scoped to one settlement
        // currency, so this can only fire if that scoping is ever broken. A
        // payout denominated in two currencies is not a payout anyone can send.
        const currencies = new Set(entries.map((e) => e.settlementCurrency));
        if (currencies.size > 1) {
          throw new BadRequestException(
            `Business ${businessId} has available entries in more than one settlement ` +
              `currency (${[...currencies].join(', ')}). A payout cannot span currencies.`,
          );
        }

        const payout = await tx.payout.create({
          data: {
            businessId,
            amountCents,
            currency: INTERNAL_CURRENCY,
            settlementCurrency,
            settlementAmountMinor,
            status: PayoutStatus.PENDING,
            runAt: now,
          },
        });

        const { count } = await tx.ledgerEntry.updateMany({
          where: { id: { in: entries.map((e) => e.id) }, payoutId: null },
          data: { payoutId: payout.id },
        });

        if (count !== entries.length) {
          // Another run took some of these between the select and the stamp.
          // Roll back entirely rather than pay out a partial, unexplained sum.
          throw new ConflictException(
            'Ledger entries changed during the payout run. No payout was created.',
          );
        }

        return payout;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn(
          `Payout for business ${businessId} rolled back: ${error.message} ` +
            'The entries stay in the pool and go out on the next run.',
        );
        return null;
      }
      throw error;
    }
  }

  // ---------- Admin ----------

  async list(actor: { role: UserRole | string }, query: ListPayoutsDto) {
    this.assertAdmin(actor);

    const where: Prisma.PayoutWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, payouts] = await Promise.all([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: { runAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { total, limit, offset, payouts };
  }

  /**
   * Records that a payout actually went out, with the provider's reference.
   *
   * The reference is required and unforgiving about it: a PAID payout with no
   * reference is a claim that money moved which nothing can corroborate.
   */
  async markPaid(
    actor: { userId: string; role: UserRole | string },
    payoutId: string,
    dto: MarkPaidDto,
  ) {
    this.assertAdmin(actor);
    const payout = await this.requirePayout(payoutId);

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException(
        `Only a PENDING payout can be marked paid. This one is ${payout.status}.`,
      );
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PAID,
        reference: dto.reference,
        paidAt: new Date(),
      },
    });

    this.logger.log(
      `Payout ${payoutId} (${payout.amountCents}c to business ${payout.businessId}) ` +
        `marked PAID by admin ${actor.userId}, reference ${dto.reference}.`,
    );

    return updated;
  }

  /**
   * Records that a payout did not go out, and returns its money to the pool.
   *
   * Unstamping is the whole point. The entries were never wrong — only the
   * transfer failed — so they go back to being available and are picked up by
   * the next run. The failed Payout row stays as the record that an attempt was
   * made and why it did not work.
   */
  async markFailed(
    actor: { userId: string; role: UserRole | string },
    payoutId: string,
    dto: MarkFailedDto,
  ) {
    this.assertAdmin(actor);
    const payout = await this.requirePayout(payoutId);

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException(
        `Only a PENDING payout can be marked failed. This one is ${payout.status}.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.FAILED, failureReason: dto.reason },
      });
      // Same transaction: a failed payout that kept its entries stamped would
      // strand that money forever, invisible to every future run.
      await tx.ledgerEntry.updateMany({
        where: { payoutId },
        data: { payoutId: null },
      });
      return row;
    });

    this.logger.warn(
      `Payout ${payoutId} marked FAILED by admin ${actor.userId}: ${dto.reason}. ` +
        `${payout.amountCents}c returned to the pool.`,
    );

    return updated;
  }

  // ---------- Batch export ----------

  /**
   * The whole RUN a payout belongs to, as CSV — one row per business paid
   * (§47).
   *
   * Addressed by a payout id rather than a run id because a run is not an
   * entity: there is no PayoutRun model, and payouts from one run share their
   * `runAt`. An admin has a payout in front of them and wants the batch it came
   * in, so "give me this payout's run" is the operation that matches the job.
   *
   * The job being: MoMo is collections-only (§34.1), so every payout is sent by
   * hand. This turns one run into one document instead of one browser tab per
   * business.
   *
   * **There is no payout destination in the schema.** `BusinessProfile` records
   * a `phone`, but that is a CONTACT number — never verified, never confirmed as
   * a mobile-money account, and quite possibly a landline or a receptionist. It
   * is included under a column that says so, beside a `payoutDestination` column
   * that reads `NOT RECORDED` rather than sitting blank, because a blank looks
   * like missing data and `NOT RECORDED` looks like what it is. Collecting a
   * real destination is a separate product decision (§47.2), and it is the one
   * thing standing between this file and being directly usable.
   */
  async exportRun(actor: { role: UserRole | string }, payoutId: string) {
    this.assertAdmin(actor);

    const payout = await this.requirePayout(payoutId);

    const batch = await this.prisma.payout.findMany({
      where: { runAt: payout.runAt },
      orderBy: [{ settlementCurrency: 'asc' }, { settlementAmountMinor: 'desc' }],
      select: {
        id: true,
        amountCents: true,
        currency: true,
        settlementCurrency: true,
        settlementAmountMinor: true,
        status: true,
        reference: true,
        businessProfile: { select: { id: true, name: true, phone: true } },
      },
    });

    const header = [
      'businessId',
      'businessName',
      'payoutDestination',
      'contactPhoneNotAPayoutDestination',
      'settlementCurrency',
      'settlementAmountMinor',
      'usdAmountCents',
      'status',
      'payoutReference',
      'payoutId',
    ];

    const rows = batch.map((row) =>
      toCsvRow([
        row.businessProfile.id,
        row.businessProfile.name,
        // Not blank. A blank cell reads as "we forgot"; this reads as "nobody
        // has ever collected one", which is the truth.
        'NOT RECORDED',
        row.businessProfile.phone,
        row.settlementCurrency,
        row.settlementAmountMinor,
        row.amountCents,
        row.status,
        row.reference,
        row.id,
      ]),
    );

    // One totals row PER CURRENCY. A single grand total across currencies would
    // be a number with no unit, which is worse than no total at all.
    const totals = new Map<string, { amountMinor: number; count: number }>();
    for (const row of batch) {
      const current = totals.get(row.settlementCurrency) ?? { amountMinor: 0, count: 0 };
      current.amountMinor += row.settlementAmountMinor;
      current.count += 1;
      totals.set(row.settlementCurrency, current);
    }

    const totalRows = [...totals.entries()].map(([currency, total]) =>
      toCsvRow([
        '',
        `TOTAL (${total.count} payout${total.count === 1 ? '' : 's'})`,
        '',
        '',
        currency,
        total.amountMinor,
        '',
        '',
        '',
        '',
      ]),
    );

    const csv = [toCsvRow(header), ...rows, ...totalRows].join('\n') + '\n';

    this.logger.log(
      `Payout run of ${payout.runAt.toISOString()} exported by admin: ` +
        `${batch.length} payout(s) across ${totals.size} currency/currencies.`,
    );

    return {
      csv,
      filename: `payout-run-${payout.runAt.toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`,
      payoutCount: batch.length,
    };
  }

  // ---------- Business-facing ----------

  /**
   * What a business is owed, split by whether they can have it yet.
   *
   * Every figure is a SUM over entries, computed on read. Nothing is stored
   * (§34.2), so these cannot disagree with the rows that justify them.
   */
  async balance(actor: { userId: string; role: UserRole | string }, businessId: string) {
    await this.assertMayRead(actor, businessId);
    const now = new Date();

    const [available, pending, paid, unresolved, settlement] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: { not: null, lte: now } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: { gt: now } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.payout.aggregate({
        where: { businessId, status: PayoutStatus.PAID },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: null },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      // What will actually be sent, by currency. The USD figures above are
      // reporting; this is the money (§46.1).
      this.prisma.ledgerEntry.groupBy({
        by: ['settlementCurrency'],
        where: {
          businessId,
          payoutId: null,
          availableAt: { not: null, lte: now },
          settlementCurrency: { not: null },
        },
        _sum: { settlementAmountMinor: true },
      }),
    ]);

    const availableCents = available._sum.amountCents ?? 0;
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { status: true, statusReason: true },
    });
    const paused = business?.status === BusinessStatus.SUSPENDED;

    return {
      businessId,
      payoutsPaused: paused,
      availableBySettlementCurrency: settlement.map((row) => ({
        currency: row.settlementCurrency!,
        amountMinor: row._sum.settlementAmountMinor ?? 0,
      })),
      currency: INTERNAL_CURRENCY,
      availableNowCents: availableCents,
      pendingCents: pending._sum.amountCents ?? 0,
      /** Deposits on appointments that have not happened yet, or not resolved. */
      unresolvedCents: unresolved._sum.amountCents ?? 0,
      lifetimePaidCents: paid._sum.amountCents ?? 0,
      payoutCount: paid._count._all,
      entryCounts: {
        available: available._count._all,
        pending: pending._count._all,
        unresolved: unresolved._count._all,
      },
      note: paused
        ? 'Payouts are paused while this business is suspended. Nothing has been ' +
          'written off — the balance is held and goes out on the first run after ' +
          `reinstatement.${business?.statusReason ? ` Reason: ${business.statusReason}` : ''}`
        : availableCents < 0
          ? 'This balance is negative, which happens after a cancellation the ' +
            'business was responsible for. No payout is made while it is; it ' +
            'nets against future earnings instead.'
          : 'Available funds go out on the next payout run.',
    };
  }

  async listForBusiness(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    query: ListPayoutsDto,
  ) {
    await this.assertMayRead(actor, businessId);

    const where: Prisma.PayoutWhereInput = {
      businessId,
      ...(query.status ? { status: query.status } : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, payouts] = await Promise.all([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: { runAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { businessId, total, limit, offset, payouts };
  }

  // ---------- Access ----------

  /**
   * The service-level half of the two-layer rule (§27.1). `@Roles(ADMIN)` on a
   * controller is a decorator on a class; a service method that trusts it is
   * one refactor away from being callable by anyone.
   */
  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }

  /** An admin may read any business; a business user only their own. */
  private async assertMayRead(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
  ) {
    if (actor.role === UserRole.ADMIN) return;

    const membership = await this.prisma.businessMembership.count({
      where: {
        userId: actor.userId,
        businessProfileId: businessId,
        status: BusinessMemberStatus.ACTIVE,
      },
    });
    // 404, not 403: the same rule used everywhere. Do not confirm that another
    // tenant's business exists to someone who may not read it.
    if (membership === 0) throw new NotFoundException('Business not found.');
  }

  private async requirePayout(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found.');
    return payout;
  }
}
