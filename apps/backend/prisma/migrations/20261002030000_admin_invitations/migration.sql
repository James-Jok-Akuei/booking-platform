-- §99. Administrators can invite other administrators.

CREATE TABLE "admin_invitations" (
  "id"              TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "status"          "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_invitations_email_status_idx" ON "admin_invitations"("email", "status");

ALTER TABLE "admin_invitations"
  ADD CONSTRAINT "admin_invitations_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT false;

-- At most ONE primary administrator, enforced by the database.
--
-- A partial index, not a plain unique: a unique index on a boolean column would
-- also forbid a second `false`, which would allow exactly one administrator and
-- nobody else. This constrains only the rows where the flag is true.
CREATE UNIQUE INDEX "one_primary_admin" ON "users" ((1)) WHERE "isPrimaryAdmin";

-- The longest-standing administrator becomes primary. On a deployment with no
-- administrator this does nothing, and the first one created is made primary by
-- the service instead.
UPDATE "users" SET "isPrimaryAdmin" = true
WHERE "id" = (
  SELECT "id" FROM "users" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1
);
