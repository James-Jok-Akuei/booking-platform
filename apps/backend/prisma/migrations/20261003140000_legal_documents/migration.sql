-- Legal documents, written by an admin and versioned (§122).
--
-- Publishing never edits a published row; it writes a new version. What somebody
-- agreed to has to stay readable exactly as they read it — a privacy policy that
-- can be rewritten under the people who accepted it records nothing at all.

CREATE TYPE "LegalDocumentKind" AS ENUM ('TERMS_OF_USE', 'PRIVACY_POLICY', 'SELLER_AGREEMENT');

CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");
CREATE INDEX "legal_documents_kind_publishedAt_idx" ON "legal_documents"("kind", "publishedAt");

-- At most ONE draft per kind, enforced here rather than in the service: two
-- admins pressing "new version" together would both pass a read-then-write, and
-- the loser's work would vanish into a row nobody could find.
CREATE UNIQUE INDEX "legal_documents_one_draft_per_kind"
    ON "legal_documents"("kind") WHERE "publishedAt" IS NULL;

ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_acceptances_userId_documentId_key" ON "legal_acceptances"("userId", "documentId");
CREATE INDEX "legal_acceptances_userId_idx" ON "legal_acceptances"("userId");

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: a published document that somebody accepted must not be
-- removable, and the record of their acceptance must not disappear with it.
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
