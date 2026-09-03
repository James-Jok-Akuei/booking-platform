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

  /** A COMPLETED appointment for customerA at alpha, plus its review. */
  const seedReview = async () => {
    const appointment = await createAppointment(prisma, {
      business: alpha,
      customerId: customerA.userId,
      status: AppointmentStatus.COMPLETED,
      verified: true,
    });
    const review = await prisma.review.create({
      data: {
        appointmentId: appointment.id,
        customerId: customerA.userId,
        businessId: alpha.businessId,
        locationId: alpha.locationId,
        rating: 4,
      },
    });
    return { appointmentId: appointment.id, reviewId: review.id };
  };

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

  describe('reviews over HTTP (§28)', () => {
    it('unauthenticated review creation -> 401', async () => {
      const { appointmentId } = await seedReview();
      const res = await request(url, `/appointments/${appointmentId}/reviews`, {
        method: 'POST',
        body: { rating: 5 },
      });

      expect(res.status).toBe(401);
    });

    it('unauthenticated response posting -> 401', async () => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/reviews/${reviewId}/response`, {
        method: 'POST',
        body: { responseText: 'hello' },
      });

      expect(res.status).toBe(401);
    });

    it('unauthenticated hide -> 401', async () => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/admin/reviews/${reviewId}/hide`, {
        method: 'PATCH',
        body: { hiddenReason: 'because' },
      });

      expect(res.status).toBe(401);
    });

    it('a BUSINESS token cannot create a review -> 403', async () => {
      const { appointmentId } = await seedReview();
      const res = await request(url, `/appointments/${appointmentId}/reviews`, {
        method: 'POST',
        token: tokenAlpha,
        body: { rating: 5 },
      });

      expect(res.status).toBe(403);
    });

    it.each([
      ['CUSTOMER', () => tokenCustomerA],
      ['BUSINESS', () => tokenAlpha],
    ])('a %s token cannot hide a review -> 403', async (_role, token) => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/admin/reviews/${reviewId}/hide`, {
        method: 'PATCH',
        token: token(),
        body: { hiddenReason: 'Not my call to make.' },
      });

      expect(res.status).toBe(403);
    });

    it("customer B cannot edit customer A's review", async () => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/reviews/${reviewId}`, {
        method: 'PATCH',
        token: tokenCustomerB,
        body: { rating: 1 },
      });

      expect(res.status).toBe(404);
    });

    it("a different business cannot respond to another business's review", async () => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/reviews/${reviewId}/response`, {
        method: 'POST',
        token: tokenBeta,
        body: { responseText: 'Not my customer.' },
      });

      expect(res.status).toBe(404);
    });

    it('the public listing is reachable with no token at all', async () => {
      await seedReview();
      const res = await request(url, `/locations/${alpha.locationId}/reviews`);

      expect(res.status).toBe(200);
      expect(typeof res.body.ratingCount).toBe('number');
    });

    it('the public listing exposes no customer email to an anonymous caller', async () => {
      await seedReview();
      const res = await request(url, `/locations/${alpha.locationId}/reviews`);

      expect(JSON.stringify(res.body)).not.toContain(customerA.email);
    });

    it('an admin token hides successfully', async () => {
      const { reviewId } = await seedReview();
      const res = await request(url, `/admin/reviews/${reviewId}/hide`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: { hiddenReason: 'Contains personal data.' },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('analytics over HTTP (§29)', () => {
    it('unauthenticated -> 401', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/analytics`);

      expect(res.status).toBe(401);
    });

    it('a CUSTOMER token -> 403 (business and admin only)', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/analytics`, {
        token: tokenCustomerA,
      });

      expect(res.status).toBe(403);
    });

    it("business B cannot read business A's analytics -> 403", async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/analytics`, {
        token: tokenBeta,
      });

      expect(res.status).toBe(403);
    });

    it('a member of the business can read its own -> 200', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/analytics`, {
        token: tokenAlpha,
      });

      expect(res.status).toBe(200);
      expect(res.body.businessId).toBe(alpha.businessId);
    });

    it('an admin can read any business -> 200', async () => {
      const res = await request(url, `/businesses/${beta.businessId}/analytics`, {
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
    });

    it('a range longer than the cap -> 400', async () => {
      const from = new Date(Date.now() - 400 * 86_400_000).toISOString();
      const to = new Date().toISOString();
      const res = await request(
        url,
        `/businesses/${alpha.businessId}/analytics?from=${from}&to=${to}`,
        { token: tokenAlpha },
      );

      expect(res.status).toBe(400);
    });

    it('never returns a single combined "revenue" figure', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/analytics`, {
        token: tokenAlpha,
      });

      // A business reading one number as its total takings, finding it wrong,
      // and distrusting the dashboard is worse than no dashboard.
      expect(JSON.stringify(res.body)).not.toContain('"revenue"');
    });
  });

  describe('clearing a display name over HTTP (§31)', () => {
    const clear = (targetId: string, token: string | undefined, body: unknown) =>
      request(url, `/admin/users/${targetId}/display-name/clear`, {
        method: 'PATCH',
        token,
        body,
      });

    it('rejects a CUSTOMER token -> 403', async () => {
      const res = await clear(customerB.userId, tokenCustomerA, { reason: 'I object.' });

      expect(res.status).toBe(403);
    });

    it('rejects a BUSINESS token -> 403', async () => {
      const res = await clear(customerA.userId, tokenAlpha, { reason: 'Bad name.' });

      expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request -> 401', async () => {
      const res = await clear(customerA.userId, undefined, { reason: 'Bad name.' });

      expect(res.status).toBe(401);
    });

    it('rejects an admin who gives no reason -> 400', async () => {
      const res = await clear(customerA.userId, tokenAdmin, {});

      // The ValidationPipe, not the service: moderation without a recorded
      // reason should never reach the database in the first place.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
    });

    it('lets an admin with a reason through -> 200, and the name is null', async () => {
      await prisma.user.update({
        where: { id: customerA.userId },
        data: { displayName: 'Moderate Me' },
      });

      const res = await clear(customerA.userId, tokenAdmin, {
        reason: 'Impersonates a business.',
      });

      expect(res.status).toBe(200);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: customerA.userId },
        select: { displayName: true },
      });
      // Null, not the literal 'Anonymous' the reader will be shown.
      expect(row.displayName).toBeNull();
    });
  });

  describe('a display name over HTTP passes through the ValidationPipe', () => {
    it('rejects an email address as a display name -> 400', async () => {
      const res = await request(url, `/appointments/${appointmentA}/reviews`, {
        method: 'POST',
        token: tokenCustomerA,
        body: { rating: 5, displayName: 'jane.doe@example.com' },
      });

      // 400 from the pipe, before the service can rule the appointment out
      // for not being COMPLETED - the pipe runs first.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('displayName');
    });

    it('rejects a one-character display name -> 400', async () => {
      const res = await request(url, `/appointments/${appointmentA}/reviews`, {
        method: 'POST',
        token: tokenCustomerA,
        body: { rating: 5, displayName: ' A ' },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('displayName');
    });
  });

  describe('payout and balance routes over HTTP (§35)', () => {
    it('POST /admin/payouts/run rejects a BUSINESS token -> 403', async () => {
      const res = await request(url, '/admin/payouts/run', {
        method: 'POST',
        token: tokenAlpha,
      });

      expect(res.status).toBe(403);
    });

    it('POST /admin/payouts/run rejects a CUSTOMER token -> 403', async () => {
      const res = await request(url, '/admin/payouts/run', {
        method: 'POST',
        token: tokenCustomerA,
      });

      expect(res.status).toBe(403);
    });

    it('POST /admin/payouts/run accepts an ADMIN token -> 200', async () => {
      const res = await request(url, '/admin/payouts/run', {
        method: 'POST',
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
    });

    it('GET /admin/payouts rejects a BUSINESS token -> 403', async () => {
      const res = await request(url, '/admin/payouts', { token: tokenAlpha });

      expect(res.status).toBe(403);
    });

    it('mark-paid with no reference -> 400 from the ValidationPipe', async () => {
      const payout = await prisma.payout.create({
        data: {
          businessId: alpha.businessId,
          amountCents: 1000,
          currency: 'USD',
          settlementCurrency: 'SSP',
          settlementAmountMinor: 650_000,
          runAt: new Date(),
        },
      });

      const res = await request(url, `/admin/payouts/${payout.id}/mark-paid`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reference');
    });

    it('mark-failed with no reason -> 400', async () => {
      const payout = await prisma.payout.create({
        data: {
          businessId: alpha.businessId,
          amountCents: 1000,
          currency: 'USD',
          settlementCurrency: 'SSP',
          settlementAmountMinor: 650_000,
          runAt: new Date(),
        },
      });

      const res = await request(url, `/admin/payouts/${payout.id}/mark-failed`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
    });

    it("a business cannot read another business's balance -> 404", async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/balance`, {
        token: tokenBeta,
      });

      // 404, not 403: the same rule the rest of the platform uses.
      expect(res.status).toBe(404);
    });

    it("a business cannot read another business's payouts -> 404", async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/payouts`, {
        token: tokenBeta,
      });

      expect(res.status).toBe(404);
    });

    it('a business can read its own balance -> 200', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/balance`, {
        token: tokenAlpha,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('availableNowCents');
    });

    it('an admin can read any balance -> 200', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/balance`, {
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
    });

    it('an unauthenticated request is refused -> 401', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/balance`);

      expect(res.status).toBe(401);
    });

    it('a CUSTOMER token cannot reach the balance route at all -> 403', async () => {
      const res = await request(url, `/businesses/${alpha.businessId}/balance`, {
        token: tokenCustomerA,
      });

      expect(res.status).toBe(403);
    });
  });

  describe('refund and reconciliation routes over HTTP (§36)', () => {
    it('GET /admin/ledger/held rejects a BUSINESS token -> 403', async () => {
      const res = await request(url, '/admin/ledger/held', { token: tokenAlpha });

      expect(res.status).toBe(403);
    });

    it('GET /admin/ledger/held accepts an ADMIN token -> 200', async () => {
      const res = await request(url, '/admin/ledger/held', { token: tokenAdmin });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('bySettlementCurrency');
    });

    it('reclassifying a cancellation rejects a BUSINESS token -> 403', async () => {
      const res = await request(
        url,
        `/admin/appointments/${appointmentA}/business-cancellation`,
        {
          method: 'PATCH',
          token: tokenAlpha,
          body: { reason: 'Let me off.', gatewayChargeMinor: 0 },
        },
      );

      expect(res.status).toBe(403);
    });

    it('reclassifying without a gateway charge -> 400 from the ValidationPipe', async () => {
      const res = await request(
        url,
        `/admin/appointments/${appointmentA}/business-cancellation`,
        { method: 'PATCH', token: tokenAdmin, body: { reason: 'No figure given.' } },
      );

      // The charge is supplied, never guessed (§36.2), so its absence is a
      // request error rather than a silent zero.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('gatewayChargeMinor');
    });

    it('executing a billing adjustment rejects a CUSTOMER token -> 403', async () => {
      const res = await request(
        url,
        '/admin/billing-adjustments/00000000-0000-4000-8000-000000000000/execute',
        { method: 'PATCH', token: tokenCustomerA, body: {} },
      );

      expect(res.status).toBe(403);
    });
  });

  describe('the payout hold setting over HTTP (§38)', () => {
    it('rejects a BUSINESS token reading it -> 403', async () => {
      const res = await request(url, '/admin/settings/payout-hold', {
        token: tokenAlpha,
      });

      expect(res.status).toBe(403);
    });

    it('rejects a CUSTOMER token reading it -> 403', async () => {
      const res = await request(url, '/admin/settings/payout-hold', {
        token: tokenCustomerA,
      });

      expect(res.status).toBe(403);
    });

    it('rejects a BUSINESS token writing it -> 403', async () => {
      const res = await request(url, '/admin/settings/payout-hold', {
        method: 'PATCH',
        token: tokenAlpha,
        body: { payoutHoldDays: 0 },
      });

      expect(res.status).toBe(403);
    });

    it('accepts an ADMIN token -> 200', async () => {
      const res = await request(url, '/admin/settings/payout-hold', {
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('payoutHoldDays');
    });

    it.each([-1, 31])('rejects a hold of %s days -> 400', async (days) => {
      const res = await request(url, '/admin/settings/payout-hold', {
        method: 'PATCH',
        token: tokenAdmin,
        body: { payoutHoldDays: days },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('payoutHoldDays');
    });
  });

  describe('approxSettlement is display only, over HTTP (§39)', () => {
    it('is rejected as input on a write endpoint -> 400', async () => {
      const res = await request(url, '/appointments', {
        method: 'POST',
        token: tokenCustomerA,
        body: {
          locationId: alpha.locationId,
          serviceId: alpha.serviceId,
          startTime: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          approxSettlement: { currency: 'SSP', amountMinor: 1 },
        },
      });

      // forbidNonWhitelisted: the field is not on any DTO, so it cannot be
      // smuggled in and quietly ignored either.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('approxSettlement');
    });

    it('is rejected on cancel too', async () => {
      const res = await request(url, `/appointments/${appointmentA}/cancel`, {
        method: 'POST',
        token: tokenCustomerA,
        body: { approxSettlement: { currency: 'SSP', amountMinor: 1 } },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('approxSettlement');
    });

    it('appears for the customer and not for the business on the same appointment', async () => {
      await prisma.platformSetting.upsert({
        where: { id: 'platform' },
        update: {
          providerCurrency: 'SSP',
          exchangeRateUsdToProviderCurrency: 650,
          exchangeRateUpdatedAt: new Date(),
        },
        create: {
          id: 'platform',
          providerCurrency: 'SSP',
          exchangeRateUsdToProviderCurrency: 650,
          exchangeRateUpdatedAt: new Date(),
        },
      });

      const asCustomer = await request(url, `/appointments/${appointmentA}`, {
        token: tokenCustomerA,
      });
      const asBusiness = await request(url, `/appointments/${appointmentA}`, {
        token: tokenAlpha,
      });

      expect(asCustomer.status).toBe(200);
      expect(asBusiness.status).toBe(200);
      expect(asCustomer.body).toHaveProperty('approxSettlement');
      // Same route, same appointment: the figure follows the reader.
      expect(asBusiness.body).not.toHaveProperty('approxSettlement');
      expect(asBusiness.body.depositAmountCents).toBe(
        asCustomer.body.depositAmountCents,
      );
    });
  });

  describe('business moderation over HTTP (§42)', () => {
    const pendingShop = async () => {
      const b = await prisma.businessProfile.create({
        data: { name: 'Applicant', status: 'PENDING' },
      });
      return b.id;
    };

    it.each(['/admin/businesses'])('%s rejects a CUSTOMER token -> 403', async (path) => {
      const res = await request(url, path, { token: tokenCustomerA });

      expect(res.status).toBe(403);
    });

    it('GET /admin/businesses rejects a BUSINESS token -> 403', async () => {
      const res = await request(url, '/admin/businesses', { token: tokenAlpha });

      expect(res.status).toBe(403);
    });

    it('GET /admin/businesses accepts an ADMIN token -> 200', async () => {
      const res = await request(url, '/admin/businesses?status=PENDING', {
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('businesses');
    });

    it('approving rejects a BUSINESS token -> 403', async () => {
      const id = await pendingShop();

      const res = await request(url, `/admin/businesses/${id}/approve`, {
        method: 'PATCH',
        token: tokenAlpha,
      });

      expect(res.status).toBe(403);
    });

    it('rejecting with no reason -> 400 from the ValidationPipe', async () => {
      const id = await pendingShop();

      const res = await request(url, `/admin/businesses/${id}/reject`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
    });

    it('suspending with no reason -> 400', async () => {
      const res = await request(url, `/admin/businesses/${alpha.businessId}/suspend`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
    });

    it('an admin can approve, and the business goes public -> 200', async () => {
      const id = await pendingShop();

      const res = await request(url, `/admin/businesses/${id}/approve`, {
        method: 'PATCH',
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('an unauthenticated request is refused -> 401', async () => {
      const res = await request(url, '/admin/businesses');

      expect(res.status).toBe(401);
    });
  });

  describe('discovery is public, over HTTP (§43)', () => {
    it('GET /discover/locations works with NO token at all', async () => {
      const res = await request(url, '/discover/locations');

      // The front door. A customer must be able to find a business before they
      // have any reason to sign up.
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('locations');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
    });

    it('GET /discover/locations/:id works with no token', async () => {
      const res = await request(url, `/discover/locations/${alpha.locationId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(alpha.locationId);
      // Reviews are NOT embedded — /locations/:id/reviews already exists.
      expect(res.body).not.toHaveProperty('reviews');
    });

    it('accepts a valid token too, and returns the same thing', async () => {
      const anon = await request(url, '/discover/locations');
      const authed = await request(url, '/discover/locations', {
        token: tokenCustomerA,
      });

      expect(authed.status).toBe(200);
      expect(authed.body.total).toBe(anon.body.total);
    });

    it('rejects lat without lng -> 400', async () => {
      const res = await request(url, '/discover/locations?lat=4.85');

      expect(res.status).toBe(400);
    });

    it('rejects sort=distance with no centre -> 400', async () => {
      const res = await request(url, '/discover/locations?sort=distance');

      expect(res.status).toBe(400);
    });

    it('rejects an unknown sort value -> 400', async () => {
      const res = await request(url, '/discover/locations?sort=nonsense');

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('sort');
    });

    it('rejects a malformed location id -> 400', async () => {
      const res = await request(url, '/discover/locations/not-a-uuid');

      expect(res.status).toBe(400);
    });
  });

  describe('location coordinates are required (§43.2)', () => {
    it('POST /business/locations without coordinates -> 400', async () => {
      const res = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: { name: 'No pin', address: 'Somewhere in Juba' },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('latitude');
    });

    it('POST with 0,0 is rejected -> 400', async () => {
      const res = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: {
          name: 'Null Island',
          address: 'Gulf of Guinea',
          latitude: 0,
          longitude: 0,
        },
      });

      expect(res.status).toBe(400);
    });

    it.each([
      ['latitude out of range', { latitude: 91, longitude: 31.58 }],
      ['longitude out of range', { latitude: 4.85, longitude: 181 }],
    ])('POST with %s -> 400', async (_label, coords) => {
      const res = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: { name: 'Bad pin', address: 'Somewhere', ...coords },
      });

      expect(res.status).toBe(400);
    });

    it('POST with valid coordinates succeeds -> 201', async () => {
      const res = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: {
          name: 'Juba Town Branch',
          address: 'Ministries Road',
          latitude: 4.85,
          longitude: 31.58,
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.latitude).toBe(4.85);
    });

    it('PATCH cannot clear coordinates that exist -> 400', async () => {
      const created = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: {
          name: 'Clearable?',
          address: 'Ministries Road',
          latitude: 4.85,
          longitude: 31.58,
        },
      });

      const res = await request(url, `/business/locations/${created.body.id}`, {
        method: 'PATCH',
        token: tokenAlpha,
        body: { latitude: null, longitude: null },
      });

      // Clearing would drop the location out of every distance search silently.
      expect(res.status).toBe(400);
    });

    it('PATCH can ADD coordinates to a pre-§43 location -> 200', async () => {
      // Rows created before coordinates were required genuinely have none.
      // This is exactly how such a location becomes discoverable.
      const legacy = await prisma.location.create({
        data: {
          businessId: alpha.businessId,
          name: 'Legacy branch',
          address: 'Recorded before coordinates were required',
        },
      });

      const res = await request(url, `/business/locations/${legacy.id}`, {
        method: 'PATCH',
        token: tokenAlpha,
        body: { latitude: 4.85, longitude: 31.58 },
      });

      expect(res.status).toBe(200);
      expect(res.body.latitude).toBe(4.85);
    });

    it('PATCH can correct coordinates -> 200', async () => {
      const created = await request(url, '/business/locations', {
        method: 'POST',
        token: tokenAlpha,
        body: {
          name: 'Correctable',
          address: 'Ministries Road',
          latitude: 4.85,
          longitude: 31.58,
        },
      });

      const res = await request(url, `/business/locations/${created.body.id}`, {
        method: 'PATCH',
        token: tokenAlpha,
        body: { latitude: 4.86, longitude: 31.59 },
      });

      expect(res.status).toBe(200);
      expect(res.body.latitude).toBe(4.86);
    });
  });

  describe('payout export over HTTP (§47)', () => {
    const aPayout = async () =>
      prisma.payout.create({
        data: {
          businessId: alpha.businessId,
          amountCents: 4500,
          currency: 'USD',
          settlementCurrency: 'SSP',
          settlementAmountMinor: 2_925_000,
          runAt: new Date(),
        },
      });

    it('rejects a BUSINESS token -> 403', async () => {
      const payout = await aPayout();

      const res = await request(url, `/admin/payouts/${payout.id}/export`, {
        token: tokenAlpha,
      });

      expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request -> 401', async () => {
      const payout = await aPayout();

      const res = await request(url, `/admin/payouts/${payout.id}/export`);

      expect(res.status).toBe(401);
    });

    it('serves CSV as an attachment to an admin -> 200', async () => {
      const payout = await aPayout();

      const response = await fetch(`${url}/admin/payouts/${payout.id}/export`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(body.split('\n')[0]).toContain('businessId,businessName');
      expect(body).toContain('SSP,2925000');
      // alpha has a verified destination seeded by the factory (§48), so the
      // real number is exported and the row is payable.
      expect(body).toContain('payable');
      expect(body).toContain('MTN_MOMO');
    });
  });

  describe('payout destinations over HTTP (§48)', () => {
    it('a STAFF member cannot submit -> 403', async () => {
      const res = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: tokenAlphaStaff,
        body: { msisdn: '+211921234567' },
      });

      // Redirecting where money is sent is OWNER-only.
      expect(res.status).toBe(403);
    });

    it('a CUSTOMER cannot reach the business route at all -> 403', async () => {
      const res = await request(url, '/business/payout-destination', {
        token: tokenCustomerA,
      });

      expect(res.status).toBe(403);
    });

    it('an OWNER can submit a valid number -> 201', async () => {
      const res = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: tokenBeta,
        body: { msisdn: '+211925550001' },
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('UNVERIFIED');
    });

    it('rejects a malformed msisdn -> 400', async () => {
      const res = await request(url, '/business/payout-destination', {
        method: 'POST',
        token: tokenBeta,
        body: { msisdn: 'not-a-number' },
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('msisdn');
    });

    it('a STAFF member reading sees the status but not the number', async () => {
      const res = await request(url, '/business/payout-destination', {
        token: tokenAlphaStaff,
      });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/\+2119\d{7}/);
    });

    it('GET /admin/payout-destinations rejects a BUSINESS token -> 403', async () => {
      const res = await request(url, '/admin/payout-destinations', {
        token: tokenAlpha,
      });

      expect(res.status).toBe(403);
    });

    it('GET /admin/payout-destinations accepts an ADMIN token -> 200', async () => {
      const res = await request(url, '/admin/payout-destinations?status=UNVERIFIED', {
        token: tokenAdmin,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('destinations');
    });

    it('verifying with no note -> 400 from the ValidationPipe', async () => {
      const created = await prisma.payoutDestination.findFirstOrThrow({
        where: { status: 'UNVERIFIED' },
      });

      const res = await request(url, `/admin/payout-destinations/${created.id}/verify`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('verificationNote');
    });

    it('rejecting with no reason -> 400', async () => {
      const created = await prisma.payoutDestination.findFirstOrThrow({
        where: { status: 'UNVERIFIED' },
      });

      const res = await request(url, `/admin/payout-destinations/${created.id}/reject`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: {},
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
    });

    it('a BUSINESS token cannot verify its own number -> 403', async () => {
      const created = await prisma.payoutDestination.findFirstOrThrow({
        where: { status: 'UNVERIFIED' },
      });

      const res = await request(url, `/admin/payout-destinations/${created.id}/verify`, {
        method: 'PATCH',
        token: tokenBeta,
        body: { verificationNote: 'It is mine, honestly.' },
      });

      expect(res.status).toBe(403);
    });

    it('an admin can verify -> 200, recording ADMIN as the method', async () => {
      const created = await prisma.payoutDestination.findFirstOrThrow({
        where: { status: 'UNVERIFIED' },
      });

      const res = await request(url, `/admin/payout-destinations/${created.id}/verify`, {
        method: 'PATCH',
        token: tokenAdmin,
        body: { verificationNote: 'Confirmed by phone.' },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('VERIFIED');
      expect(res.body.verificationMethod).toBe('ADMIN');
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
