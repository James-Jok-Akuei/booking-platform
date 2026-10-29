-- Rwanda, its provinces and its districts (§104, §315).
--
-- The LIVING copy. The migration that introduced these holds a frozen one —
-- migrations are history and must not change — and this is what any
-- environment can be brought up to date with. Idempotent, so running it twice
-- is harmless.
--
-- The test harness runs it after `migrate deploy`, because a test database
-- created before this existed, or truncated by a reset, would otherwise have
-- no country in it.

-- The country first: its places belong to it. A row that exists is left as it
-- is — whether it is live, and its own fee, are the console's to change.
INSERT INTO "countries" ("code", "name", "callingCode", "currency", "timeZone", "locales", "networks", "phoneExample", "isLive", "isDefault", "liveSince", "updatedAt")
VALUES ('RW', 'Rwanda', '250', 'RWF', 'Africa/Kigali', ARRAY['en', 'rw', 'fr'], ARRAY['MTN_MOMO', 'AIRTEL_MONEY']::"MobileMoneyProvider"[], '+250 788 123 456', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "provinces" ("id", "code", "name", "countryCode") VALUES
  (gen_random_uuid(), 'KIGALI',   'City of Kigali',    'RW'),
  (gen_random_uuid(), 'NORTHERN', 'Northern Province', 'RW'),
  (gen_random_uuid(), 'SOUTHERN', 'Southern Province', 'RW'),
  (gen_random_uuid(), 'EASTERN',  'Eastern Province',  'RW'),
  (gen_random_uuid(), 'WESTERN',  'Western Province',  'RW')
ON CONFLICT ("countryCode", "code") DO NOTHING;

INSERT INTO "districts" ("id", "code", "name", "provinceId")
SELECT gen_random_uuid(), d.code, d.name, p.id
FROM (VALUES
  ('GASABO',     'Gasabo',     'KIGALI'),
  ('KICUKIRO',   'Kicukiro',   'KIGALI'),
  ('NYARUGENGE', 'Nyarugenge', 'KIGALI'),

  ('BURERA',     'Burera',     'NORTHERN'),
  ('GAKENKE',    'Gakenke',    'NORTHERN'),
  ('GICUMBI',    'Gicumbi',    'NORTHERN'),
  ('MUSANZE',    'Musanze',    'NORTHERN'),
  ('RULINDO',    'Rulindo',    'NORTHERN'),

  ('GISAGARA',   'Gisagara',   'SOUTHERN'),
  ('HUYE',       'Huye',       'SOUTHERN'),
  ('KAMONYI',    'Kamonyi',    'SOUTHERN'),
  ('MUHANGA',    'Muhanga',    'SOUTHERN'),
  ('NYAMAGABE',  'Nyamagabe',  'SOUTHERN'),
  ('NYANZA',     'Nyanza',     'SOUTHERN'),
  ('NYARUGURU',  'Nyaruguru',  'SOUTHERN'),
  ('RUHANGO',    'Ruhango',    'SOUTHERN'),

  ('BUGESERA',   'Bugesera',   'EASTERN'),
  ('GATSIBO',    'Gatsibo',    'EASTERN'),
  ('KAYONZA',    'Kayonza',    'EASTERN'),
  ('KIREHE',     'Kirehe',     'EASTERN'),
  ('NGOMA',      'Ngoma',      'EASTERN'),
  ('NYAGATARE',  'Nyagatare',  'EASTERN'),
  ('RWAMAGANA',  'Rwamagana',  'EASTERN'),

  ('KARONGI',    'Karongi',    'WESTERN'),
  ('NGORORERO',  'Ngororero',  'WESTERN'),
  ('NYABIHU',    'Nyabihu',    'WESTERN'),
  ('NYAMASHEKE', 'Nyamasheke', 'WESTERN'),
  ('RUBAVU',     'Rubavu',     'WESTERN'),
  ('RUSIZI',     'Rusizi',     'WESTERN'),
  ('RUTSIRO',    'Rutsiro',    'WESTERN')
) AS d(code, name, province_code)
JOIN "provinces" p ON p."code" = d.province_code AND p."countryCode" = 'RW'
ON CONFLICT ("provinceId", "code") DO NOTHING;

-- The City of Kigali is one place to anyone living in it (§106).
UPDATE "provinces" SET "isCity" = true WHERE "code" = 'KIGALI' AND "countryCode" = 'RW';
