import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RefundReason, RefundStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursementProviderRegistry } from '../payments/disbursement-provider.registry';
import type { ListRefundsDto, MarkRefundSentDto } from './dto/refund-request.dto';
import { CountriesService } from '../countries/countries.service';

/** Tries with the operator before a person takes over. */
export const REFUND_ATTEMPTS = 3;

const LIST_SELECT = {
  id: true,
  reason: true,
  status: true,
  amountMinor: true,
  currency: true,
  phoneNumber: true,
  provider: true,
  attempts: true,
  reference: true,
  failureReason: true,
  sentAt: true,
  doneAt: true,
  createdAt: true,
  appointment: {
    select: {
      id: true,
      startTime: true,
      cancelledAt: true,
      service: { select: { name: true } },
      customer: { select: { email: true } },
      location: { select: { name: true, business: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.RefundSelect;

/**
 * Deposits going back to customers (§313).
 *
 * The ledger already says when a deposit is given back — a shop's
 * cancellation (§25, §36), or a customer's made at least 24 hours before.
 * This sends it: to the number that paid, through the operator's transfer, the
 * way payouts go (§64) — recorded before it is asked for, claimed so it can
 * never go twice, checked until the operator answers. Three refusals and our
 * team takes over, by the console, sending it themselves if they must.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disbursements: DisbursementProviderRegistry,
    private readonly countries: CountriesService,
  ) {}

  /** The country a refund goes back in (§315): its booking's shop's — whose connection sends it. */
  private async countryOf(appointmentId: string) {
    const booking = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, select: { locationId: true } });
    return this.countries.ofLocation(booking.locationId);
  }

  /**
   * Writes the refund down, in the cancellation's own transaction: the
   * cancellation, the ledger's refund and this commit together or not at all.
   * Exactly what was paid, in the currency it was paid in, back to the number
   * it came from. Nothing when nothing was paid.
   */
  async owe(tx: Prisma.TransactionClient, appointmentId: string, reason: RefundReason) {
    const a = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        depositPaidAt: true,
        depositAmountMinor: true,
        currency: true,
        providerAmountMinor: true,
        providerCurrency: true,
        paymentPhoneNumber: true,
        paymentProvider: true,
      },
    });
    if (!a.depositPaidAt) return null;
    return tx.refund.create({
      data: {
        appointmentId,
        reason,
        amountMinor: a.providerAmountMinor ?? a.depositAmountMinor,
        currency: a.providerCurrency ?? a.currency,
        phoneNumber: a.paymentPhoneNumber,
        provider: a.paymentProvider,
      },
    });
  }

  /** Every refund owed that can go now. Run by the scheduler, and right after a cancellation. */
  async sendDue(): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: { status: RefundStatus.PENDING, phoneNumber: { not: null }, provider: { not: null }, attempts: { lt: REFUND_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    let sent = 0;
    for (const { id } of due) {
      if (await this.sendOne(id)) sent++;
    }
    return sent;
  }

  /**
   * Hands one refund to the operator. Claimed first — PENDING to SENDING in
   * one statement — so two runs can never both send it; our reference is
   * written before the call, so the operator refuses a repeat.
   */
  async sendOne(id: string): Promise<boolean> {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund || refund.status !== RefundStatus.PENDING || !refund.phoneNumber || !refund.provider) return false;
    const country = await this.countryOf(refund.appointmentId);
    if (!this.disbursements.isAvailable(refund.provider, country)) {
      // Nothing here can send on that network: straight to our team, rather than
      // "on its way" for ever.
      await this.prisma.refund.update({
        where: { id },
        data: { status: RefundStatus.FAILED, failureReason: `Refunds cannot be sent automatically on ${refund.provider}: send it by hand.` },
      });
      return false;
    }
    const provider = this.disbursements.require(refund.provider, country);

    const reference = randomUUID();
    const claimed = await this.prisma.refund.updateMany({
      where: { id, status: RefundStatus.PENDING },
      data: {
        status: RefundStatus.SENDING,
        providerReferenceId: reference,
        sentAt: new Date(),
        attempts: { increment: 1 },
        failureReason: null,
      },
    });
    if (claimed.count === 0) return false;

    let failure: string | null = null;
    try {
      const result = await provider.sendTransfer({
        msisdn: refund.phoneNumber.replace(/\D/g, ''),
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        externalReferenceId: reference,
        payeeNote: `Refund ${refund.appointmentId.slice(0, 8)}`,
        payerMessage: 'Booking deposit refund',
      });
      if (result.status === 'FAILED') failure = result.failureReason ?? 'The operator refused the transfer.';
    } catch (error) {
      failure = error instanceof Error ? error.message : 'The operator could not be reached.';
    }

    if (failure) {
      // Nothing is in flight: back to waiting, or to a person after the last try.
      await this.prisma.refund.update({
        where: { id },
        data: {
          status: refund.attempts + 1 >= REFUND_ATTEMPTS ? RefundStatus.FAILED : RefundStatus.PENDING,
          providerReferenceId: null,
          sentAt: null,
          failureReason: failure,
        },
      });
      this.logger.warn(`Refund ${id} was not sent (try ${refund.attempts + 1}): ${failure}`);
      return false;
    }
    this.logger.log(`Refund ${id} handed to ${provider.key} as ${reference}: ${refund.amountMinor} ${refund.currency} minor.`);
    return true;
  }

  /** Asks the operator about every refund in flight; writes only a final answer. */
  async pollInFlight(): Promise<{ sent: number; failed: number }> {
    const inFlight = await this.prisma.refund.findMany({
      where: { status: RefundStatus.SENDING, providerReferenceId: { not: null } },
      select: { id: true, provider: true, providerReferenceId: true, attempts: true, appointmentId: true },
    });
    let sent = 0;
    let failed = 0;
    for (const refund of inFlight) {
      try {
        const country = await this.countryOf(refund.appointmentId);
        if (!refund.provider || !this.disbursements.isAvailable(refund.provider, country)) continue;
        const result = await this.disbursements.require(refund.provider, country).checkTransferStatus(refund.providerReferenceId!);
        if (result.status === 'PENDING') continue;
        if (result.status === 'SUCCESSFUL') {
          await this.prisma.refund.update({
            where: { id: refund.id },
            data: { status: RefundStatus.SENT, doneAt: new Date(), reference: result.providerReference ?? refund.providerReferenceId },
          });
          sent++;
          continue;
        }
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: refund.attempts >= REFUND_ATTEMPTS ? RefundStatus.FAILED : RefundStatus.PENDING,
            providerReferenceId: null,
            sentAt: null,
            failureReason: result.failureReason ?? 'The operator reported a failure.',
          },
        });
        failed++;
      } catch (error) {
        this.logger.error(`Could not check refund ${refund.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return { sent, failed };
  }

  // ---------- Our team ----------

  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only an administrator can do this.');
  }

  async list(actor: { role: UserRole | string }, query: ListRefundsDto) {
    this.assertAdmin(actor);
    const where: Prisma.RefundWhereInput = query.status ? { status: query.status } : {};
    const limit = query.limit ?? 40;
    const offset = query.offset ?? 0;
    const [total, rows, counts] = await Promise.all([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, select: LIST_SELECT }),
      this.prisma.refund.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      total,
      limit,
      offset,
      counts: Object.fromEntries(Object.values(RefundStatus).map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])),
      refunds: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        amountMinor: r.amountMinor,
        currency: r.currency,
        phoneNumber: r.phoneNumber,
        provider: r.provider,
        attempts: r.attempts,
        reference: r.reference,
        failureReason: r.failureReason,
        sentAt: r.sentAt?.toISOString() ?? null,
        doneAt: r.doneAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        appointment: {
          id: r.appointment.id,
          startTime: r.appointment.startTime.toISOString(),
          cancelledAt: r.appointment.cancelledAt?.toISOString() ?? null,
          serviceName: r.appointment.service.name,
          customerEmail: r.appointment.customer.email,
          branchName: r.appointment.location.name,
          businessId: r.appointment.location.business.id,
          businessName: r.appointment.location.business.name ?? 'Unnamed shop',
        },
      })),
    };
  }

  /** Tries again now: a refund the operator refused, or one waiting. */
  async retry(actor: { role: UserRole | string }, id: string) {
    this.assertAdmin(actor);
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status !== RefundStatus.FAILED && refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException(`Only a refund waiting or refused can be tried again. This one is ${refund.status}.`);
    }
    if (!refund.phoneNumber || !refund.provider) {
      throw new BadRequestException('There is no number to send it to. Send it by hand and mark it sent.');
    }
    await this.prisma.refund.update({ where: { id }, data: { status: RefundStatus.PENDING, attempts: 0 } });
    await this.sendOne(id);
    return this.prisma.refund.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, failureReason: true } });
  }

  /** Our team sent it themselves — from the operator's portal, to the number they confirmed. */
  async markSent(actor: { userId: string; role: UserRole | string }, id: string, dto: MarkRefundSentDto) {
    this.assertAdmin(actor);
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status === RefundStatus.SENT) throw new BadRequestException('This refund is already sent.');
    if (refund.status === RefundStatus.SENDING) {
      throw new BadRequestException('This refund is with the operator now. Wait for its answer before sending it another way.');
    }
    const now = new Date();
    return this.prisma.refund.update({
      where: { id },
      data: {
        status: RefundStatus.SENT,
        reference: dto.reference.trim(),
        phoneNumber: dto.phoneNumber?.replace(/\D/g, '') || refund.phoneNumber,
        sentAt: now,
        doneAt: now,
        sentByUserId: actor.userId,
        failureReason: null,
      },
      select: { id: true, status: true },
    });
  }
}
