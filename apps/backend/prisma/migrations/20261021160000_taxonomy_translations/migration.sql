-- Category and type names in the other languages, typed in the console (§308.3).
ALTER TABLE "categories" ADD COLUMN "translations" JSONB;
ALTER TABLE "subcategories" ADD COLUMN "translations" JSONB;
