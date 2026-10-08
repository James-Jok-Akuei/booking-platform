-- The headline on a service's own page (§185): on the service, and on the
-- draft of one so it is not lost while being written.
ALTER TABLE "services" ADD COLUMN "title" TEXT;
ALTER TABLE "service_drafts" ADD COLUMN "title" TEXT;
