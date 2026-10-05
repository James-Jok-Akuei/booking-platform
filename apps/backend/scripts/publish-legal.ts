import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { LegalDocumentKind, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { LegalService } from '../src/legal/legal.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Publishes the legal texts kept in `prisma/legal/` (§141).
 *
 *   npm run legal:publish
 *
 * The texts live in the repository so they can be read, reviewed and changed
 * like anything else, and this puts them through the SAME path the admin screen
 * uses — a new draft, then publish — so a version is never edited in place and
 * everyone is asked to accept what changed (§122, §126).
 *
 * A document whose published text already matches its file is left alone, so
 * running this twice publishes nothing the second time.
 *
 * Refuses, in production, to publish a text that still has a [PLACEHOLDER] in
 * it: a privacy policy that names "[COMPANY LEGAL NAME]" as the controller is
 * not one anybody should be asked to accept.
 */
const DOCUMENTS: Array<{ kind: LegalDocumentKind; file: string; title: string }> = [
  { kind: LegalDocumentKind.TERMS_OF_USE, file: 'terms-of-use.txt', title: 'Terms of Use' },
  { kind: LegalDocumentKind.PRIVACY_POLICY, file: 'privacy-policy.txt', title: 'Privacy Policy' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const legal = app.get(LegalService);

    const admin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN, closedAt: null },
      orderBy: [{ isPrimaryAdmin: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, email: true },
    });
    if (!admin) throw new Error('There is no admin account to publish as.');

    for (const document of DOCUMENTS) {
      const body = readFileSync(join(__dirname, '..', 'prisma', 'legal', document.file), 'utf8').trim();

      const placeholders = body.match(/\[[A-Z][^\]]*\]/g) ?? [];
      if (process.env.NODE_ENV === 'production' && placeholders.length > 0) {
        throw new Error(
          `${document.file} still has ${placeholders.length} placeholder(s) to fill in, ` +
            `starting with ${placeholders[0]}. Not publishing it to production.`,
        );
      }

      const current = await prisma.legalDocument.findFirst({
        where: { kind: document.kind, publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        select: { body: true, version: true },
      });
      if (current?.body.trim() === body) {
        console.log(`${document.title}: v${current.version} already matches the file.`);
        continue;
      }

      const draft = await legal.startDraft(document.kind);
      await legal.updateDraft(draft.id, {
        title: document.title,
        body,
        changeNote: current
          ? 'Rewritten in full for Rwandan law: who we are, deposits and refunds, your data and your rights.'
          : 'First version.',
      });
      const published = await legal.publish(draft.id, admin.id);
      console.log(
        `${document.title}: published v${published.version} as ${admin.email}` +
          (placeholders.length > 0 ? ` (${placeholders.length} placeholders still to fill in)` : ''),
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`\nPublish failed:\n ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
