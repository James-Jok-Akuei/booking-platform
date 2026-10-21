-- Legal documents in the other languages; the language each agreement was read in (§308.5).
ALTER TABLE "legal_documents" ADD COLUMN "translations" JSONB;
ALTER TABLE "legal_acceptances" ADD COLUMN "language" TEXT;
