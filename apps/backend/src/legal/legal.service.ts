import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LegalDocumentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { readTyped, type TypedWords } from '../i18n/typed-words';

/** The refusal a screen answers by showing the document to accept (§280). */
export const AGREEMENT_REQUIRED = 'AGREEMENT_REQUIRED';

/** What the apps read. A draft is nobody's business but the admin's. */
const PUBLIC_SELECT = {
  id: true,
  kind: true,
  version: true,
  title: true,
  body: true,
  publishedAt: true,
  changeNote: true,
  translations: true,
} as const;

/** What a translation of a version holds (§308.5). */
export const LEGAL_WORDS = ['title', 'body', 'changeNote'] as const;
export type LegalTranslations = TypedWords<(typeof LEGAL_WORDS)[number]>;

type PublicRow = Prisma.LegalDocumentGetPayload<{ select: typeof PUBLIC_SELECT }>;

/**
 * A version as the reader reads it (§308.5): in their language where it has
 * been translated — the whole text, never a mix — else in English, and
 * `language` says which. The English applies where they differ.
 */
export function inLanguage({ translations, ...row }: PublicRow, locale: Locale) {
  const typed = locale === 'en' ? undefined : readTyped(translations, LEGAL_WORDS)[locale];
  if (!typed?.body) return { ...row, language: DEFAULT_LOCALE as Locale };
  return {
    ...row,
    title: typed.title ?? row.title,
    body: typed.body,
    changeNote: row.changeNote === null ? null : (typed.changeNote ?? row.changeNote),
    language: locale,
  };
}

@Injectable()
export class LegalService {
  private readonly logger = new Logger(LegalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The current version of every published document (§122).
   *
   * Anonymous: somebody deciding whether to sign up has to be able to read the
   * terms first, and asking them to agree before they can read is the thing
   * everybody complains about.
   */
  async published(locale: Locale = DEFAULT_LOCALE) {
    const rows = await this.prisma.legalDocument.findMany({
      where: { publishedAt: { not: null } },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      select: PUBLIC_SELECT,
    });

    // The highest published version of each kind. Done here rather than with a
    // `distinct` so the ordering that picks the winner is visible.
    const current = new Map<LegalDocumentKind, (typeof rows)[number]>();
    for (const row of rows) {
      if (!current.has(row.kind)) current.set(row.kind, row);
    }
    return [...current.values()].map((row) => inLanguage(row, locale));
  }

  async currentOf(kind: LegalDocumentKind, locale: Locale = DEFAULT_LOCALE) {
    const document = await this.prisma.legalDocument.findFirst({
      where: { kind, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: PUBLIC_SELECT,
    });
    if (!document) {
      throw new NotFoundException('That document has not been published yet.');
    }
    return inLanguage(document, locale);
  }

  /**
   * What this person has agreed to, and whether it is still current (§122.3).
   *
   * Returns a row per published document so a screen can render the whole list
   * in one pass — "accepted", "not yet", or "accepted an older version" — rather
   * than asking per document and getting three answers at three moments.
   */
  async statusFor(userId: string, locale: Locale = DEFAULT_LOCALE) {
    const [documents, acceptances] = await Promise.all([
      this.published(locale),
      this.prisma.legalAcceptance.findMany({
        where: { userId },
        select: { documentId: true, acceptedAt: true, document: { select: { kind: true, version: true } } },
      }),
    ]);

    const byKind = new Map<LegalDocumentKind, { version: number; acceptedAt: Date }>();
    for (const row of acceptances) {
      const seen = byKind.get(row.document.kind);
      // The HIGHEST version they ever accepted, not the most recent acceptance:
      // they are different whenever somebody reads an old version afterwards.
      if (!seen || row.document.version > seen.version) {
        byKind.set(row.document.kind, {
          version: row.document.version,
          acceptedAt: row.acceptedAt,
        });
      }
    }

    return documents.map((document) => {
      const accepted = byKind.get(document.kind);
      return {
        ...document,
        acceptedVersion: accepted?.version ?? null,
        acceptedAt: accepted?.acceptedAt ?? null,
        /** True when they have never agreed, or agreed to something older. */
        needsAcceptance: (accepted?.version ?? 0) < document.version,
      };
    });
  }

  /**
   * Refuses an action until a document has been agreed to (§126).
   *
   * Used where consent is the point rather than a formality — putting a service
   * in front of customers is the business holding itself to the Seller
   * Agreement, so doing it while that agreement is unread is the one case worth
   * stopping outright.
   *
   * Enforced on the SERVER, not only in the screen. A gate that lives in a
   * client is a suggestion: the API is reachable with curl, and the record of
   * who agreed to what is the only thing that makes any of this mean anything.
   *
   * Nothing published yet means nothing to agree to, and refusing then would
   * lock a business out of its own catalogue over a document that does not
   * exist.
   */
  async requireAccepted(userId: string, kind: LegalDocumentKind) {
    const current = await this.prisma.legalDocument.findFirst({
      where: { kind, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: { id: true, title: true, version: true },
    });
    if (!current) return;

    const accepted = await this.prisma.legalAcceptance.findUnique({
      where: { userId_documentId: { userId, documentId: current.id } },
      select: { id: true },
    });
    if (accepted) return;

    // `code` lets a screen answer by showing the document where the person is,
    // rather than leaving them to find the Legal page (§280).
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: AGREEMENT_REQUIRED,
      message: `Please read and accept the ${current.title} (version ${current.version}) first. It is on the Legal page.`,
    });
  }

  /**
   * Accepts every published document, for an account being created (§126.1).
   *
   * The Seller Agreement included: a business registering is agreeing to the
   * terms it will trade under, and asking for it separately a moment later would
   * be asking twice for one decision.
   */
  async acceptCurrentAtRegistration(userId: string) {
    const documents = await this.published();
    if (documents.length === 0) return;
    await this.prisma.legalAcceptance.createMany({
      data: documents.map((document) => ({ userId, documentId: document.id })),
      // A retried verify must not fail on a row that is already there.
      skipDuplicates: true,
    });
  }

  /**
   * Records agreement to one exact version. Agreeing twice is agreeing once.
   * `language` is the one they read it in, kept with the agreement (§308.5).
   */
  async accept(userId: string, documentId: string, language?: Locale) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: { id: true, publishedAt: true, kind: true, version: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (!document.publishedAt) {
      // Agreeing to a draft would record consent to words that are still being
      // written, and the draft is editable precisely because nobody has.
      throw new BadRequestException('That version has not been published.');
    }

    await this.prisma.legalAcceptance.upsert({
      where: { userId_documentId: { userId, documentId } },
      create: { userId, documentId, language: language ?? null },
      update: {},
    });
    return { documentId, kind: document.kind, version: document.version };
  }

  // ---------- Admin ----------

  /** Every version of everything, newest first. Drafts included, and each one's translations. */
  async listForAdmin() {
    const rows = await this.prisma.legalDocument.findMany({
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      select: {
        ...PUBLIC_SELECT,
        createdAt: true,
        updatedAt: true,
        publishedBy: { select: { id: true, email: true } },
        _count: { select: { acceptances: true } },
      },
    });
    return rows.map((row) => ({ ...row, translations: readTyped(row.translations, LEGAL_WORDS) }));
  }

  /**
   * A version's Kinyarwanda and French (§308.5), as the console's boxes hold
   * them now — a language emptied is a language removed.
   *
   * Allowed on a published version too, which its English never is: the
   * English applies where they differ (the user's decision, 2026-10-21), so a
   * translation added or corrected later changes nothing anybody agreed to,
   * and nobody is asked to agree again.
   */
  async setTranslations(id: string, translations: unknown, adminId: string) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id },
      select: { id: true, kind: true, version: true, publishedAt: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    const words = readTyped(translations, LEGAL_WORDS);
    await this.prisma.legalDocument.update({ where: { id }, data: { translations: words } });
    this.logger.log(
      `${document.kind} v${document.version}${document.publishedAt ? '' : ' (draft)'} translations set by ${adminId}: ` +
        (Object.keys(words).join(', ') || 'none'),
    );
    return { translations: words };
  }

