import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-bootstrap';

/**
 * Proves the application actually starts.
 *
 * This exists because a DI cycle shipped in §23 that hung the app at boot —
 * before route mapping, with no error — while 118 tests passed. The suites all
 * build targeted provider modules and never touch AppModule, so every one of
 * them was green against a binary that could not start (§24.8).
 *
 * Two things make this test do its job:
 *
 * - It boots the WHOLE AppModule through NestFactory and applies the same
 *   `configureApp` main.ts does, so a global pipe added there is exercised
 *   here. Assembling a trimmed module would reproduce the bug, not catch it.
 * - It has a TIGHT explicit timeout. The failure being guarded against is a
 *   HANG, not a thrown error, so a test that waits patiently is worthless. This
 *   one fails within 25 seconds — well inside a CI step, and unmistakable.
 */
describe('Application boot', () => {
  let app: INestApplication | undefined;

  afterAll(async () => {
    await app?.close();
  });

  it(
    'builds AppModule, listens, serves HTTP, and shuts down',
    async () => {
      // Port 0 asks the OS for a free port, so the test never collides with a
      // dev server on 4100 or with a parallel run.
      app = configureApp(await NestFactory.create(AppModule, { logger: false }));
      await app.init();
      await app.listen(0);

      const url = await app.getUrl();
      expect(url).toMatch(/^http:\/\//);

      // An unknown route is the cheapest possible proof that the HTTP pipeline
      // is alive: reaching a 404 means the server bound, the router resolved,
      // and the exception layer rendered a response.
      const response = await fetch(`${url.replace('[::1]', '127.0.0.1')}/__does_not_exist__`);
      expect(response.status).toBe(404);

      const body = (await response.json()) as { statusCode?: number };
      expect(body.statusCode).toBe(404);

      await app.close();
      app = undefined;
    },
    25_000,
  );
});
