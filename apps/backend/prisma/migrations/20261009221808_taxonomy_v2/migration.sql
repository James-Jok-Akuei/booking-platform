-- The taxonomy, renamed and regrouped for book-and-go (§266). Data only; the
-- full list of categories and types is the seed (prisma/seed.ts). Every
-- statement is keyed on the OLD names and guarded, so on a fresh database —
-- where the seed has not run yet — it changes nothing.

-- Types that move to another category.
UPDATE "subcategories" SET "name" = 'Massage', "categoryId" = (SELECT "id" FROM "categories" WHERE "name" = 'Beauty & Personal Care')
WHERE "name" = 'Massage Therapy'
  AND "categoryId" = (SELECT "id" FROM "categories" WHERE "name" = 'Health & Wellness')
  AND EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Beauty & Personal Care');

UPDATE "subcategories" SET "categoryId" = (SELECT "id" FROM "categories" WHERE "name" = 'Professional & Consulting')
WHERE "name" = 'Personal Training'
  AND "categoryId" = (SELECT "id" FROM "categories" WHERE "name" = 'Health & Wellness')
  AND EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Professional & Consulting');

-- Types renamed to the words customers use.
UPDATE "subcategories" s SET "name" = r."to"
FROM (VALUES
  ('Beauty & Personal Care', 'Hair Salon', 'Hair'),
  ('Beauty & Personal Care', 'Nail Salon', 'Nails'),
  ('Beauty & Personal Care', 'Makeup Artist', 'Make-up'),
  ('Beauty & Personal Care', 'Skincare & Facials', 'Facials'),
  ('Health & Wellness', 'Nutrition Coaching', 'Diet & Nutrition'),
  ('Health & Wellness', 'Yoga & Pilates', 'Meditation & Yoga'),
  ('Health & Wellness', 'Mental Wellness Coaching', 'Therapy'),
  ('Professional & Consulting', 'Tutoring & Training', 'Tutoring')
) AS r("category", "from", "to")
JOIN "categories" c ON c."name" = r."category"
WHERE s."categoryId" = c."id" AND s."name" = r."from"
  AND NOT EXISTS (SELECT 1 FROM "subcategories" t WHERE t."categoryId" = c."id" AND t."name" = r."to");

-- Categories renamed.
UPDATE "categories" c SET "name" = r."to"
FROM (VALUES
  ('Beauty & Personal Care', 'Beauty & Spa'),
  ('Health & Wellness', 'Wellness'),
  ('Events', 'Event Services'),
  ('Professional & Consulting', 'Services')
) AS r("from", "to")
WHERE c."name" = r."from"
  AND NOT EXISTS (SELECT 1 FROM "categories" t WHERE t."name" = r."to");

-- A business's main category, and each of its kinds, follow their type.
UPDATE "business_profiles" bp SET "categoryId" = s."categoryId"
FROM "subcategories" s
WHERE s."id" = bp."subcategoryId" AND bp."categoryId" IS DISTINCT FROM s."categoryId";

UPDATE "business_kinds" k SET "categoryId" = s."categoryId"
FROM "subcategories" s
WHERE s."id" = k."subcategoryId" AND k."categoryId" <> s."categoryId";
