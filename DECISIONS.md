# Design Decisions

Running log of product and technical decisions for the booking platform.
Purpose: any future session (human or AI) can read this file and have the full
context without re-explaining the product.

**Convention:** append a new section per module as it gets designed. Keep entries
factual and dated. If a decision is reversed, don't delete it — mark it
`~~superseded~~` and add the replacement underneath, so the reasoning trail survives.

---

## 1. Product scope

**What it is:** a service-booking marketplace. Customers book appointments with
businesses; businesses manage their availability, services and bookings.

**Categories in scope for MVP:**

- Beauty & Personal Care
- Health & Wellness
- Photography & Creative Services
- Events
- Home Services
- Professional & Consulting
- Automotive
- Pet Services

**Explicitly OUT of scope for MVP:**

- Medical / dental
- Catering
- Delivery-style categories generally (this is an appointment platform, not a
  delivery platform)

---

## 2. Revenue model — deposits and platform fee

This is the load-bearing commercial decision; most of the payments module follows from it.

- At booking time the customer pays a **deposit**: a percentage of the service price.
- The **platform fee is flat** (e.g. $1 per appointment) and is deducted from that
  deposit **first**. The remainder of the deposit goes to the business.
- The **remaining balance** is settled between customer and business directly —
  cash, card, or any method, outside the platform. Alternatively the customer may
  choose to pay the full amount online upfront.
- If the customer cancels, or simply never pays the remaining balance, the deposit
  (platform fee included) is **non-refundable**, and the business is not owed the rest.

**Why it's built this way:** the platform fee is collected upfront, at booking, from
money that already moved through the platform. Revenue never depends on businesses
honestly self-reporting that an appointment was completed. Only the deposit is
guaranteed to flow through the platform; everything else is optional.

**Implication for the payments module:** the ledger must model deposit → fee split →
business payable, and treat "balance paid offline" as a normal, expected outcome
rather than an exception.

---

## 3. Authentication — one email, one role

- **OTP via email only** for MVP. No passwords anywhere.
- **One email address maps to exactly one role.** An email registered as a BUSINESS
  cannot also sign up as a CUSTOMER. Attempting it is rejected at
  `/auth/otp/request` and again at `/auth/otp/verify`.
- OTP is single-purpose (`LOGIN`) and covers both signup and login — there is no
  separate signup flow. First successful verification creates the `User` row.
- **Admin accounts are never self-service.** The auth DTOs accept only `BUSINESS`
  or `CUSTOMER`; admins are seeded or created via the future admin portal.

**Revisit if:** we later want one person to hold both a business and a customer
account under the same email. That would mean separating identity from role.

---

## 4. Architecture — one backend, one database, three apps

- **One** NestJS backend and **one** PostgreSQL database serve all three
  frontends — never three separate backends.
- The three apps are Business, Customer, and Admin. They are distinguished by the
  `role` field on the `User` model (`BUSINESS` / `CUSTOMER` / `ADMIN`) and enforced
  with `JwtAuthGuard` + `RolesGuard` + `@Roles(...)`.
- Repo is a **monorepo** with npm workspaces (`apps/*`) so `apps/business-web`,
  `apps/customer-web` and `apps/admin-web` can be added later without restructuring.

---

## 5. No in-app postponement feature

Deliberately dropped. Instead:

- Customers and businesses negotiate rescheduling through **in-app chat**.
- A business can **directly edit an appointment's date/time in-app** — no approval
  workflow, no day-limit, no request/accept cycle.

**Why:** a postponement request/approval state machine adds significant complexity
for something two parties can settle in a message. Direct edit keeps the records
accurate, which is what the schedule actually needs to be good for.

---

## 6. Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + TypeScript + NestJS |
| ORM | Prisma |
| Database | PostgreSQL |
| Auth | OTP-via-email, JWT access + refresh, refresh token rotation |
| Secret storage | OTPs bcrypt-hashed; refresh tokens SHA-256 hashed at rest |
| Local dev | Docker Compose — Postgres + Mailhog (fake SMTP inbox on `localhost:8025`) |
| Frontend | Web PWA ×3 (business / customer / admin) — not started, details TBD |

