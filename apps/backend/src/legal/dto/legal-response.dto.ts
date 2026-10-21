import { LegalDocumentKind } from '@prisma/client';

/**
 * A published document, as anybody may read it (§122).
 *
 * Drafts never appear here. The service selects these fields and nothing else,
 * so `publishedAt` is non-null by construction — a row without it is not
 * published and is not returned.
 */
export class LegalDocumentDto {
  id!: string;
  kind!: LegalDocumentKind;
  /** 1, 2, 3 … per kind. The number people quote at each other. */
  version!: number;
  title!: string;
  /** Plain text, blank lines between paragraphs. Never HTML (§122.4). */
  body!: string;
  publishedAt!: string;
  /** One line on what moved, so nobody rereads four thousand words (§122.3). */
  changeNote!: string | null;
  /**
   * The language the title and text are in (§308.5): the reader's where this
   * version has been translated, else English. Where a translation and the
   * English differ, the English applies — the apps say so beside it.
   */
  language!: 'en' | 'rw' | 'fr';
}

/** The same, plus what this person has agreed to. */
export class LegalStatusDto extends LegalDocumentDto {
  /** The HIGHEST version they ever agreed to, not the most recent tap (§122.3). */
  acceptedVersion!: number | null;
  acceptedAt!: string | null;
  /** True when they never agreed, or agreed to something older. */
  needsAcceptance!: boolean;
}

/** What accepting answers with. */
export class LegalAcceptanceDto {
  documentId!: string;
  kind!: LegalDocumentKind;
  version!: number;
}

// ---------------------------------------------------------------------------
// The admin side (§128.35)
// ---------------------------------------------------------------------------

export class LegalPublisherDto {
  id!: string;
  email!: string;
}

export class LegalAcceptanceCountDto {
  acceptances!: number;
}

/**
 * Every version of every document, draft and published, newest first per kind.
 *
 * `publishedAt` null means DRAFT — the one state in which the body may still be
 * edited. Once published it is frozen: what people agreed to has to stay as
 * they read it, so a correction is a new version, never an edit (§122.3).
 */
/** One version in one other language, as typed in the console (§308.5). */
export class LegalWordsResponseDto {
  title?: string;
  body?: string;
  changeNote?: string;
}

export class LegalTranslationsResponseDto {
  rw?: LegalWordsResponseDto;
  fr?: LegalWordsResponseDto;
}

/** What setting a version's translations answers with. */
export class LegalTranslationsSetDto {
  translations!: LegalTranslationsResponseDto;
}

export class AdminLegalDocumentDto {
  id!: string;
  kind!: LegalDocumentKind;
  version!: number;
  title!: string;
  body!: string;
  /** Null while it is a draft. */
  publishedAt!: string | null;
  /** What changed, shown to people being asked to accept again. */
  changeNote!: string | null;
  /** This version in Kinyarwanda and French, where translated (§308.5). */
  translations!: LegalTranslationsResponseDto;

  createdAt!: string;
  updatedAt!: string;

  /** Null on a draft, and null if that administrator's account has since gone. */
  publishedBy!: LegalPublisherDto | null;

  /** How many people have accepted this exact version. */
  _count!: LegalAcceptanceCountDto;
}

/** A draft, as starting or editing one answers. The whole row, body included. */
export class LegalDraftDto {
  id!: string;
  kind!: LegalDocumentKind;
  version!: number;
  title!: string;
  body!: string;
  publishedAt!: string | null;
  publishedById!: string | null;
  changeNote!: string | null;
  createdAt!: string;
  updatedAt!: string;
}
