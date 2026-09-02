import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app-bootstrap';

async function bootstrap() {
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