  /**
   * Starts the next version of a document, or returns the draft already going.
   *
   * The new draft is seeded with the current published text, because a new
   * version is almost always an edit of the last one and retyping four thousand
   * words to change a sentence is how mistakes get in.
   */
  async startDraft(kind: LegalDocumentKind) {
    const existing = await this.prisma.legalDocument.findFirst({
      where: { kind, publishedAt: null },
    });
    if (existing) return existing;

    const latest = await this.prisma.legalDocument.findFirst({
      where: { kind },
      orderBy: { version: 'desc' },
      select: { version: true, title: true, body: true },
    });

    try {
      return await this.prisma.legalDocument.create({
        data: {
          kind,
          version: (latest?.version ?? 0) + 1,
          title: latest?.title ?? DEFAULT_TITLES[kind],
          body: latest?.body ?? '',
        },
      });
    } catch (error) {
      // Two admins pressing "new version" together both pass the read above;
      // the partial unique index is what stops the loser's work vanishing into
      // a second draft nobody would find.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.legalDocument.findFirstOrThrow({
          where: { kind, publishedAt: null },
        });
      }
      throw error;
    }
  }

  /** Edits a draft. A published version is never edited — see `startDraft`. */
  async updateDraft(
    id: string,
    data: { title?: string; body?: string; changeNote?: string },
  ) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id },
      select: { id: true, publishedAt: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (document.publishedAt) {
      throw new BadRequestException(
        'A published version cannot be edited. Start a new version instead — ' +
          'what people agreed to has to stay as they read it.',
      );
    }
    return this.prisma.legalDocument.update({ where: { id }, data });
  }

  /** Publishes a draft. From here it is read-only, forever. */
  async publish(id: string, adminId: string) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id },
      select: { id: true, publishedAt: true, body: true, kind: true, version: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (document.publishedAt) {
      throw new BadRequestException('That version is already published.');
    }
    if (document.body.trim().length === 0) {
      throw new BadRequestException('There is nothing written to publish.');
    }

    const published = await this.prisma.legalDocument.update({
      where: { id },
      data: { publishedAt: new Date(), publishedById: adminId },
      select: PUBLIC_SELECT,
    });
    this.logger.log(
      `${document.kind} v${document.version} published by ${adminId}.`,
    );
    return inLanguage(published, DEFAULT_LOCALE);
  }
}

/** Used only when a kind has never been written before. */
const DEFAULT_TITLES: Record<LegalDocumentKind, string> = {
  TERMS_OF_USE: 'Terms of Use',
  PRIVACY_POLICY: 'Privacy Policy',
  SELLER_AGREEMENT: 'Seller Agreement',
};
