import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BusinessMemberRole,
  LedgerEntryType,
  NotificationType,
  PayoutDestinationStatus,
  PayoutVerificationMethod,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { CreatePayoutDestinationDto } from '../src/payouts/dto/create-payout-destination.dto';
import { VerifyPayoutDestinationDto } from '../src/payouts/dto/verify-payout-destination.dto';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  addMember,
  asUser,
  createAdmin,
  createBusiness,
} from './setup/factories';

const DAY = 86_400_000;
const VALID = '+211921234567';

/**
 * Payout destinations (§48).
 *
 * Sending money to an unverified number is the only mistake in this system that
 * cannot be undone by appending a correcting entry (§34.2). Everything here is
 * about making that impossible by default rather than by remembering.
 */
describe('Payout destinations (§48)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let destinations: PayoutDestinationsService;
  let payouts: PayoutsService;
  let notifications: {
    notify: { mock: { calls: any[][] } };
    notifyBusiness: { mock: { calls: any[][] } };
  };

  let admin: { userId: string; email: string };
  let shop: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      PayoutDestinationsService,
      PayoutsService,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    destinations = moduleRef.get(PayoutDestinationsService);
    payouts = moduleRef.get(PayoutsService);
    notifications = moduleRef.get(NotificationsService) as never;
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    notifications.notify.mock.calls.length = 0;
    notifications.notifyBusiness.mock.calls.length = 0;
    // A business with NO destination, so each test states its own starting
    // position rather than inheriting the factory's verified one.
    shop = await createBusiness(prisma, { payoutDestination: 'NONE' });
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');

  const live = (businessId: string) =>
    prisma.payoutDestination.findFirst({
      where: { businessId, status: { not: PayoutDestinationStatus.SUPERSEDED } },
    });

  const rowsFor = (businessId: string) =>
    prisma.payoutDestination.findMany({
      where: { businessId },
      orderBy: { submittedAt: 'asc' },
    });

  const submit = (business: TestBusiness, msisdn = VALID) =>
    destinations.submit(business.userId, { msisdn });

  const verified = async (business: TestBusiness, msisdn = VALID) => {
    const created = await submit(business, msisdn);
    return destinations.verify(AS_ADMIN(), created.id as string, {
      verificationNote: 'Called the owner on a known number.',
    });
  };

  // ------------------------------------------------------------------
  describe('submitting', () => {
    it('creates an UNVERIFIED row', async () => {
      const created: any = await submit(shop);

      expect(created.status).toBe(PayoutDestinationStatus.UNVERIFIED);
      expect(created.msisdn).toBe(VALID);
      expect(created.verificationMethod).toBeNull();
      expect(created.verifiedAt).toBeNull();
    });

    it('tells every admin there is something to verify', async () => {
      await createAdmin(prisma);

      await submit(shop);

      const types = notifications.notify.mock.calls.map((c) => c[0].type);
      expect(types).toContain(NotificationType.PAYOUT_DESTINATION_SUBMITTED);
      expect(notifications.notify.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('masks the number even in the admin notification', async () => {
      await submit(shop);

      const call = notifications.notify.mock.calls[0][0];
      // The full number belongs in the admin queue behind a login, not in an
      // email that will sit in an inbox forever.
      expect(call.context.reason).not.toContain(VALID);
      expect(call.context.reason).toContain('567');
    });

    describe('supersession', () => {
      it('supersedes the previous row instead of editing it', async () => {
        const first: any = await submit(shop, '+211921111111');

        await submit(shop, '+211922222222');

        const rows = await rowsFor(shop.businessId);
        expect(rows).toHaveLength(2);
        const original = rows.find((r) => r.id === first.id)!;
        expect(original.status).toBe(PayoutDestinationStatus.SUPERSEDED);
        // The old number is still readable. It is the record of where money
        // was sent, and it has to survive the number changing.
        expect(original.msisdn).toBe('+211921111111');
      });

      it('NEVER mutates a VERIFIED row', async () => {
        const first: any = await verified(shop, '+211921111111');
        const before = await prisma.payoutDestination.findUniqueOrThrow({
          where: { id: first.id },
        });

        await submit(shop, '+211922222222');

        const after = await prisma.payoutDestination.findUniqueOrThrow({
          where: { id: first.id },
        });
        // Only the status moves to SUPERSEDED; everything that recorded WHAT
        // was verified and by whom is untouched.
        expect(after.status).toBe(PayoutDestinationStatus.SUPERSEDED);
        expect(after.msisdn).toBe(before.msisdn);
        expect(after.verifiedById).toBe(before.verifiedById);
        expect(after.verifiedAt).toEqual(before.verifiedAt);
        expect(after.verificationMethod).toBe(before.verificationMethod);
        expect(after.verificationNote).toBe(before.verificationNote);
      });

      it('returns the business to UNVERIFIED', async () => {
        await verified(shop);

        await submit(shop, '+211922222222');

        const current = await live(shop.businessId);
        expect(current!.status).toBe(PayoutDestinationStatus.UNVERIFIED);
      });

      it('leaves exactly one live row after several submissions', async () => {
        await submit(shop, '+211921111111');
        await submit(shop, '+211922222222');
        await submit(shop, '+211923333333');

        const rows = await rowsFor(shop.businessId);
        const liveRows = rows.filter(
          (r) => r.status !== PayoutDestinationStatus.SUPERSEDED,
        );
        expect(rows).toHaveLength(3);
        expect(liveRows).toHaveLength(1);
        expect(liveRows[0].msisdn).toBe('+211923333333');
      });

      it('the DATABASE refuses two live rows, not just the service', async () => {
        await submit(shop);

        // Bypassing the service entirely: two simultaneous submissions must not
        // be able to race into two live destinations (§15.2's pattern).
        await expect(
          prisma.payoutDestination.create({
            data: {
              businessId: shop.businessId,
              msisdn: '+211929999999',
              submittedById: shop.userId,
              status: PayoutDestinationStatus.UNVERIFIED,
            },
          }),
        ).rejects.toThrow();
      });

      it('allows any number of SUPERSEDED rows alongside the live one', async () => {
        for (let i = 1; i <= 4; i++) await submit(shop, `+21192111111${i}`);

        const rows = await rowsFor(shop.businessId);
        expect(rows.filter((r) => r.status === PayoutDestinationStatus.SUPERSEDED))
          .toHaveLength(3);
      });
    });
  });

  // ------------------------------------------------------------------
  describe('who may do what', () => {
    it('a MANAGER cannot submit', async () => {
      const manager = await addMember(
        prisma,
        shop.businessId,
        BusinessMemberRole.MANAGER,
      );

      await expect(
        destinations.submit(manager.userId, { msisdn: VALID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a STAFF member cannot submit', async () => {
      const staff = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);

      await expect(
        destinations.submit(staff.userId, { msisdn: VALID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a non-owner sees the STATUS but only the last 3 digits', async () => {
      await verified(shop);
      const staff = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);

      const view: any = await destinations.findForBusiness(staff.userId);

      // Staff need to know WHY payouts are paused; they have no reason to know
      // where the money goes.
      expect(view.destination.status).toBe(PayoutDestinationStatus.VERIFIED);
      expect(view.destination).not.toHaveProperty('msisdn');
      expect(view.destination.msisdnLast3).toContain('567');
      expect(JSON.stringify(view)).not.toContain(VALID);
    });

    it('the OWNER sees the full number', async () => {
      await verified(shop);

      const view: any = await destinations.findForBusiness(shop.userId);

      expect(view.destination.msisdn).toBe(VALID);
    });

    it('reports no destination at all as paused, with an explanation', async () => {
      const view: any = await destinations.findForBusiness(shop.userId);

      expect(view.destination).toBeNull();
      expect(view.payoutsPaused).toBe(true);
      expect(view.note).toMatch(/nothing is lost/i);
    });
  });

  // ------------------------------------------------------------------
  describe('MSISDN validation', () => {
    const shapeErrors = async (msisdn: string) => {
      const dto = plainToInstance(CreatePayoutDestinationDto, { msisdn });
      return (await validate(dto as object)).map((e) => e.property);
    };

    it.each([
      ['no plus', '211921234567'],
      ['letters', '+21192abc4567'],
      ['far too short', '+21192'],
      ['far too long', '+2119212345678901234'],
      ['a zero country code', '+011921234567'],
      ['empty', ''],
    ])('rejects %s at the DTO', async (_label, msisdn) => {
      expect(await shapeErrors(msisdn)).toContain('msisdn');
    });

    it('accepts a well-formed number at the DTO', async () => {
      expect(await shapeErrors(VALID)).toHaveLength(0);
    });

    it('rejects a valid E.164 number from the wrong country', async () => {
      // Shape-valid, so only the service can catch it — the expected prefix is
      // configurable and does not belong in a decorator (§48.2).
      await expect(
        destinations.submit(shop.userId, { msisdn: '+447700900123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts the configured country and strips spacing', async () => {
      const created: any = await destinations.submit(shop.userId, {
        msisdn: '+211 921 234 567',
      });

      expect(created.msisdn).toBe(VALID);
    });
  });

  // ------------------------------------------------------------------
  describe('verification', () => {
    it('records ADMIN as the method, and who did it', async () => {
      const created: any = await submit(shop);

      const result: any = await destinations.verify(AS_ADMIN(), created.id, {
        verificationNote: 'Confirmed by phone with the owner.',
      });

      expect(result.status).toBe(PayoutDestinationStatus.VERIFIED);
      // The distinction that makes an OTP path additive rather than a
      // reinterpretation of these rows (§48.1).
      expect(result.verificationMethod).toBe(PayoutVerificationMethod.ADMIN);
      expect(result.verifiedById).toBe(admin.userId);
      expect(result.verifiedAt).not.toBeNull();
      expect(result.verificationNote).toBe('Confirmed by phone with the owner.');
    });

    it('tells the business', async () => {
      const created: any = await submit(shop);

      await destinations.verify(AS_ADMIN(), created.id, {
        verificationNote: 'Checked.',
      });

      const call = notifications.notifyBusiness.mock.calls.at(-1)![0];
      expect(call.type).toBe(NotificationType.PAYOUT_DESTINATION_VERIFIED);
      expect(call.businessId).toBe(shop.businessId);
    });

    it('refuses a note that is missing or too short', async () => {
      const missing = plainToInstance(VerifyPayoutDestinationDto, {});
      const short = plainToInstance(VerifyPayoutDestinationDto, {
        verificationNote: 'x',
      });

      expect((await validate(missing as object)).map((e) => e.property)).toContain(
        'verificationNote',
      );
      expect((await validate(short as object)).map((e) => e.property)).toContain(
        'verificationNote',
      );
    });

    it('refuses to verify anything that is not UNVERIFIED', async () => {
      const created: any = await verified(shop);

      await expect(
        destinations.verify(AS_ADMIN(), created.id, { verificationNote: 'Again.' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with a reason, and tells the business', async () => {
      const created: any = await submit(shop);

      const result: any = await destinations.reject(AS_ADMIN(), created.id, {
        reason: 'Number belongs to a different person.',
      });

      expect(result.status).toBe(PayoutDestinationStatus.REJECTED);
      expect(result.rejectionReason).toBe('Number belongs to a different person.');
      const call = notifications.notifyBusiness.mock.calls.at(-1)![0];
      expect(call.type).toBe(NotificationType.PAYOUT_DESTINATION_REJECTED);
      expect(call.context.reason).toBe('Number belongs to a different person.');
    });

    it('404s on a destination that does not exist', async () => {
      await expect(
        destinations.verify(AS_ADMIN(), '00000000-0000-4000-8000-000000000000', {
          verificationNote: 'Ghost.',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['CUSTOMER', 'BUSINESS'])(
      'refuses a %s at the service level',
      async (role) => {
        const created: any = await submit(shop);

        await expect(
          destinations.verify({ userId: shop.userId, role }, created.id, {
            verificationNote: 'Let me.',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          destinations.list({ role }, {}),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const row = await live(shop.businessId);
        expect(row!.status).toBe(PayoutDestinationStatus.UNVERIFIED);
      },
    );

    it('queues UNVERIFIED first', async () => {
      const other = await createBusiness(prisma, { payoutDestination: 'NONE' });
      await verified(shop);
      await submit(other);

      const queue = await destinations.list(AS_ADMIN(), {});

      expect(queue.destinations[0].status).toBe(PayoutDestinationStatus.UNVERIFIED);
    });
  });

  // ------------------------------------------------------------------
  describe('effect on payouts', () => {
    /** Matured, unstamped money waiting for this business. */
    const owed = (business: TestBusiness, amount = 100_000) =>
      prisma.ledgerEntry.create({
        data: {
          businessId: business.businessId,
          type: LedgerEntryType.DEPOSIT_RECEIVED,
          amountMinor: 1000,
          currency: 'USD',
          settlementCurrency: 'SSP',
          settlementAmountMinor: amount,
          availableAt: new Date(Date.now() - DAY),
        },
      });

    const payoutsFor = (business: TestBusiness) =>
      prisma.payout.findMany({ where: { businessId: business.businessId } });

    it.each([
      ['no destination at all', 'NONE'],
      ['an UNVERIFIED destination', 'UNVERIFIED'],
    ])('pauses a business with %s', async (_label, state) => {
      await owed(shop);
      if (state === 'UNVERIFIED') await submit(shop);

      const summary = await payouts.run();

      expect(summary.pausedForUnverifiedDestination).toBeGreaterThanOrEqual(1);
      expect(await payoutsFor(shop)).toHaveLength(0);
      // Entries stay in the pool. Nothing is written off.
      const entries = await prisma.ledgerEntry.findMany({
        where: { businessId: shop.businessId },
      });
      expect(entries.every((e) => e.payoutId === null)).toBe(true);
    });

    it('pauses a business whose destination was REJECTED', async () => {
      await owed(shop);
      const created: any = await submit(shop);
      await destinations.reject(AS_ADMIN(), created.id, { reason: 'Wrong person.' });

      const summary = await payouts.run();

      expect(summary.pausedForUnverifiedDestination).toBeGreaterThanOrEqual(1);
      expect(await payoutsFor(shop)).toHaveLength(0);
    });

    it('pays out on the first run after verification', async () => {
      await owed(shop);
      await payouts.run();
      expect(await payoutsFor(shop)).toHaveLength(0);

      await verified(shop);
      await payouts.run();

      const [payout] = await payoutsFor(shop);
      expect(payout).toBeDefined();
      expect(payout.settlementAmountMinor).toBe(100_000);
    });

    it('names the paused businesses and why, rather than going quiet', async () => {
      await owed(shop);

      const summary = await payouts.run();

      // An admin needs a list to chase, not a silently smaller batch.
      expect(summary.pausedBusinesses).toContainEqual({
        businessId: shop.businessId,
        reason: 'NO_VERIFIED_PAYOUT_DESTINATION',
      });
    });

    it('does not pause a business that IS verified, in the same run', async () => {
      const ready = await createBusiness(prisma);
      await owed(shop);
      await owed(ready, 50_000);

      await payouts.run();

      expect(await payoutsFor(shop)).toHaveLength(0);
      expect(await payoutsFor(ready)).toHaveLength(1);
    });

    describe('changing the number while a payout is PENDING', () => {
      it('is ALLOWED, and does not hard-fail', async () => {
        await verified(shop);
        await owed(shop);
        await payouts.run();
        const [payout] = await payoutsFor(shop);
        expect(payout.status).toBe('PENDING');

        // A business that has lost control of its SIM must be able to change
        // the number immediately — transfers are manual, so PENDING can sit for
        // days (§48.4).
        const changed: any = await destinations.submit(shop.userId, {
          msisdn: '+211929999999',
        });

        expect(changed.status).toBe(PayoutDestinationStatus.UNVERIFIED);
      });

      it('flags that payout as unpayable in the export until re-verified', async () => {
        await verified(shop);
        await owed(shop);
        await payouts.run();
        const [payout] = await payoutsFor(shop);

        await destinations.submit(shop.userId, { msisdn: '+211929999999' });
        const flagged = await payouts.exportRun(AS_ADMIN(), payout.id);

        expect(flagged.unpayableCount).toBe(1);
        expect(flagged.csv).toContain('DO NOT SEND');
        expect(flagged.csv).toContain('NOT RECORDED');
      });

      it('becomes payable again once the new number is verified', async () => {
        await verified(shop);
        await owed(shop);
        await payouts.run();
        const [payout] = await payoutsFor(shop);
        const replacement: any = await destinations.submit(shop.userId, {
          msisdn: '+211929999999',
        });

        await destinations.verify(AS_ADMIN(), replacement.id, {
          verificationNote: 'New SIM confirmed with the owner.',
        });
        const clean = await payouts.exportRun(AS_ADMIN(), payout.id);

        expect(clean.unpayableCount).toBe(0);
        expect(clean.csv).toContain('+211929999999');
        expect(clean.csv).not.toContain('DO NOT SEND');
      });

      it('leaves money already sent alone', async () => {
        await verified(shop);
        await owed(shop);
        await payouts.run();
        const [payout] = await payoutsFor(shop);
        await payouts.markPaid(AS_ADMIN(), payout.id, { reference: 'MOMO-1' });

        await destinations.submit(shop.userId, { msisdn: '+211929999999' });

        const after = await prisma.payout.findUniqueOrThrow({
          where: { id: payout.id },
        });
        // A completed transfer is a fact about the past.
        expect(after.status).toBe('PAID');
        expect(after.reference).toBe('MOMO-1');
        expect(after.settlementAmountMinor).toBe(payout.settlementAmountMinor);
      });
    });
  });

  describe('the returned view is usable by a caller (§51.4)', () => {
    it('submit returns an id the caller can immediately verify with', async () => {
      // The whole point: this used to spread through Record<string, unknown> and
      // collapse to { msisdnLast3 }, so a typed caller could not reach `id` —
      // the demo seed had to re-query for an id it had just been handed.
      const created = await destinations.submit(shop.userId, { msisdn: VALID });

      const verifiedRow = await destinations.verify(AS_ADMIN(), created.id, {
        verificationNote: 'Straight from the submit response.',
      });

      expect(created.id).toBeDefined();
      expect(verifiedRow.id).toBe(created.id);
      expect(verifiedRow.status).toBe(PayoutDestinationStatus.VERIFIED);
    });

    it('carries the full number for the owner and the mask for everyone', async () => {
      const created = await destinations.submit(shop.userId, { msisdn: VALID });

      expect(created.msisdn).toBe(VALID);
      expect(created.msisdnLast3).toContain('567');
      expect(created.status).toBe(PayoutDestinationStatus.UNVERIFIED);
      expect(created.verificationMethod).toBeNull();
    });
  });
});
