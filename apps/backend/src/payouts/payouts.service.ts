import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  BusinessStatus,
  LedgerEntryType,
  NotificationType,
  PayoutStatus,
  Prisma,
  UserRole,
  MobileMoneyProvider,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PAYOUT_HOLD_DAYS, PLATFORM_SETTING_ID } from '../settings/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
// One include, shared with the DTO describing its result (§128.5).
import { BusinessBalanceDto, BusinessPayoutDetailDto, PAYOUT_INCLUDE } from './dto/payout-response.dto';
import { INTERNAL_CURRENCY } from '../payments/currency';
import { ListPayoutsDto, PayoutDetailQueryDto } from './dto/list-payouts.dto';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { DATE_TAGS, say } from '../i18n/say';
import { csvTextCell, toCsvRow } from './payout-csv';
import { PayoutDestinationsService } from './payout-destinations.service';
import { placesOf, shopMatching } from './payout-search';
import { DisbursementProviderRegistry } from '../payments/disbursement-provider.registry';
import { maskMsisdn } from './msisdn';
import { MarkPaidDto, MarkFailedDto } from './dto/mark-payout.dto';
import { MEMBERSHIP_SCOPE_SELECT, MONEY_READERS_ONLY, mayReadMoney, scopeOf } from '../business/branch-scope';
import { CountriesService } from '../countries/countries.service';

/** Why a business was held back from a run. */
export type PauseReason = 'SUSPENDED' | 'NO_VERIFIED_PAYOUT_DESTINATION';

