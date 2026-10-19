import * as bcrypt from 'bcrypt';
import { NotificationType, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { totpAt } from '../src/auth/totp';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createAdmin, createCustomer } from './setup/factories';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Pair = { accessToken: string; refreshToken: string };

/**
 * Where you are signed in, the new-sign-in notice, and an administrator's
 * two-step sign-in (§298) — over HTTP, through the real sign-in.
 */
describe('Sessions and two-step sign-in (§298)', () => {
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
    delete process.env.ADMIN_TWO_STEP_REQUIRED;
    await resetDatabase(prisma);
    await ctx.close();
  });

  /** Asks for a code and swaps it for a known one (only its hash is kept). */
  const askCode = async (email: string) => {
    const asked = await request(url, '/auth/otp/request', { method: 'POST', body: { email } });
    expect(asked.status).toBe(200);
    const otp = await prisma.otpCode.findFirstOrThrow({
      where: { email, purpose: OtpPurpose.LOGIN, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Dated back, so the minute between codes and the hourly count do not stop the next one.
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { codeHash: await bcrypt.hash('424242', 10), createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    return '424242';
  };

  const verify = (email: string, code: string, userAgent = CHROME_MAC, twoStepCode?: string) =>
    request(url, '/auth/otp/verify', {
      method: 'POST',
      headers: { 'User-Agent': userAgent },
      body: { email, code, ...(twoStepCode ? { twoStepCode } : {}) },
    });

  const signIn = async (email: string, userAgent = CHROME_MAC) => {
    const res = await verify(email, await askCode(email), userAgent);
    expect(res.status).toBe(200);
    return res.body as unknown as Pair;
  };

  it('says where to report a weakness (security.txt)', async () => {
    const res = await fetch(`${url}/.well-known/security.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^Contact: mailto:.+@.+$/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(text)![1]);
    expect(expires).toBeGreaterThan(Date.now() + 300 * 24 * 3_600_000);
  });

  describe('where you are signed in', () => {
    it('lists each sign-in by its device, this one marked, and signs one out', async () => {
      const { email } = await createCustomer(prisma);
      const mac = await signIn(email, CHROME_MAC);
      const phone = await signIn(email, SAFARI_IPHONE);

      const list = await request(url, '/auth/sessions', { token: mac.accessToken });
      expect(list.status).toBe(200);
      const rows = list.body as unknown as Array<{ id: string; device: string; current: boolean }>;
      expect(rows.map((r) => r.device).sort()).toEqual(['Chrome on Mac', 'Safari on an iPhone']);
      expect(rows.find((r) => r.current)?.device).toBe('Chrome on Mac');

      const iphone = rows.find((r) => r.device === 'Safari on an iPhone')!;
      const ended = await request(url, `/auth/sessions/${iphone.id}/end`, { method: 'POST', token: mac.accessToken });
      expect(ended.status).toBe(200);
      // That phone can no longer stay signed in…
      const refresh = await request(url, '/auth/refresh', {
        method: 'POST',
        body: { refreshToken: phone.refreshToken },
      });
      expect(refresh.status).toBe(401);
      // …and this one still can.
      const mine = await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: mac.refreshToken } });
      expect(mine.status).toBe(200);
    });

    it('signs out everywhere but here', async () => {
      const { email } = await createCustomer(prisma);
      const here = await signIn(email, CHROME_MAC);
      const there = await signIn(email, SAFARI_IPHONE);
      const res = await request(url, '/auth/sessions/end-others', { method: 'POST', token: here.accessToken });
      expect(res.status).toBe(200);
      expect(
        (await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: there.refreshToken } })).status,
      ).toBe(401);
      expect(
        (await request(url, '/auth/refresh', { method: 'POST', body: { refreshToken: here.refreshToken } })).status,
      ).toBe(200);
    });

    it('signing out ends the sign-in', async () => {
      const { email } = await createCustomer(prisma);
      const pair = await signIn(email);
      await request(url, '/auth/logout', { method: 'POST', body: { refreshToken: pair.refreshToken } });
      const other = await signIn(email, SAFARI_IPHONE);
      const rows = (await request(url, '/auth/sessions', { token: other.accessToken })).body as unknown as unknown[];
      expect(rows).toHaveLength(1);
    });
  });

  describe('the new-sign-in notice', () => {
    const notices = (userId: string) =>
      prisma.notification.count({ where: { recipientId: userId, type: NotificationType.NEW_SIGN_IN } });

    it('tells them about a device not seen before — once, and not for the same kind again', async () => {
      const { userId, email } = await createCustomer(prisma);
      await signIn(email, CHROME_MAC);
      expect(await notices(userId)).toBe(0); // their first sign-in we know of
      await signIn(email, CHROME_MAC);
      expect(await notices(userId)).toBe(0); // the same Mac's Chrome
      await signIn(email, SAFARI_IPHONE);
      expect(await notices(userId)).toBe(1);
      const sent = await prisma.notification.findFirstOrThrow({
        where: { recipientId: userId, type: NotificationType.NEW_SIGN_IN },
      });
      expect(sent.subject).toBe('New sign-in on Safari on an iPhone');
      expect(sent.link).toBe('/sessions');
    });
  });

  describe('an administrator’s two-step sign-in', () => {
    it('sets up with the app’s first code, then asks for it at every sign-in', async () => {
      const admin = await createAdmin(prisma);
      const first = await signIn(admin.email);

      const started = await request(url, '/auth/two-step/start', { method: 'POST', token: first.accessToken });
      expect(started.status).toBe(200);
      const secret = String(started.body.secret).replace(/\s/g, '');
      expect(String(started.body.otpauthUrl)).toContain('otpauth://totp/');

      const wrong = await request(url, '/auth/two-step/confirm', {
        method: 'POST',
        token: first.accessToken,
        body: { code: '000000' },
      });
      expect(wrong.status).toBe(400);
      const now = Date.now() / 1000;
      const on = await request(url, '/auth/two-step/confirm', {
        method: 'POST',
        token: first.accessToken,
        body: { code: totpAt(secret, now) },
      });
      expect(on.status).toBe(200);
      const recovery = on.body.recoveryCodes as string[];
      expect(recovery).toHaveLength(10);
      const fresh = on.body.tokens as Pair;

      // The new tokens open the console; the ones from before it was on do not.
      expect((await request(url, '/admin/users', { token: fresh.accessToken })).status).toBe(200);
      expect((await request(url, '/admin/users', { token: first.accessToken })).status).toBe(401);

      // Signing in again: the email code alone is not enough, and stays usable.
      const code = await askCode(admin.email);
      const asked = await verify(admin.email, code);
      expect(asked.status).toBe(403);
      expect(asked.body.code).toBe('TWO_STEP_REQUIRED');
      expect((await verify(admin.email, code, CHROME_MAC, '123456')).status).toBe(400);
      // The code just used to turn it on cannot be used again.
      expect((await verify(admin.email, code, CHROME_MAC, totpAt(secret, now))).status).toBe(400);
      const later = totpAt(secret, now + 30);
      const signedIn = await verify(admin.email, code, CHROME_MAC, later);
      expect(signedIn.status).toBe(200);
      expect(
        (await request(url, '/admin/users', { token: (signedIn.body as unknown as Pair).accessToken })).status,
      ).toBe(200);

      // A recovery code works once.
      const again = await askCode(admin.email);
      expect((await verify(admin.email, again, CHROME_MAC, recovery[0])).status).toBe(200);
      const third = await askCode(admin.email);
      expect((await verify(admin.email, third, CHROME_MAC, recovery[0])).status).toBe(400);
    });

    it('when required, an administrator without it sees only the setup', async () => {
      process.env.ADMIN_TWO_STEP_REQUIRED = 'true';
      try {
        const admin = await createAdmin(prisma);
        const pair = await signIn(admin.email);
        const blocked = await request(url, '/admin/users', { token: pair.accessToken });
        expect(blocked.status).toBe(403);
        expect(blocked.body.code).toBe('TWO_STEP_SETUP_REQUIRED');
        expect((await request(url, '/auth/two-step', { token: pair.accessToken })).status).toBe(200);
      } finally {
        delete process.env.ADMIN_TWO_STEP_REQUIRED;
      }
    });

    it('a sign-in ended elsewhere stops at once for an administrator', async () => {
      const admin = await createAdmin(prisma);
      const pair = await signIn(admin.email);
      expect((await request(url, '/admin/users', { token: pair.accessToken })).status).toBe(200);
      await request(url, '/auth/logout', { method: 'POST', body: { refreshToken: pair.refreshToken } });
      expect((await request(url, '/admin/users', { token: pair.accessToken })).status).toBe(401);
    });

    it('the primary administrator can turn it off for one who lost their phone', async () => {
      const admin = await createAdmin(prisma);
      await prisma.user.update({
        where: { id: admin.userId },
        data: { totpEnabledAt: new Date(), totpSecret: 'v1.x.y.z' },
      });
      const primary = await createAdmin(prisma);
      await prisma.user.update({ where: { id: primary.userId }, data: { isPrimaryAdmin: true } });
      const token = ctx.token(primary.userId, primary.email, 'ADMIN');
      const notPrimary = ctx.token(admin.userId, admin.email, 'ADMIN');

      // (Their own token predates two-step, so it is refused before it gets that far.)
      expect(
        (await request(url, `/admin/users/${primary.userId}/two-step/reset`, { method: 'POST', token: notPrimary }))
          .status,
      ).toBe(401);
      const res = await request(url, `/admin/users/${admin.userId}/two-step/reset`, { method: 'POST', token });
      expect(res.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
      expect(after.totpEnabledAt).toBeNull();
      expect(after.totpSecret).toBeNull();
    });
  });
});
