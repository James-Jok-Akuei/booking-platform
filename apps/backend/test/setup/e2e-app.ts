import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app-bootstrap';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Base URL of the listening server, e.g. http://127.0.0.1:54321 */
  url: string;
  /**
   * Mints a real access token, bypassing the OTP flow but not the guards. It
   * reads as a sign-in that just happened (§279); `signedInMinutesAgo` makes it
   * an older one, for the changes that need a recent code.
   */
  token(userId: string, email: string, role: string, signedInMinutesAgo?: number): string;
  /** A correctly signed token that has already expired. */
  expiredToken(userId: string, email: string, role: string): string;
  close(): Promise<void>;
}

/**
 * Boots the real application and listens, for tests that need the HTTP layer.
 *
 * The service-level suites deliberately assemble targeted provider modules
 * (§23.3), which means they never exercise guards, global pipes or the
 * exception filter. This harness exists for the tests that must: it goes
 * through NestFactory and `configureApp`, exactly as main.ts does, so a request
 * here traverses the same chain a real client's does.
 *
 * Cron jobs are stopped once listening. They are irrelevant to authorization
 * and would otherwise mutate fixtures underneath assertions; the boot smoke
 * test (§26) is the one that leaves the real schedule running.
 */
export async function createE2eApp(): Promise<E2eContext> {
  const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  await app.init();
  // Ephemeral port: never collides with a dev server or a parallel run.
  await app.listen(0);

  const registry = app.get(SchedulerRegistry);
  for (const [, job] of registry.getCronJobs()) job.stop();

  const jwt = app.get(JwtService);
  const config = app.get(ConfigService);
  const secret = config.get<string>('JWT_ACCESS_SECRET');

  // Nest reports an IPv6 host on some machines; requests go to a literal.
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  return {
    app,
    prisma: app.get(PrismaService),
    url,
    token: (userId, email, role, signedInMinutesAgo = 0) =>
      jwt.sign(
        { sub: userId, email, role, auth_time: Math.floor(Date.now() / 1000) - signedInMinutesAgo * 60 },
        { secret, expiresIn: '1h' },
      ),
    expiredToken: (userId, email, role) =>
      jwt.sign({ sub: userId, email, role }, { secret, expiresIn: '-1h' }),
    close: async () => {
      await app.close();
    },
  };
}

/** Minimal HTTP helper — status is what these tests assert on. */
export async function request(
  url: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...options.headers,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Some responses have no body; status is what matters here.
  }
  return { status: response.status, body };
}
