import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvitationStatus, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AdminInvitationsService } from '../src/users/admin-invitations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness, createCustomer } from './setup/factories';

/**
 * §99. Administrators inviting administrators.
 *
 * The invitation row is the only way to become one: the request DTO refuses a
 * role of ADMIN from any client. So these cover who may write that row, and
 * every reason it would never be honoured — all checked at creation, because
 * acceptance happens inside somebody else's login.
 */
describe('Admin invitations (§99)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let invitations: AdminInvitationsService;
  let primaryId: string;
  let secondaryId: string;

  const AS_PRIMARY = () => ({ userId: primaryId, role: UserRole.ADMIN });
  const AS_SECONDARY = () => ({ userId: secondaryId, role: UserRole.ADMIN });

  beforeAll(async () => {
    moduleRef = await createTestModule([
      AdminInvitationsService,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    invitations = moduleRef.get(AdminInvitationsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const primary = await prisma.user.create({
      data: {
        email: `primary.${Date.now()}@test.local`,
        role: UserRole.ADMIN,
        isPrimaryAdmin: true,
      },
    });
    primaryId = primary.id;
    const secondary = await prisma.user.create({
      data: { email: `second.${Date.now()}@test.local`, role: UserRole.ADMIN },
    });
    secondaryId = secondary.id;
  });

  describe('only the primary may act', () => {
    it('refuses a secondary administrator', async () => {
      await expect(
        invitations.invite(AS_SECONDARY(), { email: 'new@test.local' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a non-administrator outright', async () => {
      const customer = await createCustomer(prisma);
      await expect(
        invitations.invite(
          { userId: customer.userId, role: UserRole.CUSTOMER },
          { email: 'new@test.local' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the primary', async () => {
      const invitation = await invitations.invite(AS_PRIMARY(), {
        email: 'New@Test.local',
      });
      // Normalised, because the address is matched against a login.
      expect(invitation.email).toBe('new@test.local');
      expect(invitation.status).toBe(InvitationStatus.PENDING);
    });
  });

  describe('what cannot be invited', () => {
    it('refuses someone who is already an administrator', async () => {
      const existing = await prisma.user.findUniqueOrThrow({ where: { id: secondaryId } });
      await expect(
        invitations.invite(AS_PRIMARY(), { email: existing.email }),
      ).rejects.toThrow(/already an administrator/);
    });

    it('refuses an address that already has another kind of account', async () => {
      const customer = await createCustomer(prisma);
      await expect(
        invitations.invite(AS_PRIMARY(), { email: customer.email }),
      ).rejects.toThrow(/already has a customer account/);
    });

    it('refuses a business account for the same reason', async () => {
      const business = await createBusiness(prisma);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: business.userId } });
      await expect(
        invitations.invite(AS_PRIMARY(), { email: owner.email }),
      ).rejects.toThrow(/already has a business account/);
    });

    it('refuses a second invitation to the same address', async () => {
      await invitations.invite(AS_PRIMARY(), { email: 'new@test.local' });
      await expect(
        invitations.invite(AS_PRIMARY(), { email: 'new@test.local' }),
      ).rejects.toThrow(/already has an invitation waiting/);
    });
  });

  describe('taking access away', () => {
    it('demotes rather than deletes, so the history still names them', async () => {
      const result = await invitations.revokeAdmin(AS_PRIMARY(), secondaryId);
      expect(result.message).toContain('no longer an administrator');

      const after = await prisma.user.findUniqueOrThrow({ where: { id: secondaryId } });
      expect(after.role).toBe(UserRole.CUSTOMER);
      // The row survives: they may have assigned tickets and hidden reviews.
      expect(after.id).toBe(secondaryId);
    });

    it('refuses to remove the primary — there must always be one', async () => {
      await expect(
        invitations.revokeAdmin(AS_SECONDARY(), primaryId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Even asked by the primary themselves, via another route.
      const other = await prisma.user.create({
        data: { email: `x.${Date.now()}@test.local`, role: UserRole.ADMIN },
      });
      await expect(
        invitations.revokeAdmin({ userId: other.id, role: UserRole.ADMIN }, primaryId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to remove yourself', async () => {
      await expect(
        invitations.revokeAdmin(AS_PRIMARY(), primaryId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an account that is not an administrator', async () => {
      const customer = await createCustomer(prisma);
      await expect(
        invitations.revokeAdmin(AS_PRIMARY(), customer.userId),
      ).rejects.toThrow(/not an administrator/);
    });
  });

  it('revoking an invitation stops it being accepted', async () => {
    const invitation = await invitations.invite(AS_PRIMARY(), { email: 'new@test.local' });
    await invitations.revokeInvitation(AS_PRIMARY(), invitation.id);

    const after = await prisma.adminInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(after.status).toBe(InvitationStatus.REVOKED);

    await expect(
      invitations.revokeInvitation(AS_PRIMARY(), invitation.id),
    ).rejects.toThrow(/already revoked/);
  });

  it('the database allows only one primary administrator', async () => {
    await expect(
      prisma.user.update({
        where: { id: secondaryId },
        data: { isPrimaryAdmin: true },
      }),
    ).rejects.toThrow();
  });
});
