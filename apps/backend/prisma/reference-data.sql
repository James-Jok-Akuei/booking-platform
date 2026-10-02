-- Rwanda's provinces and districts (§104).
--
-- The LIVING copy. The migration that introduced these holds a frozen one —
-- migrations are history and must not change — and this is what any
-- environment can be brought up to date with. Idempotent, so running it twice
-- is harmless.
--
-- The test harness runs it after `migrate deploy`, because a test database
-- created before this existed, or truncated by a reset, would otherwise have
-- no country in it.

INSERT INTO "provinces" ("id", "code", "name") VALUES
  (gen_random_uuid(), 'KIGALI',   'City of Kigali'),
  (gen_random_uuid(), 'NORTHERN', 'Northern Province'),
  (gen_random_uuid(), 'SOUTHERN', 'Southern Province'),
  (gen_random_uuid(), 'EASTERN',  'Eastern Province'),
  (gen_random_uuid(), 'WESTERN',  'Western Province')
ON CONFLICT ("code") DO NOTHING;

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
JOIN "provinces" p ON p."code" = d.province_code
ON CONFLICT ("code") DO NOTHING;
