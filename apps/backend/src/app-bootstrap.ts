import { INestApplication, ValidationPipe } from '@nestjs/common';

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

  app.enableCors(); // tighten this to your PWA's origin(s) before production

  return app;
}
