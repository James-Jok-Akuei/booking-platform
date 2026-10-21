import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { LegalDocumentKind, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { LEGAL_WORDS, LegalService, type LegalTranslations } from '../src/legal/legal.service';
import { readTyped, type TypedLanguage } from '../src/i18n/typed-words';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Publishes the legal texts kept in `prisma/legal/` (§141).
 *
 *   npm run legal:publish -- "What changed, in a sentence a customer will read."
 *
 * The sentence is shown to everyone asked to accept the new version (§126), so
 * it is required whenever there is an earlier one (§172) — it used to be fixed
 * to "Rewritten in full…", true once and wrong for every update after.
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
 *
 * The Kinyarwanda and French (§308.7) live beside the English as
 * `terms-of-use.rw.txt` and so on, and are put on the current version as its
 * translations — the English applies where they differ, so nobody is asked to
 * agree again (§308.5). `translations.json` holds, per document, a fingerprint
 * of the English each translation was made from: once the English changes, a
 * translation made from the old text is left off the new version (readers get
 * the English) until it is updated and its fingerprint renewed with
 *
 *   npm run legal:publish -- --translated
 */
const DOCUMENTS: Array<{ kind: LegalDocumentKind; name: string; title: string; titles: Record<TypedLanguage, string> }> = [
  {
    kind: LegalDocumentKind.TERMS_OF_USE,
    name: 'terms-of-use',
    title: 'Terms of Use',
    titles: { rw: 'Amabwiriza y’Imikoreshereze', fr: 'Conditions d’utilisation' },
  },
  {
    kind: LegalDocumentKind.PRIVACY_POLICY,
    name: 'privacy-policy',
    title: 'Privacy Policy',
    titles: { rw: 'Politiki y’Ibanga', fr: 'Politique de confidentialité' },
  },
  // Written in full on 2026-10-12 (§275); until then only the console's stub.
  {
    kind: LegalDocumentKind.SELLER_AGREEMENT,
    name: 'seller-agreement',
    title: 'Seller Agreement',
    titles: { rw: 'Amasezerano y’Umucuruzi', fr: 'Contrat commerçant' },
  },
];

const LANGUAGES: TypedLanguage[] = ['rw', 'fr'];
const folder = join(__dirname, '..', 'prisma', 'legal');
const read = (file: string) => readFileSync(join(folder, file), 'utf8').trim();
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const headings = (text: string) => text.split('\n').filter((line) => /^\d+\.\d*\s/.test(line)).map((line) => line.split(/\s/)[0]);

/** Per document: the English it was translated from, and the change note in each language. */
type Ledger = Record<string, { translatedFrom: string; changeNote?: Partial<Record<TypedLanguage, string>> }>;
const LEDGER = join(folder, 'translations.json');

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--translated') return markTranslated();
  const changeNote = args.join(' ').trim();
  const ledger: Ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
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
      const file = `${document.name}.txt`;
      const body = read(file);

      const placeholders = body.match(/\[[A-Z][^\]]*\]/g) ?? [];
      if (process.env.NODE_ENV === 'production' && placeholders.length > 0) {
        throw new Error(
          `${file} still has ${placeholders.length} placeholder(s) to fill in, ` +
            `starting with ${placeholders[0]}. Not publishing it to production.`,
        );
      }

      const current = await prisma.legalDocument.findFirst({
        where: { kind: document.kind, publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        select: { id: true, body: true, version: true, translations: true },
      });
      if (current?.body.trim() === body) {
        console.log(`${document.title}: v${current.version} already matches the file.`);
        await translate(legal, document, current, body, ledger, admin.id);
        continue;
      }

      if (current && !changeNote) {
        throw new Error(
          `${document.title} has changed since v${current.version}. Say what changed, in a ` +
            'sentence the customer will read: npm run legal:publish -- "…"',
        );
      }

      // A draft somebody is writing in the console is theirs: never written over.
      const open = await prisma.legalDocument.findFirst({
        where: { kind: document.kind, publishedAt: null },
        select: { version: true, body: true },
      });
      if (open && open.body.trim() !== (current?.body.trim() ?? '') && open.body.trim() !== body) {
        throw new Error(
          `${document.title} v${open.version} is a draft being written in the console. ` +
            'Publish or discard it there first, so this does not write over it.',
        );
      }

      const draft = await legal.startDraft(document.kind);
      await legal.updateDraft(draft.id, {
        title: document.title,
        body,
        changeNote: current ? changeNote : 'First version.',
      });
      const published = await legal.publish(draft.id, admin.id);
      console.log(
        `${document.title}: published v${published.version} as ${admin.email}` +
          (placeholders.length > 0 ? ` (${placeholders.length} placeholders still to fill in)` : ''),
      );
      await translate(legal, document, { ...published, translations: null }, body, ledger, admin.id);
    }
  } finally {
    await app.close();
  }
}

/** Puts the Kinyarwanda and French files on the version, when they were made from this English. */
async function translate(
  legal: LegalService,
  document: (typeof DOCUMENTS)[number],
  version: { id: string; version: number; translations: unknown },
  english: string,
  ledger: Ledger,
  adminId: string,
) {
  const entry = ledger[document.name];
  const present = LANGUAGES.filter((l) => existsSync(join(folder, `${document.name}.${l}.txt`)));
  if (!present.length) return;
  if (entry?.translatedFrom !== fingerprint(english)) {
    console.log(
      `${document.title}: the English changed since it was translated — v${version.version} is shown in English ` +
        'until the translations are updated (then: npm run legal:publish -- --translated).',
    );
    return;
  }
  const words: LegalTranslations = {};
  for (const l of present) {
    const body = read(`${document.name}.${l}.txt`);
    if (headings(body).join() !== headings(english).join()) {
      throw new Error(`${document.name}.${l}.txt does not have the same sections and clauses as the English.`);
    }
    words[l] = { title: document.titles[l], body, ...(entry.changeNote?.[l] ? { changeNote: entry.changeNote[l] } : {}) };
  }
  if (JSON.stringify(readTyped(version.translations, LEGAL_WORDS)) === JSON.stringify(readTyped(words, LEGAL_WORDS))) return;
  await legal.setTranslations(version.id, words, adminId);
  console.log(`${document.title}: v${version.version} now reads in ${present.join(' and ')} too.`);
}

/** After the translators finish: records which English each translation was made from. */
function markTranslated() {
  const ledger: Ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
  for (const document of DOCUMENTS) {
    if (!LANGUAGES.some((l) => existsSync(join(folder, `${document.name}.${l}.txt`)))) continue;
    ledger[document.name] = { ...ledger[document.name], translatedFrom: fingerprint(read(`${document.name}.txt`)) };
  }
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log('Marked: the translations beside the English are up to date with it. Now run npm run legal:publish.');
}

main().catch((error) => {
  console.error(`\nPublish failed:\n ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
