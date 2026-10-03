import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  BusinessStatus,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { AccountService } from '../src/users/account.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
// Discovery marks each result saved-or-not since §120, so it needs this.
import { FavouritesService } from '../src/favourites/favourites.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Closing an account, and pausing a shop (§119).
 *
 * The rule under test is the same one §89 established for branches: the record
 * stays, the person goes. Deleting a user row cascades to every appointment they
 * made, which cascades to their reviews, and leaves `ledger_entries.appointmentId`
 * NULL — money a business is owed with nothing saying what it was for.
 */
describe('Closing an account (§119)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let account: AccountService;
  let discovery: DiscoveryService;
  let business: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AccountService,
      DiscoveryService,
      FavouritesService,
      PlatformSettingsService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    account = moduleRef.get(AccountService);
    discovery = moduleRef.get(DiscoveryService);
    await resetDatabase(prisma);
    business = await createBusiness(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  describe('what closing does, and does not, destroy', () => {
    it('keeps the booking and the review, and removes the person', async () => {
      const customer = await createCustomer(prisma);
      const appointment = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.COMPLETED,
        startsInHours: -72,
      });
      const review = await prisma.review.create({
        data: {
          appointmentId: appointment.id,
          customerId: customer.userId,
          businessId: business.businessId,
          locationId: business.locationId,
          rating: 5,
          comment: 'Very good.',
        },
      });
      await prisma.user.update({
        where: { id: customer.userId },
        data: { displayName: 'Jok A.' },
      });

      await account.close(customer.userId);

      // The business's side of it is untouched. This is the whole point: a
      // business's rating must not move because somebody closed their account.
      expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).not.toBeNull();
      const kept = await prisma.review.findUnique({ where: { id: review.id } });
      expect(kept?.rating).toBe(5);
      expect(kept?.comment).toBe('Very good.');

      // The person is gone from it. A null display name renders "Anonymous"
      // (§31), so the byline changes without the review being touched.
      const closed = await prisma.user.findUniqueOrThrow({
        where: { id: customer.userId },
      });
      expect(closed.displayName).toBeNull();
      expect(closed.closedAt).not.toBeNull();
      expect(closed.email).not.toBe(customer.email);
      expect(closed.email).toMatch(/@closed\.invalid$/);
    });

    it('releases the address, so the same person can start again', async () => {
      const customer = await createCustomer(prisma);
      const original = customer.email;

      await account.close(customer.userId);

      // Nothing holds it any more, which is what makes signing up again work —
      // as a NEW account, with none of the old one's history.
      expect(
        await prisma.user.findUnique({ where: { email: original } }),
      ).toBeNull();
    });

    it('revokes every signed-in device', async () => {
      const customer = await createCustomer(prisma);
      await prisma.refreshToken.createMany({
        data: [
          { userId: customer.userId, tokenHash: `a-${customer.userId}`, expiresAt: new Date(Date.now() + 86_400_000) },
          { userId: customer.userId, tokenHash: `b-${customer.userId}`, expiresAt: new Date(Date.now() + 86_400_000) },
        ],
      });

      await account.close(customer.userId);

      const live = await prisma.refreshToken.count({
        where: { userId: customer.userId, revokedAt: null },
      });
      expect(live).toBe(0);
    });
  });

  describe('what it refuses', () => {
    it('refuses while a booking is still to come', async () => {
      const customer = await createCustomer(prisma);
      await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.BOOKED,
        startsInHours: 48,
      });

      // Somebody is expecting them, and is holding their deposit.
      await expect(account.close(customer.userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(account.close(customer.userId)).rejects.toThrow(/still to come/);
    });

    it('allows it once that booking is in the past', async () => {
      const customer = await createCustomer(prisma);
      await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.BOOKED,
        startsInHours: -48,
      });

      await expect(account.close(customer.userId)).resolves.toBeTruthy();
    });

    it('refuses the only owner of a business', async () => {
      const other = await createBusiness(prisma);

      // Leaving a business with no OWNER leaves it unchangeable forever: only an
      // owner may invite, and there would be nobody to do it.
      await expect(account.close(other.userId)).rejects.toThrow(/only owner/);
    });

    it('allows an owner once somebody else is one too', async () => {
      const other = await createBusiness(prisma);
      const successor = await createCustomer(prisma);
      await prisma.businessMembership.create({
        data: {
          userId: successor.userId,
          businessProfileId: other.businessId,
          role: BusinessMemberRole.OWNER,
          status: BusinessMemberStatus.ACTIVE,
        },
      });

      await expect(account.close(other.userId)).resolves.toBeTruthy();
    });

    it('refuses to close twice', async () => {
      const customer = await createCustomer(prisma);
      await account.close(customer.userId);

      await expect(account.close(customer.userId)).rejects.toThrow(/already closed/);
    });
  });

  describe('the export', () => {
    it('carries the caller’s own history and says who said what', async () => {
      const customer = await createCustomer(prisma);
      const appointment = await createAppointment(prisma, {
        business,
        customerId: customer.userId,
        status: AppointmentStatus.COMPLETED,
        startsInHours: -24,
      });
      await prisma.review.create({
        data: {
          appointmentId: appointment.id,
          customerId: customer.userId,
          businessId: business.businessId,
          locationId: business.locationId,
          rating: 4,
          comment: 'Fine.',
        },
      });

      const data = await account.exportFor(customer.userId);

      expect(data.account.email).toBe(customer.email);
      expect(data.bookings).toHaveLength(1);
      expect(data.reviews[0].comment).toBe('Fine.');
      expect(data.exportedAt).toBeTruthy();
    });

    it('carries nobody else’s', async () => {
      const mine = await createCustomer(prisma);
      const theirs = await createCustomer(prisma);
      await createAppointment(prisma, {
        business,
        customerId: theirs.userId,
        status: AppointmentStatus.COMPLETED,
        startsInHours: -24,
      });

      // There is no id parameter at all — it reads the caller. This asserts the
      // consequence rather than the shape.
      const data = await account.exportFor(mine.userId);
      expect(data.bookings).toHaveLength(0);
    });
  });

  describe('pausing a shop', () => {
    it('takes it out of search, and resuming puts it back', async () => {
      const shop = await createBusiness(prisma, { status: BusinessStatus.APPROVED });

      const before = await discovery.search({});
      expect(before.locations.map((l) => l.id)).toContain(shop.locationId);

      await account.setPaused(shop.businessId, true);
      const during = await discovery.search({});
      expect(during.locations.map((l) => l.id)).not.toContain(shop.locationId);
      // And the count agrees with the rows, as §114.2 required of every filter.
      expect(during.total).toBe(during.locations.length);

      await account.setPaused(shop.businessId, false);
      const after = await discovery.search({});
      expect(after.locations.map((l) => l.id)).toContain(shop.locationId);
    });

    it('refuses to pause twice or resume what is not paused', async () => {
      const shop = await createBusiness(prisma);

      await expect(account.setPaused(shop.businessId, false)).rejects.toThrow(
        /not paused/,
      );
      await account.setPaused(shop.businessId, true);
      await expect(account.setPaused(shop.businessId, true)).rejects.toThrow(
        /already paused/,
      );
    });
  });
});
