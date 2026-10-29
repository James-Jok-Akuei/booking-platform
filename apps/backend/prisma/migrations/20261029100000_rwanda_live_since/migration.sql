-- Rwanda has been live since its first shop was posted for customers (§268),
-- not since the countries table was made (§315). A database with no shop yet
-- keeps the day it was made, which is then true.
UPDATE "countries"
SET "liveSince" = first."postedAt"
FROM (SELECT MIN("publishedAt") AS "postedAt" FROM "business_profiles") AS first
WHERE "countries"."code" = 'RW'
  AND first."postedAt" IS NOT NULL
  AND first."postedAt" < "countries"."liveSince";
