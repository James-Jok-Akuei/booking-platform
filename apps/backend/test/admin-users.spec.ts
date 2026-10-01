import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createAdmin, createBusiness, createCustomer } from './setup/factories';

/**
 * §94. The user directory.
 *
 * `clearDisplayName` was the only thing on this surface, and it takes an id
 * that nothing in the platform produced — no list, no search, no lookup. These
 * cover the listing that makes it reachable, and the scoping that keeps it an
 * admin tool.
 */
describe('User directory (§94)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let adminId: string;

  const AS_ADMIN = () => ({ userId: adminId, role: UserRole.ADMIN });

  beforeAll(async () => {
    moduleRef = await createTestModule([UsersService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UsersService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const admin = await createAdmin(prisma);
    adminId = admin.userId;
  });

  it('lists every account, newest first', async () => {
    await createCustomer(prisma);
    await createCustomer(prisma);

    const page = await users.list(AS_ADMIN(), {});

    // Two customers plus the admin.
    expect(page.total).toBe(3);
    expect(page.users).toHaveLength(3);
  });

  it('filters by role', async () => {
    await createCustomer(prisma);
    await createBusiness(prisma);

    const customers = await users.list(AS_ADMIN(), { role: UserRole.CUSTOMER });
    expect(customers.users.every((u) => u.role === UserRole.CUSTOMER)).toBe(true);

    const admins = await users.list(AS_ADMIN(), { role: UserRole.ADMIN });
    expect(admins.total).toBe(1);
  });

  it('searches email and display name, ignoring case', async () => {
    const customer = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: customer.userId },
      data: { displayName: 'Amal K.' },
    });

    const byName = await users.list(AS_ADMIN(), { search: 'amal k' });
    expect(byName.users.map((u) => u.id)).toEqual([customer.userId]);

    const byEmail = await users.list(AS_ADMIN(), {
      search: customer.email.slice(0, 8).toUpperCase(),
    });
    expect(byEmail.users.some((u) => u.id === customer.userId)).toBe(true);
  });

  it('narrows to accounts that have a display name — the ones that can be moderated', async () => {
    const named = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: named.userId },
      data: { displayName: 'Shown' },
    });
    await createCustomer(prisma);

    const page = await users.list(AS_ADMIN(), { withDisplayName: 'true' });
    expect(page.users.map((u) => u.id)).toEqual([named.userId]);
  });

  it('shows where a business user works, and with what role', async () => {
    const business = await createBusiness(prisma);

    const page = await users.list(AS_ADMIN(), { role: UserRole.BUSINESS });
    const owner = page.users.find((u) => u.id === business.userId);

    expect(owner?.businesses).toHaveLength(1);
    expect(owner?.businesses[0].role).toBe('OWNER');
    expect(owner?.businesses[0].id).toBe(business.businessId);
  });

  it('counts what makes an account look real', async () => {
    const customer = await createCustomer(prisma);

    const page = await users.list(AS_ADMIN(), { search: customer.email });
    const row = page.users[0];

    expect(row.appointmentCount).toBe(0);
    expect(row.reviewCount).toBe(0);
    expect(row.ticketCount).toBe(0);
  });

  it.each([UserRole.CUSTOMER, UserRole.BUSINESS])('refuses a %s', async (role) => {
    await expect(
      users.list({ role }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clearing a display name actually clears it', async () => {
    const customer = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: customer.userId },
      data: { displayName: 'Something rude' },
    });

    await users.clearDisplayName(AS_ADMIN(), customer.userId, {
      reason: 'Abusive display name.',
    });

    const page = await users.list(AS_ADMIN(), { search: customer.email });
    expect(page.users[0].displayName).toBeNull();
  });
});
