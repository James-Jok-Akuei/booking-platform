# Booking Platform — Backend

NestJS + TypeScript + Prisma + PostgreSQL. One backend, one database,
role-based access for BUSINESS / CUSTOMER / ADMIN, built module by module.

This package lives at `apps/backend` inside the monorepo. Dependencies are
installed from the **repo root** (`npm install`) via npm workspaces — see the
[root README](../../README.md) and [DECISIONS.md](../../DECISIONS.md).

## Modules included so far

- **Auth module** — OTP-via-email authentication (no passwords for MVP).
  - `POST /auth/otp/request` — `{ email, role }` → sends a 6-digit code to the email.
  - `POST /auth/otp/verify` — `{ email, code, role }` → verifies the code, creates
    the account on first login, returns `{ accessToken, refreshToken, user }`.
  - `POST /auth/refresh` — `{ refreshToken }` → rotates and returns a new token pair.
  - `POST /auth/logout` — `{ refreshToken }` → revokes that refresh token.
- **Users module** — `GET /users/me` (requires `Authorization: Bearer <accessToken>`)
  as a smoke test that the guard chain works.

## Setup

1. Install dependencies **from the repo root** (npm workspaces hoists them):
   ```bash
   cd ../..   # repo root
   npm install
   ```

2. Start Postgres and Mailhog:
   ```bash
   docker compose -f apps/backend/docker-compose.yml up -d
   # or, from the repo root: npm run docker:up
   ```
   - Postgres → `localhost:5432` (db `booking_platform`, user/pass `postgres`)
   - Mailhog SMTP → `localhost:1025`, web inbox → <http://localhost:8025>

3. Copy `.env.example` to `.env`:
   ```bash
   cp apps/backend/.env.example apps/backend/.env
   ```
   The defaults already point at the Docker Compose services above, so local dev
   works unedited. Before deploying anywhere real, replace:
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — long random strings, different
     from each other. Generate with `openssl rand -hex 32`.
   - `SMTP_*` — credentials from SendGrid / Resend / Postmark / etc. If `SMTP_USER`
     is left empty the mail service skips the SMTP AUTH handshake entirely, which
     is what makes Mailhog work locally.

   In development OTP codes are also logged to the server console
   (`[DEV ONLY] OTP for ...`), so the flow is testable even with mail misconfigured.

4. Generate the Prisma client and run the first migration (from `apps/backend`):
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```
   This creates the `users`, `business_profiles`, `otp_codes`, and
   `refresh_tokens` tables.

5. Run the dev server:
   ```bash
   npm run start:dev          # from apps/backend
   npm run backend:dev        # or from the repo root
   ```
   Server starts on `http://localhost:3000` (or `PORT` from `.env`).

## Automated tests

```bash
docker compose up -d     # the only manual setup step
npm test                 # run the suite once
npm run test:watch       # re-run on change
```

The suite targets four invariants where a silent regression is expensive —
the deposit/fee split, the appointment state machine, capacity counting, and
cross-tenant isolation. It is a foundation, not full coverage; see
[DECISIONS.md §23](../../DECISIONS.md) for what is covered and why those four.

**Tests run against a real Postgres, never a mocked Prisma.** They use a
separate `booking_platform_test` database on the same container as the dev
database, created and migrated automatically on the first run. Your dev data is
never touched — `test/setup/env.ts` refuses to run unless `DATABASE_URL` names
the test database.

Each suite truncates the tables it uses before and after itself, so runs are
repeatable and order-independent. Jest runs serially (`maxWorkers: 1`) because
the suites share those tables.

The MTN MoMo integration is deliberately **not** in the suite: it depends on an
external sandbox and real test MSISDNs, so it stays a manual check
(`scripts/ws-smoke-test.js` plays the same role for the chat WebSocket layer).

## Testing the auth flow locally

```bash
# 1. Request a code
curl -s -X POST http://localhost:3000/auth/otp/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","role":"BUSINESS"}'

# 2. Read it out of Mailhog (or from the server console)
curl -s http://localhost:8025/api/v2/messages | \
  python3 -c 'import json,sys,re; print(re.search(r"\b\d{6}\b", json.load(sys.stdin)["items"][0]["Content"]["Body"]).group())'

# 3. Verify it -> returns accessToken / refreshToken / user
curl -s -X POST http://localhost:3000/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","code":"<CODE>","role":"BUSINESS"}'

# 4. Call a protected endpoint
curl -s http://localhost:3000/users/me -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Note the OTP rate limit: `OTP_RESEND_COOLDOWN_SECONDS` (default 60s) blocks a second
request for the same email inside the cooldown window.

## Design notes / decisions baked in

- **One email = one role.** If an email is already registered as a business,
  it can't also sign up as a customer with the same email. Revisit if you
  later want the same person to be both.
- **OTP is single-purpose (`LOGIN`)** and covers both signup and login — there's
  no separate signup flow. First successful verification creates the `User`
  row (and a `PENDING` `BusinessProfile` row if `role = BUSINESS`).
- **Rate limiting** is enforced in `AuthService.enforceRateLimits`:
  cooldown between requests (`OTP_RESEND_COOLDOWN_SECONDS`) and a cap per
  rolling hour (`OTP_MAX_REQUESTS_PER_HOUR`). Both are env-configurable.
- **OTP codes and refresh tokens are never stored raw** — OTPs are bcrypt-hashed,
  refresh tokens are SHA-256 hashed for lookup/revocation.
- **Refresh token rotation**: every `/auth/refresh` call revokes the old token
  and issues a new pair. A stolen refresh token that gets refreshed by its
  rightful owner will silently invalidate the stolen copy on next use.
- **`RolesGuard` + `@Roles(...)`** are ready to use on future endpoints, e.g.
  `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.BUSINESS)`. Nothing
  uses `@Roles` yet since the business-profile module isn't built.
- **Admin accounts are never created through `/auth/otp/request`** — the DTO
  only accepts `BUSINESS` or `CUSTOMER`. Admin account creation will be seeded
  or created via the future admin portal module.

## What's next (not yet built)

Following the agreed build order: Business profile & services →
Availability & scheduling → Appointment state machine → Payments/deposits/wallet
→ Chat → Notifications → Reviews & reporting → Admin portal.
