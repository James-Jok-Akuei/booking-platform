/**
 * Writes the API contract to a file, for generating typed clients (§60).
 *
 *   npm run openapi:generate
 *
 * The Customer (React Native), Business and Admin apps are all built against
 * this backend. Each generating its own types by hand is how three clients end
 * up disagreeing with the server and with each other — the §56 rename touched
 * eleven money fields, and a hand-written client would have kept sending the
 * old names until somebody noticed a payment was wrong.
 *
 * Emitted to a FILE rather than read from the live `/docs` endpoint, so a build
 * does not need a running server or a database, and so the contract a client
 * was built against is committed alongside it and visible in a diff.
 *
 * ## Why this lives under src/ and runs from dist/
 *
 * The property types come from the `@nestjs/swagger` CLI plugin, which reads
 * the DTOs' TypeScript types at COMPILE time. Running this through `ts-node`
 * skips the plugin entirely and emits 43 schemas with no properties — a
 * contract that generates and is useless, which is worse than none, because it
 * looks finished. So it is compiled by `nest build` like the rest of `src` and
 * executed from `dist`.
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';

const OUTPUT = resolve(process.cwd(), '../../docs/openapi.json');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Booking platform API')
    .setDescription(
      'One backend serving the Customer, Business and Admin apps (§4). ' +
        'Money amounts are integer MINOR UNITS of the currency named beside them.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const schemaEntries = Object.entries(document.components?.schemas ?? {});

  // A schema with no properties is the signature of the plugin not having run,
  // or of a DTO built with @nestjs/mapped-types' PartialType instead of
  // @nestjs/swagger's. Both produce a contract that GENERATES CLEANLY and
  // describes nothing — a client built from it cannot send a single field.
  //
  // Refusing here is the whole point: that failure is silent everywhere else,
  // and it is discovered by whoever is building the client, days later, against
  // types that are empty for no visible reason.
  const empty = schemaEntries
    .filter(([, schema]) => Object.keys((schema as { properties?: object }).properties ?? {}).length === 0)
    .map(([name]) => name);

  if (empty.length > 0) {
    throw new Error(
      `${empty.length} schema(s) have no properties: ${empty.join(', ')}.\n` +
        'Usually one of two causes:\n' +
        '  1. the @nestjs/swagger CLI plugin did not run — this must be built by ' +
        '`nest build` and run from dist/, never through ts-node;\n' +
        "  2. a DTO extends @nestjs/mapped-types' PartialType/PickType instead of " +
        "@nestjs/swagger's, which carries no property metadata.",
    );
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);

  const paths = Object.keys(document.paths).length;
  const schemas = schemaEntries.length;

  // eslint-disable-next-line no-console
  console.log(`\nWrote ${OUTPUT}\n  ${paths} paths, ${schemas} schemas\n`);

  await app.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('\nOpenAPI generation failed:\n', error);
  process.exit(1);
});
