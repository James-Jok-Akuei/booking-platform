-- CreateTable
CREATE TABLE "business_kinds" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_kinds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_kinds_categoryId_idx" ON "business_kinds"("categoryId");

-- CreateIndex
CREATE INDEX "business_kinds_subcategoryId_idx" ON "business_kinds"("subcategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "business_kinds_businessId_subcategoryId_key" ON "business_kinds"("businessId", "subcategoryId");

-- AddForeignKey
ALTER TABLE "business_kinds" ADD CONSTRAINT "business_kinds_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_kinds" ADD CONSTRAINT "business_kinds_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_kinds" ADD CONSTRAINT "business_kinds_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every business that has a type already has that one kind (§265): its main.
INSERT INTO "business_kinds" ("id", "businessId", "categoryId", "subcategoryId", "position")
SELECT gen_random_uuid()::text, bp."id", s."categoryId", bp."subcategoryId", 0
FROM "business_profiles" bp
JOIN "subcategories" s ON s."id" = bp."subcategoryId"
WHERE bp."subcategoryId" IS NOT NULL;
