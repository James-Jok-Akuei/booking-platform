import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { BusinessMemberRole, OtpPurpose, UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { addMember, createAdmin, createBusiness, createCustomer, uniqueEmail } from './setup/factories';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long a sign-in lasts, per app, and confirming it is you (§279), over
 * HTTP and through the real sign-in flow.
 */
describe('Sign-in lengths and confirming it is you (§279)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  let url: string;

  beforeAll(async () => {
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    url = ctx.url;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await ctx.close();
  });

  /** The newest unused code of a kind, swapped for a known one (the hash cannot be read back). */
  const knownCode = async (where: { email?: string; userId?: string }, purpose: OtpPurpose) => {
    const otp = await prisma.otpCode.findFirstOrThrow({
      where: { ...where, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.otpCode.update({ where: { id: otp.id }, data: { codeHash: await bcrypt.hash('424242', 10) } });
    return '424242';
  };

  const signIn = async (email: string, role?: 'BUSINESS' | 'CUSTOMER') => {
    const asked = await request(url, '/auth/otp/request', { method: 'POST', body: role ? { email, role } : { email } });
    expect(asked.status).toBe(200);
    const code = await knownCode({ email }, OtpPurpose.LOGIN);
    const res = await request(url, '/auth/otp/verify', { method: 'POST', body: { email, code } });
    expect(res.status).toBe(200);
    return res.body as {
      accessToken: string;
      refreshToken: string;
      session: { idleMinutes: number; endsAt: string | null };
    };
  };

  /** The stored row behind a refresh token (only its hash is kept). */
  const row = (refreshToken: string) =>
    prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex') },
    });

  const near = (actual: number, expected: number, slack = MINUTE) => {
    expect(Math.abs(actual - expected)).toBeLessThan(slack);
  };
  const expOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;

  // ------------------------------------------------------------------
  describe('how long each app stays signed in', () => {
    it('the admin console: 30 minutes unused, 12 hours at most', async () => {
      const admin = await createAdmin(prisma);
      const pair = await signIn(admin.email);

      expect(pair.session.idleMinutes).toBe(30);
      near(new Date(pair.session.endsAt!).getTime(), Date.now() + 12 * HOUR);
      near((await row(pair.refreshToken)).expiresAt.getTime(), Date.now() + 30 * MINUTE);
      expect(expOf(pair.accessToken)).toBeLessThanOrEqual(Date.now() + 15 * MINUTE + 1000);
    });

    it('the seller app: 12 hours unused, 30 days at most', async () => {
      const pair = await signIn(uniqueEmail('seller'), 'BUSINESS');

      expect(pair.session.idleMinutes).toBe(12 * 60);
      near(new Date(pair.session.endsAt!).getTime(), Date.now() + 30 * DAY);
      near((await row(pair.refreshToken)).expiresAt.getTime(), Date.now() + 12 * HOUR);
    });

    it('the customer app: 30 days unused, and no end otherwise', async () => {
      const pair = await signIn(uniqueEmail('buyer'), 'CUSTOMER');

      expect(pair.session).toEqual({ idleMinutes: 30 * 24 * 60, maxMinutes: null, endsAt: null });
      near((await row(pair.refreshToken)).expiresAt.getTime(), Date.now() + 30 * DAY);
    });
  });

  // ------------------------------------------------------------------
  describe('renewing does not move the end', () => {
    it('a refresh keeps the sign-in it continues', async () => {
      const admin = await createAdmin(prisma);
      const first = await signIn(admin.email);
      const started = (await row(first.refreshToken)).sessionStartedAt;

      const next = await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: first.refreshToken } });

      expect(next.status).toBe(200);
      expect((next.body.session as { endsAt: string }).endsAt).toBe(first.session.endsAt);
      expect((await row(next.body.refreshToken as string)).sessionStartedAt).toEqual(started);
    });

    it('past its end, a sign-in is over however recently it was used', async () => {
      const admin = await createAdmin(prisma);
      const pair = await signIn(admin.email);
      const stored = await row(pair.refreshToken);
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { sessionStartedAt: new Date(Date.now() - 13 * HOUR), expiresAt: new Date(Date.now() + 10 * MINUTE) },
      });

      const res = await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: pair.refreshToken } });

      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).toMatch(/sign in again/i);
    });

    it('near its end, no new token outlives it', async () => {
      const admin = await createAdmin(prisma);
      const pair = await signIn(admin.email);
      const stored = await row(pair.refreshToken);
      const started = new Date(Date.now() - (12 * HOUR - 5 * MINUTE));
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { sessionStartedAt: started } });

      const res = await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: pair.refreshToken } });
      const end = started.getTime() + 12 * HOUR;

      expect(res.status).toBe(200);
      expect(expOf(res.body.accessToken as string)).toBeLessThanOrEqual(end + 1000);
      expect((await row(res.body.refreshToken as string)).expiresAt.getTime()).toBeLessThanOrEqual(end + 1000);
    });

    it('unused past its idle time, it is over', async () => {
      const pair = await signIn(uniqueEmail('idle'), 'BUSINESS');
      const stored = await row(pair.refreshToken);
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { expiresAt: new Date(Date.now() - MINUTE) },
      });

      const res = await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: pair.refreshToken } });

      expect(res.status).toBe(401);
    });
  });

  // ------------------------------------------------------------------
  describe('confirming it is you before a risky change', () => {
    const invite = (token: string, stepUp?: string) =>
      fetch(`${url}/business/members/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(stepUp ? { 'X-Step-Up': stepUp } : {}),
        },
        body: JSON.stringify({ email: uniqueEmail('hire'), role: 'STAFF' }),
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

    it('a sign-in from a few minutes ago is enough', async () => {
      const shop = await createBusiness(prisma);
      expect((await invite(ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 3))).status).toBe(201);
    });

    it('an older one is asked to confirm, and a code lets the same change through', async () => {
      const shop = await createBusiness(prisma);
      const stale = ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 20);

      const refused = await invite(stale);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('STEP_UP_REQUIRED');

      expect((await request(url, '/auth/step-up/request', { method: 'POST', token: stale })).status).toBe(200);
      const code = await knownCode({ userId: shop.userId }, OtpPurpose.STEP_UP);
      const confirmed = await request(url, '/auth/step-up/verify', { method: 'POST', token: stale, body: { code } });
      expect(confirmed.status).toBe(200);

      const pass = confirmed.body.stepUpToken as string;
      expect((await invite(stale, pass)).status).toBe(201);
      // Several in a row, without asking again.
      expect((await invite(stale, pass)).status).toBe(201);
    });

    it('a wrong code is refused', async () => {
      const shop = await createBusiness(prisma);
      const stale = ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 20);
      await request(url, '/auth/step-up/request', { method: 'POST', token: stale });

      const res = await request(url, '/auth/step-up/verify', {
        method: 'POST',
        token: stale,
        body: { code: '000000' },
      });

      expect(res.status).toBe(400);
    });

    it("the pass is one person's, cannot sign anybody in, and cannot be used as a sign-in", async () => {
      const shop = await createBusiness(prisma);
      const other = await createBusiness(prisma);
      const stale = ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 20);
      await request(url, '/auth/step-up/request', { method: 'POST', token: stale });
      const code = await knownCode({ userId: shop.userId }, OtpPurpose.STEP_UP);

      // A confirm code is not a sign-in code.
      const asSignIn = await request(url, '/auth/otp/verify', { method: 'POST', body: { email: shop.email, code } });
      expect(asSignIn.status).toBe(400);

      const pass = (await request(url, '/auth/step-up/verify', { method: 'POST', token: stale, body: { code } })).body
        .stepUpToken as string;

      // Another owner cannot borrow it.
      const borrowed = await invite(ctx.token(other.userId, other.email, UserRole.BUSINESS, 20), pass);
      expect(borrowed.status).toBe(403);
      expect(borrowed.body.code).toBe('STEP_UP_REQUIRED');

      // And it is not a way in.
      expect((await request(url, '/users/me', { token: pass })).status).toBe(401);
    });

    it('who may do it is answered first: staff are refused, not asked for a code', async () => {
      const shop = await createBusiness(prisma);
      const staff = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);

      const res = await invite(ctx.token(staff.userId, staff.email, UserRole.BUSINESS, 20));

      expect(res.status).toBe(403);
      expect(res.body.code).toBeUndefined();
    });

    it('changing a role, branches or removing someone asks too', async () => {
      const shop = await createBusiness(prisma);
      const member = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
      const stale = ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 20);

      for (const [method, path, body] of [
        ['PATCH', `/business/members/${member.membershipId}/role`, { role: 'MANAGER' }],
        ['PATCH', `/business/members/${member.membershipId}/branches`, { allLocations: true }],
        ['DELETE', `/business/members/${member.membershipId}`, undefined],
      ] as const) {
        const res = await request(url, path, { method, token: stale, body });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('STEP_UP_REQUIRED');
      }
    });

    it('the payout number asks the owner — and only the owner is asked', async () => {
      const shop = await createBusiness(prisma, { payoutDestination: 'NONE' });
      const manager = await addMember(prisma, shop.businessId, BusinessMemberRole.MANAGER);
      const body = { msisdn: '+250788123456' };

      const stale = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: ctx.token(shop.userId, shop.email, UserRole.BUSINESS, 20),
        body,
      });
      const byManager = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: ctx.token(manager.userId, manager.email, UserRole.BUSINESS, 20),
        body,
      });
      const fresh = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: ctx.token(shop.userId, shop.email, UserRole.BUSINESS),
        body,
      });

      expect(stale.status).toBe(403);
      expect(stale.body.code).toBe('STEP_UP_REQUIRED');
      expect(byManager.status).toBe(403);
      expect(byManager.body.code).toBeUndefined();
      expect(fresh.status).toBe(201);
    });

    it('asking needs a sign-in', async () => {
      expect((await request(url, '/auth/step-up/request', { method: 'POST' })).status).toBe(401);
      const customer = await createCustomer(prisma);
      expect(
        (
          await request(url, '/auth/step-up/request', {
            method: 'POST',
            token: ctx.token(customer.userId, customer.email, UserRole.CUSTOMER),
          })
        ).status,
      ).toBe(200);
    });
  });
});
