import { PrismaService } from '../src/prisma/prisma.service';
import { localeOf } from '../src/i18n/locales';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createCustomer } from './setup/factories';

/**
 * The language a person reads the platform in (§308): chosen in an app, kept
 * on the account, so what is sent while they are away can follow it.
 */
describe('The chosen language (§308)', () => {
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

  it('is English until chosen, and follows the choice', async () => {
    const customer = await createCustomer(prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');
    expect((await request(url, '/users/me', { token })).body.locale).toBe('en');

    const set = await request(url, '/users/me/locale', { method: 'PATCH', token, body: { locale: 'rw' } });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ locale: 'rw' });
    expect((await request(url, '/users/me', { token })).body.locale).toBe('rw');
  });

  it('refuses a language the platform does not speak', async () => {
    const customer = await createCustomer(prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');
    const res = await request(url, '/users/me/locale', { method: 'PATCH', token, body: { locale: 'sw' } });
    expect(res.status).toBe(400);
  });

  it('reads the language a request asks for, falling back to English', () => {
    expect(localeOf('rw-RW,rw;q=0.9,en;q=0.8')).toBe('rw');
    expect(localeOf('fr-FR,fr;q=0.9')).toBe('fr');
    expect(localeOf('de-DE,sw;q=0.8,fr;q=0.5')).toBe('fr');
    expect(localeOf('de-DE')).toBe('en');
    expect(localeOf(undefined)).toBe('en');
  });
});