export interface RunSummary {
  runAt: Date;
  businessesConsidered: number;
  payoutsCreated: number;
  /**
   * Minor units of the SETTLEMENT currency, not of the internal one (§51.2).
   *
   * It was called `totalMinor` until the settlement change (§46) made it a sum
   * of `settlementAmountMinor`. A name ending in "Cents" reads as USD
   * everywhere else in this codebase — the same reason `gatewayChargeMinor` was
   * renamed in 7cdc411.
   */
  totalMinor: number;
  /** The currencies that total spans. Plural because a run can pay several. */
  settlementCurrencies: string[];
  /** Businesses whose available balance was zero or negative — see §35.3. */
  skippedNonPositive: number;
  /** Businesses skipped because they are SUSPENDED — see §42.4. */
  pausedForSuspension: number;
  /** Businesses skipped for having no VERIFIED payout destination — §48.3. */
  pausedForUnverifiedDestination: number;
  /**
   * Every business held back this run, and why — so an admin has a list to
   * chase rather than a silently smaller payout batch.
   */
  pausedBusinesses: Array<{ businessId: string; reason: PauseReason; name: string | null }>;
  /** Entries with no settlement amount, which cannot be paid — see §46.3. */
  entriesWithoutSettlement: number;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);


  constructor(
    private readonly prisma: PrismaService,
    private readonly destinations: PayoutDestinationsService,
    private readonly disbursements: DisbursementProviderRegistry,
    private readonly countries: CountriesService,
    // Optional so suites about the money alone need not stand up the inbox.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Tells the shop's money people a payout went, or did not (§287). Never
   * throws: the payout is already a fact.
   */
  private async tellShop(
    payout: { businessId: string; settlementAmountMinor: number; settlementCurrency: string },
    outcome: 'SENT' | 'FAILED',
    detail: string | null,
  ) {
    await this.notifications
      ?.notifyBusiness({
        businessId: payout.businessId,
        type: outcome === 'SENT' ? NotificationType.PAYOUT_SENT : NotificationType.PAYOUT_FAILED,
        moneyOnly: true,
        locationId: null,
        context: {
          serviceName: '',
          locationName: '',
          businessName: '',
          startTime: undefined as unknown as Date,
          depositAmountMinor: payout.settlementAmountMinor,
          currency: payout.settlementCurrency,
          reason: detail ?? undefined,
        },
      })
      .catch(() => undefined);
  }

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
      _sum: { settlementAmountMinor: true, amountMinor: true },
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
    const candidateIds = [...new Set(owing.map((g) => g.businessId))];

    const suspended = new Set(
      (
        await this.prisma.businessProfile.findMany({
          where: { status: BusinessStatus.SUSPENDED, id: { in: candidateIds } },
          select: { id: true },
        })
      ).map((b) => b.id),
    );

    // A business with no VERIFIED destination has nowhere for the money to go
    // (§48.3). It is paused through the SAME mechanism as a suspension —
    // entries left unstamped, nothing written off, picked up by the first run
    // after it is fixed — rather than a second, subtly different skip path.
    const verifiedDestinations = await this.destinations.verifiedFor(candidateIds);

    let created = 0;
    let total = 0;
    let skipped = 0;
    let pausedForSuspension = 0;
    let pausedForUnverifiedDestination = 0;
    const pausedBusinesses: Array<{ businessId: string; reason: PauseReason }> = [];

    for (const group of owing) {
      if (suspended.has(group.businessId)) {
        pausedForSuspension++;
        pausedBusinesses.push({ businessId: group.businessId, reason: 'SUSPENDED' });
        continue;
      }

      if (!verifiedDestinations.has(group.businessId)) {
        pausedForUnverifiedDestination++;
        pausedBusinesses.push({
          businessId: group.businessId,
          reason: 'NO_VERIFIED_PAYOUT_DESTINATION',
        });
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

    // Each held-back business by name (§246): a list of ids is not a list
    // anyone can chase.
    const heldBack = [...new Map(pausedBusinesses.map((p) => [p.businessId, p])).values()];
    const heldNames = heldBack.length
      ? new Map(
          (
            await this.prisma.businessProfile.findMany({
              where: { id: { in: heldBack.map((p) => p.businessId) } },
              select: { id: true, name: true },
            })
          ).map((b) => [b.id, b.name]),
        )
      : new Map<string, string | null>();

    const summary: RunSummary = {
      runAt: now,
      businessesConsidered: owing.length,
      payoutsCreated: created,
      totalMinor: total,
      settlementCurrencies: [
        ...new Set(owing.map((g) => g.settlementCurrency).filter((c): c is string => !!c)),
      ],
      skippedNonPositive: skipped,
      pausedForSuspension,
      pausedForUnverifiedDestination,
      // De-duplicated: a business owed money in two currencies would otherwise
      // appear twice on a list an admin is meant to work through.
      pausedBusinesses: heldBack.map((p) => ({ ...p, name: heldNames.get(p.businessId) ?? null })),
      entriesWithoutSettlement,
    };

    if (
      created > 0 ||
      skipped > 0 ||
      pausedForSuspension > 0 ||
      pausedForUnverifiedDestination > 0
    ) {
      this.logger.log(
        `Payout run: ${created} payout(s) totalling ${total} settlement minor unit(s) across ` +
          `${owing.length} business/currency group(s); ${skipped} skipped for a ` +
          `non-positive balance, ${pausedForSuspension} paused for suspension, ` +
          `${pausedForUnverifiedDestination} paused for having no verified payout destination` +
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
            amountMinor: true,
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
        const amountMinor = entries.reduce((sum, e) => sum + e.amountMinor, 0);

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
            amountMinor,
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

    const q = query.q?.trim();
    const where: Prisma.PayoutWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              ...shopMatching(q, { numbers: true }).map((shop) => ({ businessProfile: shop })),
              { reference: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { providerReferenceId: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, rows] = await Promise.all([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: { runAt: 'desc' },
        take: limit,
        skip: offset,
        include: PAYOUT_INCLUDE,
      }),
    ]);

    // WHO is being paid and WHERE the money goes, on the row itself (§65.1).
    //
    // Without these the console showed a truncated business id and an amount,
    // which is not enough to pay anyone — so an admin had to export the CSV
    // just to read a name and a number that the screen could have shown. The
    // export then looked load-bearing when it was really covering a gap here.
    const [destinations, places] = await Promise.all([
      this.destinations.verifiedFor(rows.map((row) => row.businessId)),
      placesOf(this.prisma, rows.map((row) => row.businessId)),
    ]);

    const payouts = rows.map((row) => ({
      ...row,
      businessName: row.businessProfile.name,
      // Null when there is no verified destination — which is also why this
      // payout cannot be sent. The console reads it to say so.
      destinationMsisdn: destinations.get(row.businessId)?.msisdn ?? null,
      destinationProvider: destinations.get(row.businessId)?.provider ?? null,
      places: places.get(row.businessId) ?? [],
    }));

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
      `Payout ${payoutId} (${payout.amountMinor}c to business ${payout.businessId}) ` +
        `marked PAID by admin ${actor.userId}, reference ${dto.reference}.`,
    );
    await this.tellShop(payout, 'SENT', dto.reference);

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
        `${payout.amountMinor}c returned to the pool.`,
    );
    await this.tellShop(payout, 'FAILED', dto.reason);

    return updated;
  }

  // ---------- Automated transfer (§64) ----------

  /**
   * Sends ONE payout through the operator.
   *
   * One, deliberately, and not a "send all". A bug in an automated batch pays
   * every business wrongly before anyone notices; a bug here pays one business
   * wrongly and stops. Money out is the direction that cannot be undone, and
   * this codebase has taken that position before — §53.4 made deposit
   * confirmation a guarded script rather than an endpoint for the same reason.
   * A batch button can be added once this has been watched for a while.
   *
   * ## The order of writes is the whole safety property
   *
   * `providerReferenceId` and PROCESSING are written BEFORE the operator is
   * called. If the call succeeds and this process dies before recording
   * anything, the payout still reads PENDING and the next person to press send
   * pays the business twice. Written first, a crash leaves a PROCESSING row
   * whose outcome the poller can ask for.
   *
   * MTN keys a transfer on the reference WE choose, so presenting the same one
   * again is rejected as a duplicate rather than paid twice. That makes the
   * whole operation safe to repeat, which is what a payment system needs far
   * more than it needs speed.
   */
  async send(actor: { userId: string; role: UserRole | string }, payoutId: string) {
    this.assertAdmin(actor);
    const payout = await this.requirePayout(payoutId);

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException(
        `Only a PENDING payout can be sent. This one is ${payout.status}.` +
          (payout.status === PayoutStatus.PROCESSING
            ? ' It is already with the operator — its outcome is being polled.'
            : ''),
      );
    }

    // Where the money goes, and on which network. From the VERIFIED destination
    // row, never from configuration: that row is the record of the only
    // irreversible check the platform makes (§48).
    const destinations = await this.destinations.verifiedFor([payout.businessId]);
    const destination = destinations.get(payout.businessId);

    if (!destination) {
      throw new BadRequestException(
        'This business has no VERIFIED payout destination, so there is nowhere ' +
          'to send the money. Verify one first.',
      );
    }

    // The shop's country's connection (§315): payouts leave from that country's account.
    const provider = this.disbursements.require(
      destination.provider as MobileMoneyProvider,
      await this.countries.ofBusiness(payout.businessId),
    );

    // Ours, chosen now and recorded before the call.
    const reference = crypto.randomUUID();

    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PROCESSING,
        providerReferenceId: reference,
        sentAt: new Date(),
        // Cleared: a previous failure's reason must not sit beside a new attempt.
        failureReason: null,
      },
    });

    const result = await provider.sendTransfer({
      msisdn: destination.msisdn.replace(/\D/g, ''),
      amountMinor: payout.settlementAmountMinor,
      currency: payout.settlementCurrency,
      externalReferenceId: reference,
      payeeNote: `Payout ${payoutId.slice(0, 8)}`,
      payerMessage: 'Booking platform payout',
    });

    if (result.status === 'FAILED') {
      // Back to PENDING, not FAILED: the operator never took the request, so
      // nothing is in flight and the money should stay stamped to this payout
      // ready for another attempt. FAILED is reserved for a transfer that was
      // accepted and then did not arrive, which is what releases the entries.
      const reverted = await this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.PENDING,
          providerReferenceId: null,
          sentAt: null,
          failureReason: result.failureReason ?? 'The operator refused the transfer.',
        },
      });

      this.logger.error(
        `Payout ${payoutId} was refused by ${provider.key} (${result.failureKind}): ` +
          `${result.failureReason}. Left PENDING for another attempt.`,
      );

      return reverted;
    }

    this.logger.log(
      `Payout ${payoutId} handed to ${provider.key} as ${reference} ` +
        `(${payout.settlementAmountMinor} ${payout.settlementCurrency} minor). ` +
        'Awaiting confirmation.',
    );

    return this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  }

  /**
   * Asks the operator what happened to every transfer in flight.
   *
   * Run on a schedule, and safe to run at any time: it only reads, and only
   * writes when the operator gives a final answer.
   *
   * A transfer that SUCCEEDS becomes PAID with the operator's own reference —
   * the one that reconciles against a statement. One that FAILS releases its
   * ledger entries back into the pool, exactly as a manual `markFailed` does,
   * because money that did not arrive must be payable again.
   */
  async pollInFlightTransfers(): Promise<{ paid: number; failed: number }> {
    const inFlight = await this.prisma.payout.findMany({
      where: { status: PayoutStatus.PROCESSING, providerReferenceId: { not: null } },
      select: {
        id: true,
        providerReferenceId: true,
        businessId: true,
        settlementAmountMinor: true,
        settlementCurrency: true,
      },
    });

    if (inFlight.length === 0) return { paid: 0, failed: 0 };

    // Which operator holds each reference, resolved from the destination — the
    // §57.2 rule, in the other direction: a reference means something only to
    // the operator that issued it.
    const destinations = await this.destinations.verifiedFor(
      inFlight.map((payout) => payout.businessId),
    );

    let paid = 0;
    let failed = 0;

    for (const payout of inFlight) {
      const destination = destinations.get(payout.businessId);
      if (!destination) {
        this.logger.error(
          `Payout ${payout.id} is PROCESSING but its business no longer has a ` +
            'verified destination, so its operator cannot be determined. Left in place.',
        );
        continue;
      }

      try {
        const provider = this.disbursements.require(
          destination.provider as MobileMoneyProvider,
          await this.countries.ofBusiness(payout.businessId),
        );
        const result = await provider.checkTransferStatus(payout.providerReferenceId!);

        if (result.status === 'PENDING') continue;

        if (result.status === 'SUCCESSFUL') {
          await this.prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: PayoutStatus.PAID,
              paidAt: new Date(),
              reference: result.providerReference ?? payout.providerReferenceId,
            },
          });
          paid++;
          this.logger.log(`Payout ${payout.id} confirmed PAID by the operator.`);
          await this.tellShop(payout, 'SENT', result.providerReference ?? payout.providerReferenceId);
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.payout.update({
            where: { id: payout.id },
            data: {
              status: PayoutStatus.FAILED,
              failureReason: result.failureReason ?? 'The operator reported a failure.',
            },
          });
          // Same transaction, same reason as markFailed: a failed payout that
          // kept its entries stamped would strand that money forever, invisible
          // to every future run.
          await tx.ledgerEntry.updateMany({
            where: { payoutId: payout.id },
            data: { payoutId: null },
          });
        });
        failed++;
        await this.tellShop(payout, 'FAILED', result.failureReason ?? null);
        this.logger.warn(
          `Payout ${payout.id} FAILED at the operator: ${result.failureReason}. ` +
            `${payout.settlementAmountMinor} minor returned to the pool.`,
        );
      } catch (error) {
        // One operator being unreachable must not stop the rest being asked.
        this.logger.error(
          `Could not check payout ${payout.id}: ` +
            `${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (paid + failed > 0) {
      this.logger.log(
        `Transfer poll: ${inFlight.length} in flight, ${paid} paid, ${failed} failed.`,
      );
    }

    return { paid, failed };
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
   * ~~MoMo is collections-only, so every payout is sent by hand.~~ Since §64 a
   * payout can be sent through the operator from the console, one at a time.
   * This export remains, for the cases automation does not cover: an operator
   * the platform cannot disburse through, a deployment without disbursement
   * credentials, and reconciling a whole batch against a statement afterwards.
   *
   * `payoutDestination` carries the business's VERIFIED destination (§48), and
   * reads `NOT RECORDED` rather than sitting blank when there is none — a blank
   * looks like missing data, `NOT RECORDED` looks like what it is.
   *
   * `BusinessProfile.phone` appears beside it under a column named
   * `contactPhoneNotAPayoutDestination`, because it is a CONTACT number: never
   * verified, never confirmed as a mobile-money account, and quite possibly a
   * landline. The column name is the warning.
   */
  async exportRun(actor: { role: UserRole | string }, payoutId: string) {
    this.assertAdmin(actor);

    const payout = await this.requirePayout(payoutId);

    const batch = await this.prisma.payout.findMany({
      where: { runAt: payout.runAt },
      orderBy: [{ settlementCurrency: 'asc' }, { settlementAmountMinor: 'desc' }],
      select: {
        id: true,
        amountMinor: true,
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
      'payoutProvider',
      'payable',
      'contactPhoneNotAPayoutDestination',
      'settlementCurrency',
      'settlementAmountMinor',
      'internalAmountMinor',
      'status',
      'payoutReference',
      'payoutId',
    ];

    // The VERIFIED destination for everyone in this batch, in one query (§48.5).
    const destinations = await this.destinations.verifiedFor(
      batch.map((row) => row.businessProfile.id),
    );

    const rows = batch.map((row) => {
      const destination = destinations.get(row.businessProfile.id);
      return toCsvRow([
        row.businessProfile.id,
        row.businessProfile.name,
        // The real number when there is a verified one. When there is not, the
        // §47.2 placeholder survives for exactly this case — and `payable` says
        // plainly that this line must not be sent.
        // Forced to TEXT: a leading "+" makes Excel render the one column the
        // reader needs as 2.11921E+11 (§65.2).
        destination ? csvTextCell(destination.msisdn) : 'NOT RECORDED',
        destination ? destination.provider : '',
        destination ? 'YES' : 'NO — DESTINATION NOT VERIFIED, DO NOT SEND',
        csvTextCell(row.businessProfile.phone),
        row.settlementCurrency,
        row.settlementAmountMinor,
        row.amountMinor,
        row.status,
        row.reference,
        row.id,
      ]);
    });

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

    const unpayable = batch.filter(
      (row) => !destinations.has(row.businessProfile.id),
    ).length;

    const csv = [toCsvRow(header), ...rows, ...totalRows].join('\n') + '\n';

    this.logger.log(
      `Payout run of ${payout.runAt.toISOString()} exported by admin: ` +
        `${batch.length} payout(s) across ${totals.size} currency/currencies` +
        (unpayable > 0
          ? `; ${unpayable} flagged unpayable — destination not verified`
          : '') +
        '.',
    );

    return {
      csv,
      filename: `payout-run-${payout.runAt.toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`,
      payoutCount: batch.length,
      /**
       * Payouts in this batch whose destination is no longer verified — because
       * the business changed its number after the run (§48.4). Flagged rather
       * than dropped: the money is still owed, it just must not be sent yet.
       */
      unpayableCount: unpayable,
    };
  }

  // ---------- Business-facing ----------

  /**
   * What a business is owed, split by whether they can have it yet.
   *
   * Every figure is a SUM over entries, computed on read. Nothing is stored
   * (§34.2), so these cannot disagree with the rows that justify them.
   */
  async balance(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
  ): Promise<BusinessBalanceDto> {
    await this.assertMayRead(actor, businessId);
    const now = new Date();

    const [available, pending, paid, unresolved, inFlight, settlement, onTheWay] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: { not: null, lte: now } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: { gt: now } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.payout.aggregate({
        where: { businessId, status: PayoutStatus.PAID },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { businessId, payoutId: null, availableAt: null },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      // Money in flight: a payout exists and is not yet marked paid (§51.3).
      // Without this it appeared NOWHERE — the entries are stamped so
      // `availableNow` is zero, and `lifetimePaid` only counts PAID. A business
      // that was told it would be paid and can see nothing is a support ticket.
      this.prisma.payout.groupBy({
        by: ['settlementCurrency'],
        where: { businessId, status: PayoutStatus.PENDING },
        _sum: { settlementAmountMinor: true, amountMinor: true },
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
      // On its way (§291): worked out into a payment and not yet arrived —
      // waiting to be sent, or with the operator. `pendingPayouts` above
      // predates sending through the operator (§64) and counts only the
      // first; a payment with MTN was in no figure on the seller's page.
      this.prisma.payout.aggregate({
        where: { businessId, status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
    ]);

    const availableMinor = available._sum.amountMinor ?? 0;
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { status: true, statusReason: true },
    });

    // BOTH reasons a run skips a business, not just one (§77).
    //
    // This reported only suspension, so a business whose payout number was
    // waiting to be checked was told payouts were fine — while every run
    // skipped it for exactly that reason (§48.3). A balance screen that says
    // "nothing is wrong" about money that is not moving is worse than silence.
    const verified = await this.destinations.verifiedFor([businessId]);
    const suspended = business?.status === BusinessStatus.SUSPENDED;
    const unverifiedDestination = !verified.has(businessId);

    return {
      businessId,
      payoutsPaused: suspended || unverifiedDestination,
      /** Which of the two, so a caller can say something useful. */
      payoutsPausedReason: suspended
        ? ('BUSINESS_SUSPENDED' as const)
        : unverifiedDestination
          ? ('DESTINATION_NOT_VERIFIED' as const)
          : null,
      availableBySettlementCurrency: settlement.map((row) => ({
        currency: row.settlementCurrency!,
        amountMinor: row._sum.settlementAmountMinor ?? 0,
      })),
      currency: INTERNAL_CURRENCY,
      availableNowMinor: availableMinor,
      pendingMinor: pending._sum.amountMinor ?? 0,
      /** Deposits on appointments that have not happened yet, or not resolved. */
      unresolvedMinor: unresolved._sum.amountMinor ?? 0,
      lifetimePaidMinor: paid._sum.amountMinor ?? 0,
      payoutCount: paid._count._all,
      onTheWayMinor: onTheWay._sum.amountMinor ?? 0,
      onTheWayCount: onTheWay._count._all,
      /** Payouts created and not yet sent. Money on its way, not lost. */
      pendingPayouts: {
        count: inFlight.reduce((sum, row) => sum + row._count._all, 0),
        reportingInternalMinor: inFlight.reduce((sum, row) => sum + (row._sum.amountMinor ?? 0), 0),
        bySettlementCurrency: inFlight.map((row) => ({
          settlementCurrency: row.settlementCurrency,
          amountMinor: row._sum.settlementAmountMinor ?? 0,
        })),
      },
      entryCounts: {
        available: available._count._all,
        pending: pending._count._all,
        unresolved: unresolved._count._all,
      },
      holdDays: await this.holdDays(),
      note: suspended
        ? 'Payouts are paused while this business is suspended. Nothing has been ' +
          'written off — the balance is held and goes out with the first payment after ' +
          `reinstatement.${business?.statusReason ? ` Reason: ${business.statusReason}` : ''}`
        : unverifiedDestination
          ? 'Payouts are paused until a verified payout number is on file. ' +
            'Nothing is written off — the balance is held and goes out with the ' +
            'first payment after the number is confirmed.'
        : availableMinor < 0
          ? 'This balance is negative, which happens after a cancellation the ' +
            'business was responsible for. No payout is made while it is; it ' +
            'nets against future earnings instead.'
          : 'What is ready goes into your next payment, worked out each night at 2 a.m.',
    };
  }

  async listForBusiness(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    query: ListPayoutsDto,
    // Not declared as BusinessPayoutPageDto: the rows are spread from Prisma, so
    // they still carry Dates here. The DTO is checked against the Payout model
    // instead (§128.11), which is what catches a column changing under it.
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

  /**
   * One payout, opened by its shop (§290): every booking whose money is in
   * it — the service, the branch, when, for whom — with its deposit, the
   * platform's share, anything else on it, and what it adds. Totals are over
   * the whole payout; the bookings come a page at a time, as a busy shop's
   * payout after a pause can hold hundreds.
   */
  async detailForBusiness(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    payoutId: string,
    query: PayoutDetailQueryDto,
  ): Promise<BusinessPayoutDetailDto> {
    await this.assertMayRead(actor, businessId);
    // Scoped to the business: another shop's payout is "not found", never "forbidden".
    const payout = await this.prisma.payout.findFirst({ where: { id: payoutId, businessId } });
    if (!payout) throw new NotFoundException('Payout not found.');

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const [byType, bookingsTotal, appointments, adjustments, verified, holdDays] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['type'],
        where: { payoutId },
        _sum: { settlementAmountMinor: true },
      }),
      this.prisma.appointment.count({ where: { ledgerEntries: { some: { payoutId } } } }),
      this.payoutBookings(payoutId, { take: limit, skip: offset }),
      this.prisma.ledgerEntry.findMany({
        where: { payoutId, appointmentId: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          settlementAmountMinor: true,
          amountMinor: true,
          createdAt: true,
          billingAdjustment: { select: { reason: true } },
        },
      }),
      payout.status === PayoutStatus.PENDING ? this.destinations.verifiedFor([businessId]) : null,
      this.holdDays(),
    ]);

    const sum = (...types: LedgerEntryType[]) =>
      byType.filter((row) => types.includes(row.type)).reduce((total, row) => total + (row._sum.settlementAmountMinor ?? 0), 0);
    const destination = verified?.get(businessId);

    return {
      payout: {
        ...payout,
        sentAt: payout.sentAt?.toISOString() ?? null,
        runAt: payout.runAt.toISOString(),
        paidAt: payout.paidAt?.toISOString() ?? null,
        createdAt: payout.createdAt.toISOString(),
      },
      holdDays,
      // Only for money not yet sent: a payout already sent went to whatever
      // number was checked then, which the payout does not record.
      sendTo: destination
        ? { provider: destination.provider as MobileMoneyProvider, last3: destination.msisdn.slice(-3) }
        : null,
      totals: {
        bookings: bookingsTotal,
        depositsMinor: sum(LedgerEntryType.DEPOSIT_RECEIVED),
        platformFeesMinor: sum(LedgerEntryType.PLATFORM_FEE),
        refundsMinor: sum(LedgerEntryType.DEPOSIT_REFUND),
        feesReturnedMinor: sum(LedgerEntryType.PLATFORM_FEE_REVERSAL),
        gatewayFeesMinor: sum(LedgerEntryType.GATEWAY_FEE_DEBIT),
        adjustmentsMinor: sum(LedgerEntryType.ADJUSTMENT),
        netMinor: byType.reduce((total, row) => total + (row._sum.settlementAmountMinor ?? 0), 0),
      },
      limit,
      offset,
      bookings: appointments,
      adjustments: adjustments.map((entry) => ({
        id: entry.id,
        amountMinor: entry.settlementAmountMinor ?? entry.amountMinor,
        reason: entry.billingAdjustment?.reason ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /**
   * The same payout as a spreadsheet, for the shop's own books (§290): every
   * booking, not a page of them (§216.1), and the corrections, then the total.
   * Times are on the shop's own clock (§315), as the shop knows them.
   */
  async exportForBusiness(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    payoutId: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<{ csv: string; filename: string }> {
    const l = locale;
    const detail = await this.detailForBusiness(actor, businessId, payoutId, { limit: 1, offset: 0 });
    const bookings = await this.payoutBookings(payoutId, {});
    const currency = detail.payout.settlementCurrency;
    const timeZone = await this.countries.zoneOfBusiness(businessId);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = new Intl.DateTimeFormat(DATE_TAGS[l], { timeZone, hour: '2-digit', minute: '2-digit' });
    // The seller app's own words for a booking's state (§213), not the enum — in the seller's language (§308).
    const said: Record<string, string> = {
      BOOKED: say(l, 'Expected'),
      IN_PROGRESS: say(l, 'In progress'),
      COMPLETED: say(l, 'Done'),
      NO_SHOW: say(l, 'No-show'),
      CANCELLED: say(l, 'Cancelled'),
      PENDING_PAYMENT: say(l, 'Unpaid'),
    };
    const reservation = (id: string) => {
      const s = id.replace(/-/g, '').slice(0, 8).toUpperCase();
      return `${s.slice(0, 4)}-${s.slice(4)}`;
    };

    const lines = [
      toCsvRow([
        say(l, 'Reservation No.'),
        say(l, 'Date'),
        say(l, 'Time'),
        say(l, 'Service'),
        say(l, 'Quantity'),
        say(l, 'Branch'),
        say(l, 'Customer'),
        say(l, 'Booking status'),
        say(l, 'Deposit'),
        say(l, 'Platform fee'),
        say(l, 'Other'),
        say(l, 'You get'),
        say(l, 'Currency'),
      ]),
      ...bookings.map((b) =>
        toCsvRow([
          csvTextCell(reservation(b.appointmentId)),
          day.format(new Date(b.startTime)),
          time.format(new Date(b.startTime)),
          b.serviceName,
          b.quantity,
          b.branchName,
          b.customerEmail,
          said[b.status] ?? b.status,
          b.depositMinor,
          b.platformFeeMinor,
          b.others.reduce((total, line) => total + line.amountMinor, 0),
          b.netMinor,
          currency,
        ]),
      ),
      ...detail.adjustments.map((a) =>
        toCsvRow(['', day.format(new Date(a.createdAt)), '', say(l, 'Correction: {reason}', { reason: a.reason ?? '' }), '', '', '', '', '', '', a.amountMinor, a.amountMinor, currency]),
      ),
      toCsvRow([say(l, 'Total'), '', '', '', '', '', '', '', detail.totals.depositsMinor, detail.totals.platformFeesMinor, detail.totals.netMinor - detail.totals.depositsMinor - detail.totals.platformFeesMinor, detail.totals.netMinor, currency]),
    ];
    return { csv: `${lines.join('\r\n')}\r\n`, filename: `payout-${day.format(new Date(detail.payout.runAt))}.csv` };
  }

  /** The bookings in a payout, each with only this payout's money on it (§290). */
  private async payoutBookings(payoutId: string, page: { take?: number; skip?: number }) {
    const rows = await this.prisma.appointment.findMany({
      where: { ledgerEntries: { some: { payoutId } } },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      ...page,
      select: {
        id: true,
        startTime: true,
        status: true,
        quantity: true,
        serviceId: true,
        service: { select: { name: true } },
        location: { select: { name: true } },
        customer: { select: { email: true } },
        ledgerEntries: { where: { payoutId }, select: { type: true, settlementAmountMinor: true, amountMinor: true } },
      },
    });
    return rows.map((row) => {
      const amount = (entry: (typeof row.ledgerEntries)[number]) => entry.settlementAmountMinor ?? entry.amountMinor;
      const of = (type: LedgerEntryType) =>
        row.ledgerEntries.filter((entry) => entry.type === type).reduce((total, entry) => total + amount(entry), 0);
      const others = new Map<LedgerEntryType, number>();
      for (const entry of row.ledgerEntries) {
        if (entry.type === LedgerEntryType.DEPOSIT_RECEIVED || entry.type === LedgerEntryType.PLATFORM_FEE) continue;
        others.set(entry.type, (others.get(entry.type) ?? 0) + amount(entry));
      }
      return {
        appointmentId: row.id,
        startTime: row.startTime.toISOString(),
        status: row.status,
        serviceId: row.serviceId,
        serviceName: row.service.name,
        quantity: row.quantity,
        branchName: row.location.name,
        // As Appointments shows them (§213), so the same person can be found there.
        customerEmail: row.customer.email,
        depositMinor: of(LedgerEntryType.DEPOSIT_RECEIVED),
        platformFeeMinor: of(LedgerEntryType.PLATFORM_FEE),
        others: [...others].map(([type, amountMinor]) => ({ type, amountMinor })),
        netMinor: row.ledgerEntries.reduce((total, entry) => total + amount(entry), 0),
      };
    });
  }

  /** How long a booking's money waits after the visit before it can be paid (§290). */
  private async holdDays() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
      select: { payoutHoldDays: true },
    });
    return row?.payoutHoldDays ?? DEFAULT_PAYOUT_HOLD_DAYS;
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

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId: actor.userId,
        businessProfileId: businessId,
        status: BusinessMemberStatus.ACTIVE,
      },
      select: MEMBERSHIP_SCOPE_SELECT,
    });
    // 404, not 403: the same rule used everywhere. Do not confirm that another
    // tenant's business exists to someone who may not read it.
    if (!membership) throw new NotFoundException('Business not found.');
    // A member, but the money is not theirs to read (§277).
    if (!mayReadMoney(membership.role, scopeOf(membership))) throw new ForbiddenException(MONEY_READERS_ONLY);
  }

  private async requirePayout(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found.');
    return payout;
  }
}
