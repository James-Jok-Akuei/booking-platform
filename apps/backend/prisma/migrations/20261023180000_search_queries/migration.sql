-- What customers search for, as words and counts only (§310).
CREATE TABLE "search_queries" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "districtId" TEXT,
    "results" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_queries_createdAt_idx" ON "search_queries"("createdAt");
CREATE INDEX "search_queries_districtId_createdAt_idx" ON "search_queries"("districtId", "createdAt");
