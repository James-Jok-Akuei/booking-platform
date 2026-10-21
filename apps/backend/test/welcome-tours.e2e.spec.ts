import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createAdmin, createBusiness, uniqueEmail } from './setup/factories';

/**
 * The welcome tours (§307): a new account is owed one — the customer's or the
 * seller's — and is owed it until it is finished or skipped, on any device.
 * Accounts made before tours existed, and admins, are owed none.
 */
describe('Welcome tours (§307)', () => {
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

  /** Signs in through the real flow, as `auth-login.e2e.spec.ts` does. */
  const signIn = async (email: string, role?: 'BUSINESS' | 'CUSTOMER') => {
    const requested = await request(url, '/auth/otp/request', {
      method: 'POST',
      body: { email, ...(role ? { role } : {}) },
    });
    expect(requested.status).toBe(200);
    const bcrypt = await import('bcrypt');
    const otp = await prisma.otpCode.findFirstOrThrow({
      where: { email: email.toLowerCase(), consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.otpCode.update({ where: { id: otp.id }, data: { codeHash: await bcrypt.hash('424242', 10) } });
    const verified = await request(url, '/auth/otp/verify', { method: 'POST', body: { email, code: '424242' } });
    expect(verified.status).toBe(200);
    return verified.body.accessToken as string;
  };

  const toursOf = async (token: string) => (await request(url, '/users/me', { token })).body.toursDue;

  it('a new customer is owed the customer tour', async () => {
    const token = await signIn(uniqueEmail('new-customer'), 'CUSTOMER');
    expect(await toursOf(token)).toEqual(['customer']);
  });

  it('a new seller, founding a shop, is owed the seller tour', async () => {
    const token = await signIn(uniqueEmail('new-seller'), 'BUSINESS');
    expect(await toursOf(token)).toEqual(['seller']);
  });

  it('somebody joining a team is owed the seller tour too', async () => {
    const shop = await createBusiness(prisma);
    const email = uniqueEmail('new-hire');
    const invited = await request(url, '/business/members/invite', {
      method: 'POST',
      token: ctx.token(shop.userId, shop.email, 'BUSINESS'),
      body: { email, role: 'STAFF' },
    });
    expect(invited.status).toBe(201);

    const token = await signIn(email, 'BUSINESS');
    expect(await toursOf(token)).toEqual(['seller']);
  });

  it('an account that was there before tours, and an admin, are owed none', async () => {
    const shop = await createBusiness(prisma);
    const admin = await createAdmin(prisma);
    expect(await toursOf(ctx.token(shop.userId, shop.email, 'BUSINESS'))).toEqual([]);
    expect(await toursOf(ctx.token(admin.userId, admin.email, 'ADMIN'))).toEqual([]);
  });

  it('signing in again does not owe the tour again once it is done', async () => {
    const email = uniqueEmail('returning');
    const first = await signIn(email, 'CUSTOMER');
    const done = await request(url, '/users/me/tours/customer/done', { method: 'POST', token: first });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ toursDue: [] });

    // A second code straight away waits out the resend pause (§auth).
    await prisma.otpCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const again = await signIn(email);
    expect(await toursOf(again)).toEqual([]);
  });

  it('finishing a tour twice, or one not owed, is harmless', async () => {
    const token = await signIn(uniqueEmail('twice'), 'CUSTOMER');
    const notOwed = await request(url, '/users/me/tours/seller/done', { method: 'POST', token });
    expect(notOwed.status).toBe(200);
    expect(notOwed.body).toEqual({ toursDue: ['customer'] });

    await request(url, '/users/me/tours/customer/done', { method: 'POST', token });
    const twice = await request(url, '/users/me/tours/customer/done', { method: 'POST', token });
    expect(twice.status).toBe(200);
    expect(twice.body).toEqual({ toursDue: [] });
  });

  it('a tour that does not exist is refused, and so is nobody', async () => {
    const token = await signIn(uniqueEmail('unknown'), 'CUSTOMER');
    expect((await request(url, '/users/me/tours/admin/done', { method: 'POST', token })).status).toBe(404);
    expect((await request(url, '/users/me/tours/customer/done', { method: 'POST' })).status).toBe(401);
  });
});
