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
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  /**
   * Two classes with the same name are ONE schema (§128.7).
   *
   * OpenAPI schema names are global. A response class called `ServiceOfferDto`
   * beside a request class of the same name does not collide loudly — the
   * generator keeps one of them, silently, and the contract then describes the
   * wrong shape. It cost an hour: the business app stopped compiling against its
   * own services because the offer it was handed had no `isOffered`.
   *
   * Cannot be detected in the document itself, where the duplicate has already
   * collapsed to one entry, so this reads the source instead.
   */
  const duplicates = findDuplicateDtoNames(resolve(process.cwd(), 'src'));
  if (duplicates.length > 0) {
    throw new Error(
      `${duplicates.length} DTO class name(s) declared more than once:\n` +
        duplicates.map((d) => `  ${d.name}\n    ${d.files.join('\n    ')}`).join('\n') +
        '\n\nOpenAPI schema names are global, so only one of each survives into ' +
        'the contract and the other is silently discarded. Rename one.',
    );
  }


  /**
   * A response schema of `{"type": "object"}` and nothing else (§128.14).
   *
   * This is what the plugin emits for a handler it cannot infer: no `$ref`, no
   * properties, just the word "object". It is WORSE than an undescribed
   * response, because the contract now asserts something — and a client
   * deriving from it gets `Record<string, never>`, a type that permits no
   * field and explains nothing.
   *
   * The §60 guard above never saw these: it inspects `components.schemas`, and
   * these are inline on the operation, belonging to no named schema at all.
   * Twenty-three were found sitting in the contract the day this was written,
   * including `GET /users/me` — the endpoint whose missing `imageUrl` cost an
   * hour of §125, and which a described response would have shown immediately.
   *
   * A RATCHET, not a wall: the known ones are listed and the build fails on any
   * operation NOT on the list. The list may only shrink. Deleting the last
   * entry should be followed by deleting the list.
   */
  const KNOWN_HOLLOW_RESPONSES = new Set([
  'GET /business/locations/{id}/schedule-exceptions',
  'GET /business/locations/{id}/time-blocks',
  'GET /business/payout-destination',
  'GET /categories',
  'GET /locations/{id}/availability',
  'GET /places/provinces',
  'PATCH /admin/payout-destinations/{id}/reject',
  'PATCH /admin/payout-destinations/{id}/verify',
  'PATCH /admin/reviews/{id}/hide',
  'PATCH /admin/reviews/{id}/unhide',
  'PATCH /reviews/{id}',
  'PATCH /reviews/{id}/response',
  'POST /appointments/{id}/reviews',
  'POST /auth/otp/verify',
  'POST /auth/refresh',
  'POST /business/locations/{id}/schedule-exceptions',
  'POST /business/locations/{id}/time-blocks',
  'POST /business/payout-destination',
  'POST /reviews/{id}/response',
  ]);

  const isHollow = (schema: unknown): boolean => {
    if (typeof schema !== 'object' || schema === null) return false;
    const s = schema as Record<string, unknown>;
    if (s.type === 'array') return isHollow(s.items);
    if (s.$ref || s.allOf || s.oneOf || s.anyOf) return false;
    const hasProperties =
      Object.keys((s.properties as object) ?? {}).length > 0;
    return !hasProperties && (s.type === undefined || s.type === 'object');
  };

  const hollow: string[] = [];
  const fixed = new Set(KNOWN_HOLLOW_RESPONSES);

  for (const [path, item] of Object.entries(document.paths)) {
    for (const [verb, operation] of Object.entries(item as object)) {
      if (!['get', 'post', 'patch', 'put', 'delete'].includes(verb)) continue;
      const responses = (operation as { responses?: Record<string, unknown> })
        .responses ?? {};
      for (const [status, response] of Object.entries(responses)) {
        if (!status.startsWith('2')) continue;
        const schema = (
          response as { content?: { 'application/json'?: { schema?: unknown } } }
        ).content?.['application/json']?.schema;
        if (schema === undefined || !isHollow(schema)) continue;
        const id = `${verb.toUpperCase()} ${path}`;
        fixed.delete(id);
        if (!KNOWN_HOLLOW_RESPONSES.has(id)) hollow.push(id);
      }
    }
  }

  if (hollow.length > 0) {
    throw new Error(
      `${hollow.length} response(s) describe themselves as a bare object:\n` +
        hollow.map((h) => `  ${h}`).join('\n') +
        '\n\nThat is not an undescribed response — it is a WRONG one. A client ' +
        'generated from it receives `Record<string, never>`.\n' +
        'Give the handler an @ApiOkResponse({ type: SomeDto }), or add it to ' +
        'KNOWN_HOLLOW_RESPONSES in this file if it genuinely cannot be described ' +
        'yet. The list may only shrink.',
    );
  }

  if (fixed.size > 0) {
    throw new Error(
      `${fixed.size} entr(ies) in KNOWN_HOLLOW_RESPONSES now describe themselves ` +
        `properly:\n${[...fixed].map((f) => `  ${f}`).join('\n')}\n\n` +
        'Remove them from the list in this file. A stale allowlist is how a ' +
        'ratchet stops ratcheting.',
    );
  }


  /**
   * A POST documented as 200 that actually answers 201 (§128.26).
   *
   * Nest answers a POST with 201 unless `@HttpCode` says otherwise, but
   * `@ApiOkResponse` writes a 200 into the contract and the 201 disappears
   * from it. The generated client then has a type for a status the server never
   * sends, and none for the status it does — so the response reads as `undefined`
   * at the call site, for a reason nothing in the client explains.
   *
   * Eight routes had it before this guard existed, one of them since the first
   * §128 commit. It cannot be seen in the finished document — a 200 entry looks
   * exactly like a deliberate one — so this reads the source, as the duplicate
   * guard above does.
   */
  const wrongCreated = findPostsDocumentedAsOk(resolve(process.cwd(), 'src'));
  if (wrongCreated.length > 0) {
    throw new Error(
      `${wrongCreated.length} POST route(s) use @ApiOkResponse but answer 201:\n` +
        wrongCreated.map((r) => `  ${r.file}  ${r.route}`).join('\n') +
        '\n\nUse @ApiCreatedResponse, or add @HttpCode(HttpStatus.OK) if the ' +
        'route really does answer 200. As written, the contract documents a ' +
        'status the server never sends.',
    );
  }


  /**
   * Two response decorators on one route (§128.27).
   *
   * Annotating a route that was already annotated is easy to do and invisible
   * afterwards: the generator keeps one and discards the other, exactly as it
   * does for duplicate schema names (§128.7). Six routes picked up a second
   * decorator while this module was being described, and one pair disagreed
   * — `isArray: true` against `type: [Dto]` — so which one survived decided
   * whether the contract said "a location" or "a list of locations".
   */
  const doubled = findDoubledResponseDecorators(resolve(process.cwd(), 'src'));
  if (doubled.length > 0) {
    throw new Error(
      `${doubled.length} route(s) carry two response decorators:\n` +
        doubled.map((d) => `  ${d.file}:${d.line}\n    ${d.first}\n    ${d.second}`).join('\n') +
        '\n\nOnly one survives into the contract, and nothing says which. ' +
        'Delete the one you do not want.',
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


/** Every `export class …Dto` under a directory, grouped by name. */
function findDuplicateDtoNames(root: string): Array<{ name: string; files: string[] }> {
  const byName = new Map<string, string[]>();

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.ts') || full.endsWith('.spec.ts')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/^export class (\w*Dto)\b/gm)) {
        const files = byName.get(match[1]) ?? [];
        files.push(full.replace(`${root}/`, 'src/'));
        byName.set(match[1], files);
      }
    }
  };
  walk(root);

  return [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => ({ name, files }));
}

