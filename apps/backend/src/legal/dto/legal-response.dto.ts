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
