import { AppointmentStatus, BusinessMemberRole, UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  addMember,
  createAppointment,
  createBusiness,
  createCustomer,
  uniqueEmail,
} from './setup/factories';

/**
 * Team members who look after some branches (§277), over HTTP.
 *
 * One business, two branches, and a team of every kind: the owner, a manager
 * of every branch, and a manager, a staff member and a second staff member who
 * each look after one. Everything is asked through the real guards — a branch
 * rule that holds in a service but not on the route is a rule that does not hold.
 */
describe('Branch-scoped team members (§277)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  let url: string;

  let shop: TestBusiness;
  let other: TestBusiness;
  /** The first branch is `shop.locationId`; this is the second. */
  let branchB: string;
  /** Offered only at branch B. */
  let serviceB: string;
  let customer: { userId: string; email: string };

  let owner: string;
  let managerAll: string;
  let managerA: string;
  let staffA: string;
  let staffB: string;
  let staffBMembership: string;
  let ownerMembership: string;

  let bookingA: string;
  let bookingB: string;
  let reviewA: string;
  let reviewB: string;
  let inquiryB: string;

  const tokens = new Map<string, string>();
  const as = (userId: string) => tokens.get(userId)!;
  const member = async (role: BusinessMemberRole, locationIds?: string[]) => {
    const m = await addMember(prisma, shop.businessId, role, locationIds);
    tokens.set(m.userId, ctx.token(m.userId, m.email, UserRole.BUSINESS));
    return m;
  };

  /** A finished visit with a review, at a branch. */
  const reviewed = async (locationId: string) => {
    const done = await createAppointment(prisma, {
      business: { ...shop, locationId },
      customerId: customer.userId,
      status: AppointmentStatus.COMPLETED,
      startsInHours: -48,
    });
    const review = await prisma.review.create({
      data: {
        appointmentId: done.id,
        customerId: customer.userId,
        businessId: shop.businessId,
        locationId,
        rating: 5,
        comment: 'Lovely.',
      },
    });
    return review.id;
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    url = ctx.url;
    await resetDatabase(prisma);

    shop = await createBusiness(prisma);
    other = await createBusiness(prisma);
    customer = await createCustomer(prisma);
    owner = shop.userId;
    tokens.set(owner, ctx.token(shop.userId, shop.email, UserRole.BUSINESS));
    tokens.set(customer.userId, ctx.token(customer.userId, customer.email, UserRole.CUSTOMER));
    ownerMembership = (await prisma.businessMembership.findFirstOrThrow({ where: { userId: owner } })).id;

    const second = await prisma.location.create({
      data: {
        businessId: shop.businessId,
        name: 'Branch B',
        address: 'Second Road',
        hours: {
          create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            dayOfWeek,
            openTime: '09:00',
            closeTime: '17:00',
            isClosed: false,
          })),
        },
      },
    });
    branchB = second.id;
    await prisma.serviceLocation.create({ data: { serviceId: shop.serviceId, locationId: branchB, priceMinor: 4500 } });
    serviceB = (
      await prisma.service.create({
        data: {
          businessId: shop.businessId,
          name: 'Only at B',
          currency: 'USD',
          durationMinutes: 30,
          depositPercentage: 20,
          locations: { create: [{ locationId: branchB, priceMinor: 3000 }] },
        },
      })
    ).id;

    managerAll = (await member(BusinessMemberRole.MANAGER)).userId;
    managerA = (await member(BusinessMemberRole.MANAGER, [shop.locationId])).userId;
    staffA = (await member(BusinessMemberRole.STAFF, [shop.locationId])).userId;
    const b = await member(BusinessMemberRole.STAFF, [branchB]);
    staffB = b.userId;
    staffBMembership = b.membershipId;

    bookingA = (
      await createAppointment(prisma, { business: shop, customerId: customer.userId, status: AppointmentStatus.BOOKED })
    ).id;
    bookingB = (
      await createAppointment(prisma, {
        business: { ...shop, locationId: branchB },
        customerId: customer.userId,
        status: AppointmentStatus.BOOKED,
        startsInHours: 72,
      })
    ).id;
    reviewA = await reviewed(shop.locationId);
    reviewB = await reviewed(branchB);

    const asked = await request(url, '/threads/inquiry', {
      method: 'POST',
      token: as(customer.userId),
      body: { businessProfileId: shop.businessId, locationId: branchB },
    });
    expect(asked.status).toBe(200);
    inquiryB = asked.body.id as string;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await ctx.close();
  });

  const ids = (body: unknown) => (body as Array<{ id: string }>).map((row) => row.id);

  // ------------------------------------------------------------------
  describe('what a member of one branch can see', () => {
    it('lists only their branches; the owner sees both', async () => {
      const mine = await request(url, '/business/locations', { token: as(managerA) });
      const all = await request(url, '/business/locations', { token: as(owner) });

      expect(mine.status).toBe(200);
      expect(ids(mine.body)).toEqual([shop.locationId]);
      expect(ids(all.body).sort()).toEqual([shop.locationId, branchB].sort());
    });

    it('lists only their bookings, even when asking for the other branch by name', async () => {
      const mine = await request(url, '/appointments', { token: as(staffA) });
      const sneaky = await request(url, `/appointments?locationId=${branchB}`, { token: as(staffA) });
      const all = await request(url, '/appointments', { token: as(managerAll) });

      const rows = (r: { body: Record<string, unknown> }) => ids(r.body.appointments);
      expect(rows(mine)).toContain(bookingA);
      expect(rows(mine)).not.toContain(bookingB);
      expect(rows(sneaky)).toEqual([]);
      expect(rows(all)).toEqual(expect.arrayContaining([bookingA, bookingB]));
    });

    it("another branch's booking, branch, hours and photos do not exist for them", async () => {
      expect((await request(url, `/appointments/${bookingB}`, { token: as(staffA) })).status).toBe(404);
      expect((await request(url, `/appointments/${bookingA}`, { token: as(staffA) })).status).toBe(200);
      expect(
        (
          await request(url, `/business/locations/${branchB}`, {
            method: 'PATCH',
            token: as(managerA),
            body: { name: 'Mine now' },
          })
        ).status,
      ).toBe(404);
      expect((await request(url, `/business/locations/${branchB}/gallery`, { token: as(managerA) })).status).toBe(404);
      expect(
        (await request(url, `/business/appointments/${bookingB}/no-show`, { method: 'POST', token: as(managerA) }))
          .status,
      ).toBe(404);
    });

    it('a manager runs their own branch', async () => {
      const renamed = await request(url, `/business/locations/${shop.locationId}`, {
        method: 'PATCH',
        token: as(managerA),
        body: { name: 'Branch A' },
      });
      expect(renamed.status).toBe(200);
    });

    it('sees only the services offered at their branches, and only those branches’ prices', async () => {
      const res = await request(url, '/business/services', { token: as(managerA) });
      const services = res.body as unknown as Array<{ id: string; locations: Array<{ locationId: string }> }>;

      expect(services.map((s) => s.id)).toEqual([shop.serviceId]);
      expect(services[0].locations.map((l) => l.locationId)).toEqual([shop.locationId]);
      expect(services.map((s) => s.id)).not.toContain(serviceB);
    });

    it('sees only the conversations about their branches', async () => {
      const mine = await request(url, '/threads', { token: as(managerA) });
      const theirs = await request(url, '/threads', { token: as(staffB) });

      expect(ids(mine.body.threads)).not.toContain(inquiryB);
      expect(ids(theirs.body.threads)).toContain(inquiryB);
      expect((await request(url, `/threads/${inquiryB}`, { token: as(managerA) })).status).toBe(404);
    });

    it("answers their branch's reviews, and cannot reach the other branch's", async () => {
      const ours = await request(url, `/reviews/${reviewA}/response`, {
        method: 'POST',
        token: as(staffA),
        body: { responseText: 'Thank you!' },
      });
      const theirs = await request(url, `/reviews/${reviewB}/response`, {
        method: 'POST',
        token: as(staffA),
        body: { responseText: 'Thank you!' },
      });

      expect(ours.status).toBe(201);
      expect(theirs.status).toBe(404);
    });

    it('sees the people they work with — not those at the other branch', async () => {
      const res = await request(url, '/business/members', { token: as(staffA) });
      const people = res.body as unknown as Array<{ userId: string; locationIds: string[]; allLocations: boolean }>;
      const seen = people.map((p) => p.userId);

      expect(seen).toEqual(expect.arrayContaining([owner, managerAll, managerA, staffA]));
      expect(seen).not.toContain(staffB);
      expect(people.find((p) => p.userId === owner)!.allLocations).toBe(true);
      expect(people.find((p) => p.userId === managerA)!.locationIds).toEqual([shop.locationId]);
    });
  });

  // ------------------------------------------------------------------
  describe('what needs every branch', () => {
    it('a manager of one branch cannot change the whole business', async () => {
      const profile = await request(url, '/business/profile', {
        method: 'PATCH',
        token: as(managerA),
        body: { description: 'Ours now.' },
      });
      const branch = await request(url, '/business/locations', {
        method: 'POST',
        token: as(managerA),
        body: { name: 'Branch C', address: 'Third Road' },
      });
      const price = await request(url, `/business/services/${shop.serviceId}`, {
        method: 'PATCH',
        token: as(managerA),
        body: { name: 'Renamed' },
      });

      for (const res of [profile, branch, price]) {
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toMatch(/every branch/);
      }
    });

    it('a manager of every branch can', async () => {
      const profile = await request(url, '/business/profile', {
        method: 'PATCH',
        token: as(managerAll),
        body: { description: 'A calm place for a haircut.' },
      });
      expect(profile.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------
  describe('what staff cannot do', () => {
    it('staff cannot cancel a booking — cancelling refunds the customer', async () => {
      const res = await request(url, `/appointments/${bookingA}/cancel`, {
        method: 'POST',
        token: as(staffA),
        body: {},
      });

      expect(res.status).toBe(403);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: bookingA } })).status).toBe(
        AppointmentStatus.BOOKED,
      );
    });

    it('staff cannot see how the business is going; a manager of one branch sees only theirs', async () => {
      const staff = await request(url, `/businesses/${shop.businessId}/analytics`, { token: as(staffA) });
      const manager = await request(url, `/businesses/${shop.businessId}/analytics`, { token: as(managerA) });
      const other = await request(url, `/businesses/${shop.businessId}/analytics?locationId=${branchB}`, {
        token: as(managerA),
      });
      const everything = await request(url, `/businesses/${shop.businessId}/analytics`, { token: as(owner) });

      expect(staff.status).toBe(403);
      expect(manager.status).toBe(200);
      expect(manager.body.locationIds).toEqual([shop.locationId]);
      expect(other.status).toBe(404);
      expect(everything.body.locationIds).toBeNull();
    });

    it('the money is for the owner and managers of every branch', async () => {
      const read = (userId: string) => request(url, `/businesses/${shop.businessId}/balance`, { token: as(userId) });

      expect((await read(owner)).status).toBe(200);
      expect((await read(managerAll)).status).toBe(200);
      expect((await read(managerA)).status).toBe(403);
      expect((await read(staffA)).status).toBe(403);
      expect((await request(url, `/businesses/${shop.businessId}/payouts`, { token: as(staffA) })).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------
  describe('who is told', () => {
    it("a message about branch B reaches the owner, every-branch members and B's team — nobody at A", async () => {
      const before = new Date();
      const sent = await request(url, `/threads/${inquiryB}/messages`, {
        method: 'POST',
        token: as(customer.userId),
        body: { body: 'Are you open on Sunday?' },
      });
      expect(sent.status).toBe(201);

      const told = await prisma.notification.findMany({
        where: {
          createdAt: { gte: before },
          recipient: { businessMemberships: { some: { businessProfileId: shop.businessId } } },
        },
        select: { recipientId: true },
      });
      const who = told.map((n) => n.recipientId);

      expect(who).toEqual(expect.arrayContaining([owner, managerAll, staffB]));
      expect(who).not.toContain(managerA);
      expect(who).not.toContain(staffA);
    });

    it('a question from a branch page remembers the branch; another business’s branch is not kept', async () => {
      const thread = await prisma.thread.findUniqueOrThrow({ where: { id: inquiryB } });
      expect(thread.locationId).toBe(branchB);

      const stranger = await createCustomer(prisma);
      const asked = await request(url, '/threads/inquiry', {
        method: 'POST',
        token: ctx.token(stranger.userId, stranger.email, UserRole.CUSTOMER),
        body: { businessProfileId: shop.businessId, locationId: other.locationId },
      });
      expect(asked.status).toBe(200);
      expect((await prisma.thread.findUniqueOrThrow({ where: { id: asked.body.id as string } })).locationId).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  describe('the owner chooses', () => {
    it('moves someone to other branches; what they see follows at once', async () => {
      const moved = await request(url, `/business/members/${staffBMembership}/branches`, {
        method: 'PATCH',
        token: as(owner),
        body: { allLocations: false, locationIds: [shop.locationId] },
      });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ allLocations: false, locationIds: [shop.locationId] });

      const now = await request(url, '/business/locations', { token: as(staffB) });
      expect(ids(now.body)).toEqual([shop.locationId]);
      expect((await request(url, `/appointments/${bookingB}`, { token: as(staffB) })).status).toBe(404);

      const everything = await request(url, `/business/members/${staffBMembership}/branches`, {
        method: 'PATCH',
        token: as(owner),
        body: { allLocations: true },
      });
      expect(everything.body).toMatchObject({ allLocations: true, locationIds: [] });
      expect(await prisma.membershipLocation.count({ where: { membershipId: staffBMembership } })).toBe(0);
      expect(ids((await request(url, '/business/locations', { token: as(staffB) })).body).length).toBe(2);
    });

    it('only the owner chooses, never for the owner, and only among their own open branches', async () => {
      const path = `/business/members/${staffBMembership}/branches`;
      const byManager = await request(url, path, {
        method: 'PATCH',
        token: as(managerAll),
        body: { allLocations: false, locationIds: [branchB] },
      });
      const forOwner = await request(url, `/business/members/${ownerMembership}/branches`, {
        method: 'PATCH',
        token: as(owner),
        body: { allLocations: false, locationIds: [branchB] },
      });
      const none = await request(url, path, {
        method: 'PATCH',
        token: as(owner),
        body: { allLocations: false, locationIds: [] },
      });
      const foreign = await request(url, path, {
        method: 'PATCH',
        token: as(owner),
        body: { allLocations: false, locationIds: [other.locationId] },
      });

      expect(byManager.status).toBe(403);
      expect(forOwner.status).toBe(400);
      expect(none.status).toBe(400);
      expect(foreign.status).toBe(400);
    });

    it('an invitation carries its branches, and accepting it copies them', async () => {
      const email = uniqueEmail('newhire');
      const invited = await request(url, '/business/members/invite', {
        method: 'POST',
        token: as(owner),
        body: { email, role: 'STAFF', allLocations: false, locationIds: [branchB] },
      });
      expect(invited.status).toBe(201);
      expect(invited.body).toMatchObject({ allLocations: false, locationIds: [branchB] });

      // Signing in at the invited address is accepting (§auth).
      expect(
        (await request(url, '/auth/otp/request', { method: 'POST', body: { email, role: 'BUSINESS' } })).status,
      ).toBe(200);
      const bcrypt = await import('bcrypt');
      const otp = await prisma.otpCode.findFirstOrThrow({
        where: { email, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpCode.update({ where: { id: otp.id }, data: { codeHash: await bcrypt.hash('424242', 10) } });
      const verified = await request(url, '/auth/otp/verify', { method: 'POST', body: { email, code: '424242' } });
      expect(verified.status).toBe(200);

      const me = await request(url, '/users/me', { token: verified.body.accessToken as string });
      expect(me.body.businessMembership).toMatchObject({ role: 'STAFF', allLocations: false, locationIds: [branchB] });
    });

    it('an invitation for some branches must name one', async () => {
      const res = await request(url, '/business/members/invite', {
        method: 'POST',
        token: as(owner),
        body: { email: uniqueEmail('nobranch'), role: 'MANAGER', allLocations: false },
      });
      expect(res.status).toBe(400);
    });

    it('the owner is always every branch', async () => {
      const me = await request(url, '/users/me', { token: as(owner) });
      expect(me.body.businessMembership).toMatchObject({ role: 'OWNER', allLocations: true, locationIds: [] });
    });
  });
});
