import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties from incoming DTOs
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors(); // tighten this to the app origins before production

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
