import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app-bootstrap';
import { assertProductionReady } from './common/production-readiness';

async function bootstrap() {
  // Before the application is built, so a bad production configuration fails
  // here rather than inside the first request that depends on it (§116.3).
  assertProductionReady();

  const app = await NestFactory.create(AppModule);

  // Shared with the boot smoke test, so the test cannot pass against a
  // configuration this file no longer uses.
  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
}
bootstrap();
