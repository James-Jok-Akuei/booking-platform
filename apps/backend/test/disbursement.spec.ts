import { jest } from '@jest/globals';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { LedgerEntryType, MobileMoneyProvider, PayoutStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { PayoutsScheduler } from '../src/payouts/payouts.scheduler';
import { DisbursementProviderRegistry } from '../src/payments/disbursement-provider.registry';
import type {
  DisbursementProvider,
  SendTransferResult,
  TransferStatusResult,
} from '../src/payments/disbursement-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, asUser, createAdmin, createBusiness } from './setup/factories';

const DAY = 86_400_000;

/**
 * Sending a payout through the operator (§64).
 *
 * The behaviour worth testing here is not "the happy path works" — it is what
 * happens when it does not. Money out cannot be undone, so every test below is
 * about a failure mode: a crash mid-send, an operator that refuses, a transfer
 * accepted and then lost, and the same payout sent twice.
 */
describe('Automated disbursement (§64)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payouts: PayoutsService;
  let scheduler: PayoutsScheduler;
  let provider: DisbursementProvider & {
    sendTransfer: jest.Mock;
    checkTransferStatus: jest.Mock;
  };

  let admin: { userId: string; email: string };
  let business: TestBusiness;

  /** Lets a test see the database AS THE PROVIDER SEES IT, mid-call. */
  let onSend: ((reference: string) => Promise<void>) | null = null;

  beforeAll(async () => {
    provider = {
      key: MobileMoneyProvider.MTN_MOMO,
      name: 'fake disbursement',
      isConfigured: () => true,
      sendTransfer: jest.fn(async (params: { externalReferenceId: string }) => {
        if (onSend) await onSend(params.externalReferenceId);
        return { status: 'ACCEPTED' } as SendTransferResult;
      }),
      checkTransferStatus: jest.fn(
        async (_ref: string) => ({ status: 'PENDING' }) as TransferStatusResult,
      ),
    } as never;

    moduleRef = await createTestModule([
      PayoutsService,
      PayoutDestinationsService,
      PayoutsScheduler,
      commonStubs.notifications(),
      {
        provide: DisbursementProviderRegistry,
        useValue: new DisbursementProviderRegistry([provider]),
      },
    ]);
    prisma = moduleRef.get(PrismaService);
    payouts = moduleRef.get(PayoutsService);
    scheduler = moduleRef.get(PayoutsScheduler);

    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    business = await createBusiness(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    onSend = null;
    provider.sendTransfer.mockClear();
    provider.checkTransferStatus.mockClear();
    await prisma.ledgerEntry.deleteMany({});
    await prisma.payout.deleteMany({});
    // BOTH fields, not just status. A destination's provider is business-level
    // state that outlives a test, and one case below switches it to Airtel —
    // restoring only the status left every later test trying to pay through an
    // operator this registry does not have.
    await prisma.payoutDestination.updateMany({
      data: { status: 'VERIFIED', provider: MobileMoneyProvider.MTN_MOMO },
    });
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');

  const entry = (amountMinor: number) =>
    prisma.ledgerEntry.create({
      data: {
        businessId: business.businessId,
        type: LedgerEntryType.DEPOSIT_RECEIVED,
        amountMinor,
        currency: 'USD',
        settlementCurrency: 'USD',
        settlementAmountMinor: amountMinor,
        bookingExchangeRate: 1,
        availableAt: new Date(Date.now() - DAY),
      },
    });

  /** A PENDING payout, made the way the platform makes one. */
  const pendingPayout = async (amountMinor = 5000) => {
    await entry(amountMinor);
    await payouts.run();
    return prisma.payout.findFirstOrThrow({ where: { businessId: business.businessId } });
  };

  // ==================================================================
  describe('the row is written BEFORE the operator is called', () => {
    /**
     * The safety property the whole design rests on. If the call succeeds and
     * the process dies before recording anything, a PENDING payout is one press
     * away from paying the business twice.
     */
    it('is already PROCESSING, with a reference, by the time the operator sees it', async () => {
      const payout = await pendingPayout();
      let seen: { status: PayoutStatus; providerReferenceId: string | null } | null = null;

      onSend = async () => {
        seen = await prisma.payout.findUniqueOrThrow({
          where: { id: payout.id },
          select: { status: true, providerReferenceId: true },
        });
      };

      await payouts.send(AS_ADMIN(), payout.id);

      expect(seen!.status).toBe(PayoutStatus.PROCESSING);
      expect(seen!.providerReferenceId).toBeTruthy();
    });

    it('hands the operator the SAME reference it recorded', async () => {
      const payout = await pendingPayout();

      await payouts.send(AS_ADMIN(), payout.id);

      const stored = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      const sent = provider.sendTransfer.mock.calls[0][0] as { externalReferenceId: string };
      // MTN keys a transfer on this id, so matching is what makes a retry a
      // rejected duplicate rather than a second payment.
      expect(sent.externalReferenceId).toBe(stored.providerReferenceId);
    });

    it('sends the SETTLEMENT amount and currency, never the internal one', async () => {
      const payout = await pendingPayout(5000);

      await payouts.send(AS_ADMIN(), payout.id);

      const sent = provider.sendTransfer.mock.calls[0][0] as {
        amountMinor: number;
        currency: string;
      };
      expect(sent.amountMinor).toBe(payout.settlementAmountMinor);
      expect(sent.currency).toBe(payout.settlementCurrency);
    });
  });

  // ==================================================================
  describe('a payout can only be sent once', () => {
    it('leaves it PROCESSING after a successful hand-off', async () => {
      const payout = await pendingPayout();

      const result = await payouts.send(AS_ADMIN(), payout.id);

      // NOT paid. The operator accepted the request; whether the money arrived
      // is only knowable from the status poll.
      expect(result.status).toBe(PayoutStatus.PROCESSING);
      expect(result.sentAt).not.toBeNull();
    });

    it('refuses to send one that is already PROCESSING', async () => {
      const payout = await pendingPayout();
      await payouts.send(AS_ADMIN(), payout.id);

      await expect(payouts.send(AS_ADMIN(), payout.id)).rejects.toThrow(
        /already with the operator/,
      );
      expect(provider.sendTransfer).toHaveBeenCalledTimes(1);
    });

    it('refuses to send one that is already PAID', async () => {
      const payout = await pendingPayout();
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: PayoutStatus.PAID, reference: 'done' },
      });

      await expect(payouts.send(AS_ADMIN(), payout.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(provider.sendTransfer).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  describe('an operator that refuses the request', () => {
    it('goes back to PENDING, not FAILED', async () => {
      const payout = await pendingPayout();
      provider.sendTransfer.mockResolvedValueOnce({
        status: 'FAILED',
        failureKind: 'INSUFFICIENT_FUNDS',
        failureReason: 'Provider rejected the transfer (HTTP 500): NOT_ENOUGH_FUNDS.',
      } as never);

      const result = await payouts.send(AS_ADMIN(), payout.id);

      // Nothing is in flight, so the money stays stamped to this payout ready
      // for another attempt. FAILED is for a transfer that was accepted and
      // then did not arrive — that is what releases the entries.
      expect(result.status).toBe(PayoutStatus.PENDING);
      expect(result.providerReferenceId).toBeNull();
      expect(result.failureReason).toMatch(/NOT_ENOUGH_FUNDS/);
    });

    it('keeps the ledger entries stamped, so no other run picks them up', async () => {
      const payout = await pendingPayout();
      provider.sendTransfer.mockResolvedValueOnce({
        status: 'FAILED',
        failureReason: 'refused',
      } as never);

      await payouts.send(AS_ADMIN(), payout.id);

      const stamped = await prisma.ledgerEntry.count({ where: { payoutId: payout.id } });
      expect(stamped).toBeGreaterThan(0);
    });

    it('can be sent again afterwards, with a NEW reference', async () => {
      const payout = await pendingPayout();
      provider.sendTransfer.mockResolvedValueOnce({
        status: 'FAILED',
        failureReason: 'refused',
      } as never);
      await payouts.send(AS_ADMIN(), payout.id);

      const second = await payouts.send(AS_ADMIN(), payout.id);

      expect(second.status).toBe(PayoutStatus.PROCESSING);
      expect(provider.sendTransfer).toHaveBeenCalledTimes(2);
    });
  });

  // ==================================================================
  describe('there has to be somewhere to send it', () => {
    it('refuses when the business has no VERIFIED destination', async () => {
      const payout = await pendingPayout();
      await prisma.payoutDestination.updateMany({
        where: { businessId: business.businessId },
        data: { status: 'UNVERIFIED' },
      });

      await expect(payouts.send(AS_ADMIN(), payout.id)).rejects.toThrow(
        /no VERIFIED payout destination/,
      );
      expect(provider.sendTransfer).not.toHaveBeenCalled();
    });

    it('refuses when that operator cannot be paid through here', async () => {
      const payout = await pendingPayout();
      await prisma.payoutDestination.updateMany({
        where: { businessId: business.businessId },
        data: { provider: MobileMoneyProvider.AIRTEL_MONEY },
      });

      // A 503, not a 400: the destination is perfectly valid and the gap is on
      // the platform's side.
      await expect(payouts.send(AS_ADMIN(), payout.id)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  // ==================================================================
  describe('the poll decides what actually happened', () => {
    const sendOne = async () => {
      const payout = await pendingPayout();
      await payouts.send(AS_ADMIN(), payout.id);
      return payout;
    };

    it('leaves a still-pending transfer alone', async () => {
      const payout = await sendOne();

      await scheduler.pollTransfers();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(after.status).toBe(PayoutStatus.PROCESSING);
    });

    it('marks a successful transfer PAID, with the OPERATOR reference', async () => {
      const payout = await sendOne();
      provider.checkTransferStatus.mockResolvedValueOnce({
        status: 'SUCCESSFUL',
        providerReference: 'MTN-FIN-12345',
      } as never);

      const result = await scheduler.pollTransfers();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(result.paid).toBe(1);
      expect(after.status).toBe(PayoutStatus.PAID);
      // The operator's own id is what reconciles against a statement.
      expect(after.reference).toBe('MTN-FIN-12345');
      expect(after.paidAt).not.toBeNull();
    });

    it('leaves a paid payout’s entries stamped to it', async () => {
      const payout = await sendOne();
      provider.checkTransferStatus.mockResolvedValueOnce({
        status: 'SUCCESSFUL',
        providerReference: 'MTN-FIN-1',
      } as never);

      await scheduler.pollTransfers();

      const released = await prisma.ledgerEntry.count({
        where: { businessId: business.businessId, payoutId: null },
      });
      expect(released).toBe(0);
    });

    it('marks a failed transfer FAILED and RELEASES its entries', async () => {
      const payout = await sendOne();
      provider.checkTransferStatus.mockResolvedValueOnce({
        status: 'FAILED',
        failureReason: 'PAYEE_NOT_FOUND',
      } as never);

      const result = await scheduler.pollTransfers();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(result.failed).toBe(1);
      expect(after.status).toBe(PayoutStatus.FAILED);
      expect(after.failureReason).toMatch(/PAYEE_NOT_FOUND/);

      // Money that did not arrive has to be payable again, or it is stranded
      // forever and invisible to every future run.
      const released = await prisma.ledgerEntry.count({
        where: { businessId: business.businessId, payoutId: null },
      });
      expect(released).toBeGreaterThan(0);
    });

    it('picks released money up on the next run', async () => {
      await sendOne();
      provider.checkTransferStatus.mockResolvedValueOnce({
        status: 'FAILED',
        failureReason: 'gone',
      } as never);
      await scheduler.pollTransfers();

      const summary = await payouts.run();

      expect(summary.payoutsCreated).toBe(1);
    });

    it('an operator that throws does not stop the sweep', async () => {
      const payout = await sendOne();
      provider.checkTransferStatus.mockRejectedValueOnce(new Error('MTN is down') as never);

      await expect(scheduler.pollTransfers()).resolves.toBeDefined();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(after.status).toBe(PayoutStatus.PROCESSING);
    });
  });
});