/**
 * Every `@Post` whose decorator run has `@ApiOkResponse` but no `@HttpCode`
 * setting 200 — i.e. documented as 200 while Nest answers 201 (§128.26).
 */
function findPostsDocumentedAsOk(
  root: string,
): Array<{ file: string; route: string }> {
  const found: Array<{ file: string; route: string }> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.controller.ts')) continue;
      const lines = readFileSync(full, 'utf8').split('\n');

      for (let i = 0; i < lines.length; i += 1) {
        const post = /^\s*@Post\(([^)]*)\)/.exec(lines[i]);
        if (!post) continue;

        // The decorator run: upwards over decorators and comments, downwards
        // to the method signature. @HttpCode may sit on either side of @Post.
        let start = i;
        while (start > 0) {
          const line = lines[start - 1].trim();
          if (
            line.startsWith('@') ||
            line.startsWith('*') ||
            line.startsWith('/*') ||
            line.startsWith('//') ||
            line === ''
          ) {
            start -= 1;
          } else break;
        }
        let end = i;
        while (end < lines.length - 1) {
          const line = lines[end].trim();
          if (end > i && !line.startsWith('@') && /\w+\s*\(/.test(line)) break;
          end += 1;
        }

        const block = lines.slice(start, end + 1).join('\n');
        if (
          block.includes('@ApiOkResponse') &&
          !block.includes('HttpStatus.OK') &&
          !block.includes('HttpCode(200)')
        ) {
          found.push({
            file: full.replace(`${root}/`, 'src/'),
            route: `@Post(${post[1]})`,
          });
        }
      }
    }
  };
  walk(root);

  return found;
}

/** Adjacent @ApiOkResponse / @ApiCreatedResponse decorators on one route (§128.27). */
function findDoubledResponseDecorators(
  root: string,
): Array<{ file: string; line: number; first: string; second: string }> {
  const found: Array<{ file: string; line: number; first: string; second: string }> = [];
  const isResponse = (line: string) =>
    line.startsWith('@ApiOkResponse') || line.startsWith('@ApiCreatedResponse');

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.controller.ts')) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      for (let i = 0; i < lines.length - 1; i += 1) {
        const first = lines[i].trim();
        const second = lines[i + 1].trim();
        if (isResponse(first) && isResponse(second)) {
          found.push({
            file: full.replace(`${root}/`, 'src/'),
            line: i + 1,
            first,
            second,
          });
        }
      }
    }
  };
  walk(root);

  return found;
}