---

## 7. Module build order

Backend-first, one module at a time. Each module is designed in conversation
before it is built.

1. **Auth** — DONE
2. **Business profile & services** — NEXT
3. Availability & scheduling
4. Appointment state machine
5. Payments / deposits / wallet
6. Chat
7. Notifications
8. Reviews & reporting
9. Admin portal

---

## 8. Decisions made during the monorepo restructure (2026-08-29)

- Backend moved to `apps/backend/`; root is an npm-workspaces package
  (`"workspaces": ["apps/*"]`), private, with no dependencies of its own.
- `docker-compose.yml` lives in `apps/backend/` rather than at the root, since the
  services it defines (Postgres, Mailhog) exist to serve the backend. Root
  `npm run docker:up` proxies to it so it can still be driven from the repo root.
- Mailhog is pinned to `platform: linux/amd64` — upstream publishes no arm64 image,
  so on Apple Silicon it runs under emulation. `axllent/mailpit` is the drop-in
  replacement if that ever becomes a problem.
- `MailService` now only sends SMTP `auth` when `SMTP_USER` is non-empty. Mailhog
  never advertises AUTH, and passing empty credentials made nodemailer attempt an
  AUTH handshake that fails.

---

## 9. Fixes made while first running the stack (2026-08-29)

The Auth module had never actually been executed before this session. Getting it
to boot surfaced four real defects, all now fixed:

1. **`PassportModule` was imported bare.** `AuthModule` had `imports: [PassportModule]`,
   but the bare class is `@Module({})` and provides nothing — `AuthModuleOptions`,
   which `AuthGuard` (and therefore `JwtAuthGuard`) injects, only exists via
   `PassportModule.register(...)`. Now `PassportModule.register({ defaultStrategy: 'jwt' })`.

2. **`AuthModule` is now `@Global()`** and exports `PassportModule` + `JwtModule`.
   `UsersModule` used `JwtAuthGuard` without importing Passport and failed DI at boot.
   Every future feature module will use these guards, so this follows the same
   reasoning already applied to `PrismaModule`.

3. **`TokenPair` is now exported** from `auth.service.ts` (TS4053 — it appeared in
   `AuthController`'s inferred return types but "could not be named").

4. **JWT `expiresIn` typing.** `@nestjs/jwt` types it as `number | StringValue`
   (a template literal type); `ConfigService.get<string>()` returns
   `string | undefined`, which isn't assignable. Added a small `expiresIn()`
   helper that casts through `JwtSignOptions['expiresIn']` and applies a fallback.

### Toolchain decisions

- **Dev/build now run through the Nest CLI** (`nest start --watch`, `nest build`)
  instead of `ts-node-dev`. Two reasons: (a) `typescript@^7` resolves to the new
  native TS 7, which `ts-node@10` cannot load at all (`ts.sys` is undefined), and
  npm hoists TS 7 to the repo root because `@nestjs/schematics@12` declares
  `peer typescript >=6.0.0` — so the workspace-local `typescript@5.9.3` pin does
  *not* reach root-level `ts-node`; (b) `ts-node-dev --transpile-only` was
  silently skipping all type checking, which is how defects 3 and 4 stayed hidden.
  `ts-node-dev` has been removed from devDependencies.
- **`typescript` is pinned to `^5.9.3`** in `apps/backend`.

### Local Postgres port

- The Compose Postgres publishes on **host port 5433**, not 5432. A natively
  installed Postgres (Postgres.app, Homebrew) commonly owns 5432 and binds
  `127.0.0.1` specifically, which silently beats Docker's wildcard forward — so
  `prisma migrate` connects to the wrong database with no error. Using 5433
  makes the container unambiguous.

### Known rough edge (not fixed — decide when building the next module)

- In `AuthService.requestOtp`, the **rate-limit check runs before the
  one-email-one-role check**. A customer who types their business email into the
  Customer app sees "Please wait 47s before requesting another code" rather than
  "This email is already registered as a business account." Worth reordering when
  the frontends start consuming these errors.
