-- §104. Rwanda's provinces and districts.
--
-- Reference data, seeded here rather than in seed.ts: it is part of the
-- country, not of a demo, and a deployment with an empty districts table would
-- have a place filter that silently matches nothing.

CREATE TABLE "provinces" (
  "id"   TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provinces_code_key" ON "provinces"("code");
CREATE UNIQUE INDEX "provinces_name_key" ON "provinces"("name");

CREATE TABLE "districts" (
  "id"         TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "provinceId" TEXT NOT NULL,
  CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "districts_code_key" ON "districts"("code");
CREATE UNIQUE INDEX "districts_provinceId_name_key" ON "districts"("provinceId", "name");
CREATE INDEX "districts_provinceId_idx" ON "districts"("provinceId");

ALTER TABLE "districts"
  ADD CONSTRAINT "districts_provinceId_fkey"
  FOREIGN KEY ("provinceId") REFERENCES "provinces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable: every existing branch predates this, and a required column would
-- have made them unsaveable. Restrict, because a district is reference data —
-- it must not be deletable out from under a branch that points at it.
ALTER TABLE "locations" ADD COLUMN "districtId" TEXT;
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "districts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "locations_districtId_idx" ON "locations"("districtId");

-- ---------------------------------------------------------------------------
-- The five provinces and thirty districts.
-- ---------------------------------------------------------------------------

INSERT INTO "provinces" ("id", "code", "name") VALUES
  (gen_random_uuid(), 'KIGALI',   'City of Kigali'),
  (gen_random_uuid(), 'NORTHERN', 'Northern Province'),
  (gen_random_uuid(), 'SOUTHERN', 'Southern Province'),
  (gen_random_uuid(), 'EASTERN',  'Eastern Province'),
  (gen_random_uuid(), 'WESTERN',  'Western Province');

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
JOIN "provinces" p ON p."code" = d.province_code;
