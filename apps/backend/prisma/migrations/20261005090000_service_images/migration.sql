-- Photos of a service, shown to a customer choosing between services (§132).
--
-- On `services` rather than on `service_locations`: a haircut looks the same at
-- every branch and only its price differs, so hanging photos off the per-branch
-- join would make a business upload the same eleven pictures once per branch.
--
-- A separate table from `location_media` for the reason tickets are separate
-- from chat: the columns are alike, the subject is not, and one shared table
-- would put a "which kind is this" predicate in every query — the §123 lesson
-- about what a forgotten `where` costs.

CREATE TABLE "service_media" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'PHOTO',
    "url" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_media_pkey" PRIMARY KEY ("id")
);

-- Read as "this service's photos, in order", which is the only way they are read.
CREATE INDEX "service_media_serviceId_displayOrder_idx"
    ON "service_media"("serviceId", "displayOrder");

-- CASCADE, matching location_media: a retired service keeps its row (§75) so
-- past appointments still resolve, but a service that is genuinely deleted
-- should not leave its photos behind as orphans.
ALTER TABLE "service_media"
    ADD CONSTRAINT "service_media_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
