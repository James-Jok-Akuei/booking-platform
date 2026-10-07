-- What a customer should know before they come (§180): on the service, and on
-- the draft of one so it is not lost while being written.
ALTER TABLE "services" ADD COLUMN "instructions" TEXT;
ALTER TABLE "service_drafts" ADD COLUMN "instructions" TEXT;
