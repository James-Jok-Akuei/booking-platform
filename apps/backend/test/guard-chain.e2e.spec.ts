import { AppointmentStatus, BusinessMemberRole, TicketCategory } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  addMember,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * The guard chain, as an HTTP client actually experiences it.
 *
 * Closes the gap §23.3 recorded: every other suite calls services directly, so
 * JwtAuthGuard, RolesGuard, BusinessRolesGuard, the global ValidationPipe and
 * the exception filter are never exercised. These tests go over the wire
 * against the real booted application.
 *
 * One representative route per protected module rather than every endpoint —
 * the guards are declared per controller, so re-testing each handler would
 * assert the same decorator repeatedly.
 */
describe('Guard chain over HTTP (§23.3)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  let url: string;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let alphaStaff: { userId: string; email: string };
  let customerA: { userId: string; email: string };
  let customerB: { userId: string; email: string };

  // Resources belonging to alpha / customerA that the other tenant will probe.
  let appointmentA: string;
  let ticketA: string;
  let threadA: string;

  let tokenCustomerA: string;
  let tokenCustomerB: string;
  let tokenAlpha: string;
  let tokenBeta: string;
  let tokenAlphaStaff: string;
  let tokenAdmin: string;

  beforeAll(async () => {
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    url = ctx.url;

    await resetDatabase(prisma);

    admin = await createAdmin(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    alphaStaff = await addMember(prisma, alpha.businessId, BusinessMemberRole.STAFF);
    customerA = await createCustomer(prisma);
    customerB = await createCustomer(prisma);

    tokenCustomerA = ctx.token(customerA.userId, customerA.email, 'CUSTOMER');
    tokenCustomerB = ctx.token(customerB.userId, customerB.email, 'CUSTOMER');
    tokenAlpha = ctx.token(alpha.userId, alpha.email, 'BUSINESS');
    tokenBeta = ctx.token(beta.userId, beta.email, 'BUSINESS');
    tokenAlphaStaff = ctx.token(alphaStaff.userId, alphaStaff.email, 'BUSINESS');
    tokenAdmin = ctx.token(admin.userId, admin.email, 'ADMIN');

    const appointment = await createAppointment(prisma, {
      business: alpha,
      customerId: customerA.userId,
      status: AppointmentStatus.BOOKED,
    });
    appointmentA = appointment.id;

    const ticket = await prisma.ticket.create({
      data: {
        reference: 'TKT-E2E001',
        reporterId: customerA.userId,
        reporterType: 'CUSTOMER',
        category: TicketCategory.TECHNICAL_ISSUE,
        subject: 'Customer A ticket',
        lastMessageAt: new Date(),
      },
    });
    ticketA = ticket.id;

    const thread = await prisma.thread.create({
      data: { customerId: customerA.userId, businessProfileId: alpha.businessId },
    });
    threadA = thread.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await ctx.close();
  });

  /** One representative guarded route per protected module. */
  const GUARDED = [
    ['appointments', () => `/appointments/${appointmentA}`],
    ['chat', () => `/threads/${threadA}`],
    ['tickets', () => '/tickets'],
  ] as const;

  describe('no credentials -> 401', () => {
    it.each(GUARDED)('%s rejects a request with no token', async (_m, path) => {
      const res = await request(url, path());

      expect(res.status).toBe(401);
    });
  });

  describe('bad credentials -> 401', () => {
    it.each(GUARDED)('%s rejects a malformed token', async (_m, path) => {
      const res = await request(url, path(), { token: 'not.a.real.jwt' });

      expect(res.status).toBe(401);
    });

    it.each(GUARDED)('%s rejects a token signed with the wrong key', async (_m, path) => {
      // Correct shape, correct claims, wrong signature.
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiJhIiwiZW1haWwiOiJhQGIuYyIsInJvbGUiOiJDVVNUT01FUiJ9.' +
        'bm90LWEtcmVhbC1zaWduYXR1cmU';
      const res = await request(url, path(), { token: forged });

      expect(res.status).toBe(401);
    });

    it.each(GUARDED)('%s rejects a correctly signed but EXPIRED token', async (_m, path) => {
      const expired = ctx.expiredToken(customerA.userId, customerA.email, 'CUSTOMER');
      const res = await request(url, path(), { token: expired });

      expect(res.status).toBe(401);
    });
  });

  describe('valid token, wrong role -> 403 (RolesGuard)', () => {
    it('a BUSINESS token cannot book an appointment (CUSTOMER-only route)', async () => {
      const res = await request(url, '/appointments', {
        method: 'POST',
        token: tokenAlpha,
        body: {
          locationId: alpha.locationId,
          serviceId: alpha.serviceId,
          startTime: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });

      expect(res.status).toBe(403);
    });

    it('a BUSINESS token cannot open a chat inquiry (CUSTOMER-only route)', async () => {
      const res = await request(url, '/threads/inquiry', {
        method: 'POST',
        token: tokenAlpha,
        body: { businessProfileId: beta.businessId },
      });

      expect(res.status).toBe(403);
    });

    it('a CUSTOMER token cannot reach a BUSINESS-only route', async () => {
      const res = await request(url, '/business/services', { token: tokenCustomerA });

      expect(res.status).toBe(403);
    });
  });

  describe('admin-only routes reject every non-admin -> 403', () => {
    const ADMIN_ROUTES = ['/admin/tickets', '/admin/settings/platform-fee'];

    it.each(ADMIN_ROUTES)('%s rejects a CUSTOMER token', async (path) => {
      const res = await request(url, path, { token: tokenCustomerA });

      expect(res.status).toBe(403);
    });

    it.each(ADMIN_ROUTES)('%s rejects a BUSINESS token', async (path) => {
      const res = await request(url, path, { token: tokenBeta });

      expect(res.status).toBe(403);
    });

    it.each(ADMIN_ROUTES)('%s accepts an ADMIN token', async (path) => {
      const res = await request(url, path, { token: tokenAdmin });

      expect(res.status).toBe(200);
    });
  });

  describe('business role tiers -> 403 (BusinessRolesGuard)', () => {
    it('STAFF cannot create a service (OWNER/MANAGER only)', async () => {
      const res = await request(url, '/business/services', {
        method: 'POST',
        token: tokenAlphaStaff,
        body: { name: 'Staff service', priceCents: 1000, durationMinutes: 30 },
      });

      expect(res.status).toBe(403);
    });

    it('STAFF can still read the service list', async () => {
      const res = await request(url, '/business/services', { token: tokenAlphaStaff });

      expect(res.status).toBe(200);
    });

    it('the OWNER can create a service', async () => {
      const res = await request(url, '/business/services', {
        method: 'POST',
        token: tokenAlpha,
        body: { name: 'Owner service', priceCents: 1000, durationMinutes: 30 },
      });

      expect(res.status).toBe(201);
    });
  });

  /**
   * NOTE: these pass the guard chain entirely — a valid token with the right
   * role reaches the handler, and the SERVICE's query scoping is what refuses.
   * They are included because §23.3 asked for cross-tenant coverage over HTTP,
   * and they do prove the scoping survives the real request pipeline. They are
   * not evidence about the guards. See the report.
   */
  describe('valid token, right role, another tenant\'s resource -> 404', () => {
    it("customer B cannot read customer A's appointment", async () => {
      const res = await request(url, `/appointments/${appointmentA}`, {
        token: tokenCustomerB,
      });

      expect(res.status).toBe(404);
    });

    it("customer B cannot read customer A's ticket", async () => {
      const res = await request(url, `/tickets/${ticketA}`, { token: tokenCustomerB });

      expect(res.status).toBe(404);
    });

    it("customer B cannot read customer A's chat thread", async () => {
      const res = await request(url, `/threads/${threadA}`, { token: tokenCustomerB });

      expect(res.status).toBe(404);
    });

    it("business B cannot read business A's appointment", async () => {
      const res = await request(url, `/appointments/${appointmentA}`, { token: tokenBeta });

      expect(res.status).toBe(404);
    });

    it("business B cannot read business A's chat thread", async () => {
      const res = await request(url, `/threads/${threadA}`, { token: tokenBeta });

      expect(res.status).toBe(404);
    });

    it('the legitimate owner still gets 200 on the same routes', async () => {
      const own = await request(url, `/appointments/${appointmentA}`, {
        token: tokenCustomerA,
      });
      const ticket = await request(url, `/tickets/${ticketA}`, { token: tokenCustomerA });
      const thread = await request(url, `/threads/${threadA}`, { token: tokenCustomerA });

      expect(own.status).toBe(200);
      expect(ticket.status).toBe(200);
      expect(thread.status).toBe(200);
    });

    it('404 is used consistently — never 403 — so existence is not revealed', async () => {
      const foreign = await request(url, `/tickets/${ticketA}`, { token: tokenCustomerB });
      const missing = await request(
        url,
        '/tickets/11111111-1111-4111-8111-111111111111',
        { token: tokenCustomerB },
      );

      expect(foreign.status).toBe(missing.status);
      expect(foreign.body.message).toBe(missing.body.message);
    });
  });

  describe('the global ValidationPipe is in the chain', () => {
    it('rejects an unknown property with 400, proving whitelist/forbidNonWhitelisted ran', async () => {
      const res = await request(url, '/threads/inquiry', {
        method: 'POST',
        token: tokenCustomerA,
        body: { businessProfileId: alpha.businessId, smuggled: 'value' },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('smuggled');
    });

    it('rejects a malformed uuid path param with 400', async () => {
      const res = await request(url, '/tickets/not-a-uuid', { token: tokenCustomerA });

      expect(res.status).toBe(400);
    });
  });
});
