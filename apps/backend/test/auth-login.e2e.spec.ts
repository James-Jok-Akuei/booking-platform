import { UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createAdmin, createBusiness, uniqueEmail } from './setup/factories';

/**
 * Logging in, over HTTP, through the real auth flow (§50).
 *
 * This suite exists because of a gap nothing else could see. Every other test —
 * and `createE2eApp` itself — MINTS a token directly, so the whole platform was
 * exercised for weeks while an administrator could not actually obtain one:
 * `/auth/otp/request` accepted only BUSINESS or CUSTOMER, and refused an email
 * registered under any other role. Every admin surface was unreachable.
 *
 * So nothing here mints anything. Every token below comes out of the real
 * endpoints, and one of them then has to reach an admin-only route.
 */
describe('Logging in over HTTP (§50)', () => {
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

  /**
   * The code is bcrypt-hashed, so a test cannot read it from the row.
   *
   * `verifyOtp` compares against the most recent unconsumed code for that
   * email, so replacing the hash with a known one is exactly equivalent to
   * knowing what was emailed — without depending on a mail transport.
   */
  const codeFor = async (email: string) => {
    const bcrypt = await import('bcrypt');
    const otp = await prisma.otpCode.findFirstOrThrow({
      where: { email: email.toLowerCase(), consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { codeHash: await bcrypt.hash('424242', 10) },
    });
    return '424242';
  };

  const login = async (email: string, body: Record<string, unknown> = {}) => {
    const requested = await request(url, '/auth/otp/request', {
      method: 'POST',
      body: { email, ...body },
    });
    if (requested.status !== 200) return { requested, verified: null };

    const code = await codeFor(email);
    const verified = await request(url, '/auth/otp/verify', {
      method: 'POST',
      body: { email, code },
    });
    return { requested, verified };
  };

  // ------------------------------------------------------------------
  describe('an ADMIN can log in and reach an admin route', () => {
    it('signs in through the real flow, with no minted token anywhere', async () => {
      // Seeded directly, because admins are never self-registered (§3).
      const admin = await createAdmin(prisma);

      const { requested, verified } = await login(admin.email);

      expect(requested.status).toBe(200);
      expect(verified!.status).toBe(200);
      expect((verified!.body as any).user.role).toBe(UserRole.ADMIN);

      // The part that was broken: the token has to actually work.
      const token = (verified!.body as any).accessToken as string;
      const queue = await request(url, '/admin/businesses', { token });
      expect(queue.status).toBe(200);
    });

    it('does not need a role in the request body', async () => {
      const admin = await createAdmin(prisma);

      const requested = await request(url, '/auth/otp/request', {
        method: 'POST',
        body: { email: admin.email },
      });

      expect(requested.status).toBe(200);
    });

    it('is not blocked by a role in the body either — the body has no vote', async () => {
      const admin = await createAdmin(prisma);

      // Previously a 400: "already registered as a admin account".
      const { verified } = await login(admin.email, { role: 'CUSTOMER' });

      expect(verified!.status).toBe(200);
      expect((verified!.body as any).user.role).toBe(UserRole.ADMIN);
    });
  });

  // ------------------------------------------------------------------
  describe('an existing user logs in as who they are', () => {
    it('a BUSINESS user asking with role CUSTOMER still logs in as BUSINESS', async () => {
      const business = await createBusiness(prisma);

      const { verified } = await login(business.email, { role: 'CUSTOMER' });

      expect(verified!.status).toBe(200);
      // The body does not decide. Their account does.
      expect((verified!.body as any).user.role).toBe(UserRole.BUSINESS);
      expect((verified!.body as any).user.id).toBe(business.userId);
    });

    it('verify succeeds with no role in the body at all', async () => {
      const business = await createBusiness(prisma);
      await request(url, '/auth/otp/request', {
        method: 'POST',
        body: { email: business.email },
      });
      const code = await codeFor(business.email);

      const verified = await request(url, '/auth/otp/verify', {
        method: 'POST',
        body: { email: business.email, code },
      });

      expect(verified.status).toBe(200);
      expect((verified.body as any).accessToken).toBeDefined();
    });

    it('rejects an unknown role value outright', async () => {
      const res = await request(url, '/auth/otp/request', {
        method: 'POST',
        body: { email: uniqueEmail('someone'), role: 'WIZARD' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ------------------------------------------------------------------
  describe('registration still needs a role, and still refuses ADMIN', () => {
    it('refuses a brand-new email with no role, and says what to send', async () => {
      const res = await request(url, '/auth/otp/request', {
        method: 'POST',
        body: { email: uniqueEmail('newcomer') },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/BUSINESS or CUSTOMER/);
    });

    it('refuses to self-register an ADMIN', async () => {
      const res = await request(url, '/auth/otp/request', {
        method: 'POST',
        body: { email: uniqueEmail('wannabe'), role: 'ADMIN' },
      });

      // §3 still holds: the DTO never accepted ADMIN and still does not. The bug
      // was that this rule also locked out admins who already existed.
      expect(res.status).toBe(400);
      expect(await prisma.user.count({ where: { role: UserRole.ADMIN } })).toBeGreaterThan(0);
    });

    it('creates a CUSTOMER when a new email supplies that role', async () => {
      const email = uniqueEmail('fresh');

      const { verified } = await login(email, { role: 'CUSTOMER' });

      expect(verified!.status).toBe(200);
      expect((verified!.body as any).user.role).toBe(UserRole.CUSTOMER);
    });

    it('no ADMIN account is ever created by the login flow', async () => {
      const before = await prisma.user.count({ where: { role: UserRole.ADMIN } });
      await login(uniqueEmail('sneaky'), { role: 'CUSTOMER' });

      expect(await prisma.user.count({ where: { role: UserRole.ADMIN } })).toBe(before);
    });
  });
});
