import { INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { LocalisedErrorsFilter } from './i18n/localised-errors.filter';

/**
 * Origins allowed to call this API from a browser, as a comma-separated list.
 *
 * Empty means "any", which is right in development — three apps on three ports
 * plus a simulator, and a list would be one more thing to keep in step. It is
 * refused at boot in production (§116.1).
 */
function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Everything bootstrap applies to the application besides listening.
 *
 * Extracted from main.ts so the boot smoke test can exercise the REAL
 * configuration rather than a copy of it. A copy would drift: main.ts could
 * gain a global filter or interceptor and the test would keep passing against
 * the old shape, which defeats the point of booting the real app at all.
 *
 * main.ts is the only production caller, and its behaviour is unchanged.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Refusals in the language each request asks for (§308).
  app.useGlobalFilters(new LocalisedErrorsFilter(app.getHttpAdapter()));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties from incoming DTOs
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * Browsers are kept to a named list; everything else is unaffected (§116.1).
   *
   * CORS is not an access control — curl, a phone app and a server ignore it
   * entirely, and the throttler and the guards are what actually protect this
   * API. What it does is stop a page on another site making requests from a
   * signed-in person's browser, which matters for the admin and business apps.
   *
   * Tokens live in localStorage rather than cookies, so a hostile origin cannot
   * ride an existing session even today. The list is still worth having: it is
   * one fewer way in, and it costs one environment variable.
   */
  const origins = allowedOrigins();
  app.enableCors(origins.length > 0 ? { origin: origins, credentials: true } : {});

  /**
   * Response headers that cost nothing and remove whole categories of mistake.
   *
   * `contentSecurityPolicy` is off because this process serves no HTML of its
   * own — the three clients are static builds served elsewhere, and the only
   * thing here a browser renders directly is the Swagger page, which its own
   * default policy would then break.
   *
   * `crossOriginResourcePolicy` is relaxed for the same reason the CORS list
   * exists: the local-disk upload fallback serves images at /uploads that the
   * apps load from another origin. Blocking that is exactly §113.1's broken
   * pictures again, from a different direction.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  applyRateLimits(app);

  setupOpenApi(app);

  return app;
}

/**
 * The API contract, generated from the DTOs (§60).
 *
 * Three first-party clients are being built against this backend, and until now
 * the only description of its shape was a hand-written table in
 * `docs/IMPLEMENTATION_INVENTORY.md` — which is a dated snapshot, and which §56
 * deliberately left holding the OLD money field names. A client written from it
 * would have been wrong on its first request.
 *
 * Generated rather than written, for exactly that reason: a hand-maintained
 * contract drifts silently, and the drift is only discovered by whoever is
 * building against it. The `@nestjs/swagger` CLI plugin reads the DTOs' own
 * TypeScript types, so the contract cannot disagree with what the validation
 * pipe actually accepts.
 *
 * Called from `configureApp` rather than `main.ts` so the boot smoke test
 * exercises it (§26.3). Document generation throws on types it cannot resolve,
 * which makes that test a check on the contract as well as on the wiring.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Booking platform API')
    .setDescription(
      'One backend serving the Customer, Business and Admin apps (§4). ' +
        'Money amounts are integer MINOR UNITS of the currency named beside ' +
        'them — never cents unless that currency has two decimal places (§55, §56).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Served only outside production. The spec is a complete map of the attack
  // surface, and the three clients that need it are built from a generated
  // file rather than from a live endpoint.
  if (process.env.NODE_ENV !== 'production' || process.env.OPENAPI_PUBLIC === 'true') {
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}

/**
 * A ceiling on how fast anyone can call anything (§116.2).
 *
 * Nothing capped request rate at all before this. The OTP endpoint has its own
 * per-recipient cooldown, which stops one address being spammed and does nothing
 * about one machine walking a list of thousands — and every other endpoint,
 * including the one that asks MTN to charge a phone, had no limit of any kind.
 *
 * **Express middleware rather than `@nestjs/throttler`**, and not by preference.
 * That package has no release past 6.7.1 and ships a CommonJS build, while this
 * project is ESM-only because `@nestjs/common@12` is (see jest.config). It runs
 * fine under Node 24, which can `require` ESM — and Jest's ESM runtime cannot
 * until Node 24.9, so three suites that boot the real application stopped
 * running. `express-rate-limit` ships both module formats and has no such
 * problem, and the policy reads better in one place than scattered across
 * decorators.
 *
 * The specific limits are deliberately generous. A shop refreshing its
 * appointments, a customer flicking through filters and a phone polling a
 * payment every four seconds must all sit far below them. This is a ceiling
 * against abuse, not a quota.
 */
function applyRateLimits(app: INestApplication): void {
  const logger = new Logger('RateLimit');

  // Not in tests. An e2e suite is one client making hundreds of requests in a
  // few seconds from one address, which is indistinguishable from the abuse
  // this exists to stop — and a suite that fails depending on how many tests ran
  // before it is worse than no suite. The limits are verified against a running
  // build instead, and the numbers below are unit-tested on their own.
  if (process.env.NODE_ENV === 'test') {
    logger.log('Rate limiting is off in tests.');
    return;
  }

  const limiter = (
    windowMs: number,
    limit: number,
    message: string,
  ): RateLimitRequestHandler =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { statusCode: 429, message, error: 'Too Many Requests' },
    });

  // Order matters: the narrow rules are mounted first, so a request to one of
  // these paths is measured against its own limit rather than the general one.

  /**
   * Sends an EMAIL to an address the caller chooses. The cooldown beside it is
   * per recipient, so it cannot see one machine walking a list — which costs the
   * platform its sending reputation, not just its bandwidth.
   */
  app.use(
    '/auth/otp/request',
    limiter(60_000, 5, 'Too many codes requested. Wait a minute and try again.'),
  );

  /**
   * A six-digit code is a million guesses. The service counts attempts per code;
   * this caps how fast anyone can work through codes for DIFFERENT addresses,
   * which per-code counting cannot see.
   */
  app.use(
    '/auth/otp/verify',
    limiter(60_000, 10, 'Too many attempts. Wait a minute and try again.'),
  );

  /**
   * Every call makes a prompt appear on somebody's handset and a request to MTN,
   * so a loop here is a real phone buzzing and a bill the platform pays.
   */
  app.use(
    /^\/appointments\/[^/]+\/initiate-deposit-payment$/,
    limiter(60_000, 10, 'Too many payment attempts. Wait a minute and try again.'),
  );

  /** Under §21.4's ten new threads a day, which counts relationships, not calls. */
  app.use(
    '/threads/inquiry',
    limiter(60_000, 20, 'Too many messages started. Wait a minute and try again.'),
  );

  /**
   * Everything else, and the number is high ON PURPOSE.
   *
   * Counting is by client IP, and in this market that is not one person. Mobile
   * carriers here put very large numbers of subscribers behind a handful of
   * addresses, and an office or a salon shares one too. A limit tuned to what a
   * single enthusiastic user could reach would cut off a whole neighbourhood the
   * moment a few of them used the app at once — a failure that looks exactly
   * like the platform being broken, and only for the busiest places.
   *
   * So the general ceiling catches a scraper rather than a keen customer, and
   * the narrow limits above are where the real protection sits: those endpoints
   * cost money or reach somebody's handset, and each is small enough to matter
   * even shared across a carrier's address.
   *
   * Two windows: the short one is what a person never notices and a script hits
   * at once, the long one catches the patient version that stays underneath it.
   */
  app.use(limiter(60_000, 600, 'Too many requests. Slow down and try again.'));
  app.use(limiter(3_600_000, 10_000, 'Too many requests. Try again later.'));

  // Counting is by client IP, so behind a proxy every request appears to come
  // from the proxy and ONE busy customer would rate-limit everybody. Express
  // needs telling how many hops to trust; getting this wrong in the other
  // direction lets a caller forge the header and escape the limit entirely.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (hops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', hops);
    logger.log(`Trusting ${hops} proxy hop(s) for client IP.`);
  }
}
