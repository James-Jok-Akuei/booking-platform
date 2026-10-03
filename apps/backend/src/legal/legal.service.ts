import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LegalDocumentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What the apps read. A draft is nobody's business but the admin's. */
const PUBLIC_SELECT = {
  id: true,
  kind: true,
  version: true,
  title: true,
  body: true,
  publishedAt: true,
  changeNote: true,
} as const;

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
  async published() {
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
    return [...current.values()];
  }

  async currentOf(kind: LegalDocumentKind) {
    const document = await this.prisma.legalDocument.findFirst({
      where: { kind, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: PUBLIC_SELECT,
    });
    if (!document) {
      throw new NotFoundException('That document has not been published yet.');
    }
    return document;
  }

  /**
   * What this person has agreed to, and whether it is still current (§122.3).
   *
   * Returns a row per published document so a screen can render the whole list
   * in one pass — "accepted", "not yet", or "accepted an older version" — rather
   * than asking per document and getting three answers at three moments.
   */
  async statusFor(userId: string) {
    const [documents, acceptances] = await Promise.all([
      this.published(),
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

  /** Records agreement to one exact version. Agreeing twice is agreeing once. */
  async accept(userId: string, documentId: string) {
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
      create: { userId, documentId },
      update: {},
    });
    return { documentId, kind: document.kind, version: document.version };
  }

  // ---------- Admin ----------

  /** Every version of everything, newest first. Drafts included. */
  async listForAdmin() {
    return this.prisma.legalDocument.findMany({
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      select: {
        ...PUBLIC_SELECT,
        createdAt: true,
        updatedAt: true,
        publishedBy: { select: { id: true, email: true } },
        _count: { select: { acceptances: true } },
      },
    });
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
    return published;
  }
}

/** Used only when a kind has never been written before. */
const DEFAULT_TITLES: Record<LegalDocumentKind, string> = {
  TERMS_OF_USE: 'Terms of Use',
  PRIVACY_POLICY: 'Privacy Policy',
  SELLER_AGREEMENT: 'Seller Agreement',
};
