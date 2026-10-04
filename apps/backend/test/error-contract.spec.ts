import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createAdmin, createCustomer } from './setup/factories';

/**
 * The failure shapes the contract publishes (§129.1).
 *
 * These were established by probing the booted application, because Nest's
 * serialisation of `HttpException` is NOT uniform and reading the documentation
 * would have given the wrong answer. That probe was throwaway; this is not —
 * without it, nothing stops the shape changing under three clients and a
 * published contract that both claim to know it.
 *
 * Over HTTP, deliberately. Every shape here is produced by the global
 * ValidationPipe, a guard, or Nest's own exception layer — none of which a test
 * that calls a service directly goes anywhere near.
 */
describe('Error contract over HTTP (§129.1)', () => {
  let ctx: E2eContext;
  let url: string;

  beforeAll(async () => {
    ctx = await createE2eApp();
    url = ctx.url;
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => ctx?.close());

  it('401 carries statusCode and message, and NO error field', async () => {
    const { status, body } = await request(url, '/users/me');

    expect(status).toBe(401);
    expect(body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    // The point of the test: `UnauthorizedErrorDto` omits `error` because this
    // response omits it. A client reading it here gets undefined.
    expect(body).not.toHaveProperty('error');
  });

  it('403 carries all three fields', async () => {
    const customer = await createCustomer(ctx.prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');

    const { status, body } = await request(url, '/admin/payouts', { token });

    expect(status).toBe(403);
    expect(body).toEqual({
      statusCode: 403,
      message: 'Forbidden resource',
      error: 'Forbidden',
    });
  });

  it('a validation failure puts an ARRAY in message, one entry per rule', async () => {
    const { status, body } = await request(url, '/auth/otp/request', {
      method: 'POST',
      body: { email: 'not-an-email' },
    });

    expect(status).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message).toEqual(['email must be an email']);
  });

  it('an unknown property is refused by name, not ignored', async () => {
    const { status, body } = await request(url, '/auth/otp/request', {
      method: 'POST',
      body: { email: 'someone@example.com', nope: 1 },
    });

    expect(status).toBe(400);
    expect(body.message).toEqual(['property nope should not exist']);
  });

  it('a malformed uuid is a 400 with a SINGLE string message', async () => {
    const customer = await createCustomer(ctx.prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');

    const { status, body } = await request(url, '/appointments/not-a-uuid', {
      token,
    });

    expect(status).toBe(400);
    // A string here, an array above — the whole reason `message` is published
    // as `string | string[]`.
    expect(typeof body.message).toBe('string');
    expect(body.message).toBe('Validation failed (uuid is expected)');
  });

  it('a domain failure is a readable sentence', async () => {
    const admin = await createAdmin(ctx.prisma);
    const token = ctx.token(admin.userId, admin.email, 'ADMIN');

    const { status, body } = await request(
      url,
      '/admin/businesses/00000000-0000-4000-8000-000000000000',
      { token },
    );

    expect(status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      message: 'Business not found.',
      error: 'Not Found',
    });
  });

  it("a stranger's resource is a 404, never a 403 (§27.2)", async () => {
    const customer = await createCustomer(ctx.prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');

    const { status } = await request(
      url,
      '/appointments/00000000-0000-4000-8000-000000000000',
      { token },
    );

    // 404 and not 403: a 403 would confirm the id exists.
    expect(status).toBe(404);
  });
});
