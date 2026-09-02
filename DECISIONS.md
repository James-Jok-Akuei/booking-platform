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
- ~~The **platform fee is flat** (e.g. $1 per appointment) and is deducted from that
  deposit **first**. The remainder of the deposit goes to the business.~~
  **Superseded by §16.3 (2026-08-30): the platform fee is a PERCENTAGE of the
  service price**, admin-configurable at runtime, not a flat per-appointment
  amount. The mechanics below are unchanged — the fee still comes out of the
  deposit first and the remainder still goes to the business — only the way the
  fee is calculated changed.
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

> **Amended by §14.** `UserRole.BUSINESS` still means "this account belongs to a
> business", but it no longer implies *which* business or *what they may do
> there* — that now comes from `BusinessMembership`. One email still maps to
> exactly one role, and now also to at most one business.

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

1. **Auth** — DONE (§3, §9; fix in §11)
2. **Business profile & services** — DONE (§10)
3. **Availability & scheduling** — DONE (§12)
4. **Appointment state machine** — DONE (§16)
5. **Payments / deposits** — DONE (§17, currency in §18). Wallet and payouts
   still to come.
6. **Notifications** — DONE (§20). ~~Was listed 7th~~ — moved ahead of Chat,
   because a business was never told it had a booking, and a chat message
   nobody is notified about is half a feature. See §20.1.
7. **Chat** — DONE (§21, realtime in §22)
8. **Support tickets** — DONE (§24)
9. **Reviews & reporting** — NEXT
10. Admin portal

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

### Known rough edge — ~~not fixed~~ RESOLVED 2026-08-29, see §11

- ~~In `AuthService.requestOtp`, the **rate-limit check runs before the
  one-email-one-role check**. A customer who types their business email into the
  Customer app sees "Please wait 47s before requesting another code" rather than
  "This email is already registered as a business account." Worth reordering when
  the frontends start consuming these errors.~~

  **Fixed in §11.** The two checks are now the other way round.

---

## 10. Business profile, locations, services & gallery (2026-08-29)

Module 2 of the build order. Everything a business manages about *itself*,
before any customer or appointment exists.

### 10.1 Category taxonomy lives in a seed script, not a migration

The MVP taxonomy from §1 is now two tables — `Category` (name, icon,
description) and `Subcategory` (categoryId, name) — populated by
`prisma/seed.ts`, run with `npm run prisma:seed`.

**Why a seed and not a migration:** the taxonomy is *product data*, not schema.
Category names, icons and descriptions will be reworded repeatedly as the
marketplace finds its shape, and that shouldn't mean authoring a migration each
time. The seed upserts by name and never deletes, so it is safely re-runnable —
verified by running it twice and getting 8 categories / 46 subcategories both
times, with no duplicates.

Shipped taxonomy: 8 categories, 4–6 subcategories each. Health & Wellness
carries an explicit "excludes medical and dental" description and Events an
explicit "excludes catering", so the §1 scope exclusions are visible in the data
itself rather than only in this file.

- `Subcategory` is unique on `(categoryId, name)`, not on `name` globally — the
  same subcategory name under two different parents must not collide.
- `BusinessProfile.categoryId` / `subcategoryId` are both nullable and
  `onDelete: SetNull`. The profile row is created at signup, long before a
  category is chosen, and retiring a category must never cascade away a business
  account.
- The API validates that a submitted subcategory actually belongs to the
  submitted category, so a hair salon cannot end up filed under Automotive.
  Changing category without naming a new subcategory clears the old one rather
  than leaving it dangling under the wrong parent.

`GET /categories` is **public and unauthenticated** — deliberately the only
endpoint in the module without `JwtAuthGuard`. Both sides need the taxonomy
before they hold a token: a business picks its category during onboarding, and a
customer browses categories before signing up at all.

### 10.2 Services belong to the business; photos belong to the location

Two entities that look parallel and are deliberately scoped differently.

**`Service` is business-scoped** (`businessId`, no `locationId`). A salon with
three branches offers the same haircut at all three. Duplicating the row per
location would mean editing the price three times, and would make "which of
these three identical haircuts did the customer book?" a meaningless question.

**`LocationMedia` is location-scoped** (`locationId`). A gallery exists to show
a customer what the place they are about to walk into actually looks like —
which is per-branch by definition. A chain's downtown salon and its mall kiosk
each get their own gallery rather than sharing one pool.

**Consequence for the availability module:** per-location differences in what is
offered are a *scheduling* concern, not a catalogue one. If the mall kiosk
doesn't do braiding, that is expressed as availability, not as a separate
service row. Revisit only if per-location *pricing* becomes a requirement — that
would need a join table, and would be a real change to the booking flow.

### 10.3 Money is stored as integer cents

`Service.priceCents` is an `Int`. Never a float, never a `Decimal` string.

**Why:** binary floating point cannot represent most decimal money values
exactly, and per §2 these amounts get *arithmetic* done on them — the deposit
percentage, the flat platform fee deducted from it, the business payable
remainder. Rounding drift in a ledger is the kind of bug that surfaces months
later as money that doesn't reconcile. The DTO rejects a decimal outright with
"priceCents must be an integer number of cents, not a decimal amount", and caps
the value to catch the obvious "typed dollars into a cents field" mistake.

Every future money column (deposits, fees, payouts, wallet balances) follows
this rule.

### 10.4 Locations and operating hours

`Location`: name, address, nullable `latitude`/`longitude`, nullable `phone`
overriding the business-level phone.

- **Coordinates are nullable and validated as a pair.** Many businesses onboard
  with a street address long before anyone pins exact coordinates, so distance
  search must tolerate their absence — but a *lone* latitude is meaningless, so
  submitting one half of the pair is a 400. On update the check runs against the
  merged result, not just the patch, so clearing one half of an existing pair
  fails too.
- **`LocationHours` is one row per day per location**, unique on
  `(locationId, dayOfWeek)`, `dayOfWeek` 0–6 on the JS `Date.getDay()`
  convention (0 = Sunday). Times are `"HH:mm"` strings.
- **`POST /locations/:id/hours` replaces the whole week**, delete-then-insert
  inside a transaction. Set-and-replace rather than incremental edits: the
  frontend edits a whole week at once, and a partial update would leave it
  ambiguous whether a missing day means "closed" or "unchanged". A shrinking
  payload therefore leaves no stale rows behind.
- A day with `isClosed: true` is normalised to `00:00`–`00:00` so the row is
  unambiguous and the scheduling module never has to interpret leftover times.
- Overnight hours (close before open) are rejected for now. Genuinely 24-hour or
  past-midnight businesses will need a deliberate model change; failing loudly
  beats silently storing a range that means nothing.

### 10.5 Deletes: locations hard, services soft

**`DELETE /business/services/:id` is a soft delete** — it flips `isActive` to
false and never removes the row. Appointments will reference `serviceId`, and a
completed booking has to keep resolving to the name and price it was made at
long after the business stops offering it. A hard delete would either orphan
those records or cascade away booking history. `isActive` also does double duty
as "temporarily hide this service without losing it".

The owner's own `GET /business/services` deliberately **includes** inactive
services — it is a management view. Customer-facing endpoints must filter to
`isActive: true`.

**`DELETE /business/locations/:id` is a hard delete**, with hours and media
cascading. A location has no historical appointment references to preserve
*yet*. **Revisit when appointments start carrying a `locationId`** — at that
point locations need the same soft-delete treatment as services.

### 10.6 File uploads: R2 with a local-disk fallback

`StorageService` is one interface over two drivers:

| Driver | When | Notes |
|---|---|---|
| `r2` | all five `R2_*` env vars present | Cloudflare R2 over the S3-compatible API. Production path. |
| `local` | otherwise | Writes to gitignored `uploads/`, served at `/uploads`. Dev only. |

**Why a fallback rather than a hard requirement:** missing R2 credentials should
degrade uploads to dev-only local disk, not take the entire business-profile
module offline. The whole feature can be built and tested before anyone
provisions a bucket. The trade-off is that a silent fallback could be mistaken
for a working production setup, so it logs a loud warning at boot *and* on every
single upload, naming exactly which env vars would switch it to R2. Filling them
in requires no code change.

Local disk is genuinely not viable in production — the folder isn't shared
between instances and is lost on redeploy — which is what the warning says.

Upload rules, all enforced before the handler is reached:

- **15MB max per file.** Multer's `limits.fileSize` caps the request before the
  bytes are buffered. Note that `@nestjs/platform-express` intercepts multer's
  own errors and maps `LIMIT_FILE_SIZE` to a `PayloadTooLargeException` whose
  body reads only "File too large" — which tells a business nothing actionable.
  `MulterExceptionFilter` catches the mapped exception and rewrites the message
  to name the actual limit, keeping the 413 status.
- **jpg / png / webp only.** Anything else is a 400 naming the rejected type.
- **30 photos per location.** Checked *after* the ownership check, so probing a
  location id can't reveal how full a competitor's gallery is. Photo 31 gets
  "delete an existing photo before uploading a new one".
- Stored object keys are random UUIDs, never the client-supplied filename —
  avoids collisions and stops a caller steering the object key with a crafted
  upload name.
- Memory storage, not disk storage: `StorageService` decides where the bytes
  land, so multer must not pre-commit them to a temp file.
- **Ordering on write:** upload to storage *first*, then create the row — an
  orphaned object costs a few KB, whereas a row pointing at a file that was
  never written is a broken image forever. **On delete, the reverse:** row
  first, then object, and `StorageService.remove()` never throws, so a storage
  hiccup leaves an orphan file rather than a photo the business cannot get rid
  of.

`MediaType` is an enum with only `PHOTO` in it today. Video isn't being built,
but an enum leaves room to add `VIDEO` later without a destructive column-type
migration. `MediaStatus` defaults to `PENDING` — uploaded media is moderated
before it goes public, mirroring `BusinessStatus`.

### 10.7 Ownership is structural, not a permission check

Every business-owned endpoint is guarded three deep: `JwtAuthGuard` (who is
calling) → `RolesGuard` + `@Roles(BUSINESS)` (are they a business at all) →
`BusinessAccessService` (is this specific row theirs).

The third layer is the important one, and it works by **scoping** rather than
by asking. Every service resolves the caller's own `businessId` first and then
filters every query by it; there is no code path that loads a resource by id
alone and then checks ownership afterwards. A request for another business's
location simply matches no row.

Mismatches return **404, not 403** — confirming that an id exists but belongs to
a competitor is itself a small information leak.

Verified end-to-end: a second business account received 404 on every attempt to
read, patch, delete, upload into, or set hours on the first business's data, and
the victim's records were bit-for-bit unchanged afterwards.

### 10.8 Approval status gates visibility, not editing

**A `PENDING` business can use every endpoint in this module.** Onboarding has to
be completable *before* an admin reviews it — otherwise there is nothing for the
admin to review. The whole verification flow below was performed by a business
sitting at `status: PENDING`.

**NOTE — not enforced yet, deliberately:** `PENDING`, `REJECTED` and `SUSPENDED`
businesses must be excluded from customer-facing search and discovery, along
with their locations, services and galleries. That filter is *not* implemented
in this module because no public discovery endpoint exists yet. It belongs to
the **customer search/discovery module** and is a required part of it — this
paragraph is the reminder.

`BusinessProfile.rejectionReason` was added for the `REJECTED` case, so a
business is told what to fix rather than left guessing. It is set by an admin
alongside the status change (admin portal, later module).

### 10.9 Endpoints added

| Method | Path | Auth |
|---|---|---|
| GET | `/categories` | **public** |
| GET / PATCH | `/business/profile` | business |
| POST / GET | `/business/locations` | business + ownership |
| PATCH / DELETE | `/business/locations/:id` | business + ownership |
| POST | `/business/locations/:id/hours` | business + ownership |
| POST / GET | `/business/locations/:id/gallery` | business + ownership |
| DELETE | `/business/locations/:id/gallery/:mediaId` | business + ownership |
| POST / GET | `/business/services` | business + ownership |
| PATCH / DELETE | `/business/services/:id` | business + ownership |

`GET /business/profile` was not in the original spec but is added — the frontend
needs to read the profile it is about to `PATCH`.

### 10.10 Verified end-to-end (2026-08-29)

Run against a live server with curl, same pattern as the Auth module. Business
account created through the existing OTP flow (code pulled from Mailhog), then:
profile set → location created → full week of hours set → services created →
real 59KB PNG uploaded → served back from its stored URL **byte-identical** to
the uploaded file → gallery listed → photo deleted (row *and* the underlying
file removed).

Negative paths confirmed: cross-category subcategory rejected; lone latitude
rejected; `closeTime` before `openTime` rejected; duplicate day rejected;
malformed `HH:mm` rejected; decimal price rejected; PDF and GIF uploads
rejected; 16MB upload rejected with the 15MB message while a 14MB upload
succeeded; the 31st photo rejected at the cap; missing token 401; customer token
403; and all seven cross-business attacks 404.

### 10.11 Toolchain fix caught by this module

Adding `prisma/seed.ts` silently broke the build. TypeScript infers `rootDir`
from the common root of all inputs, so a second top-level source folder widened
it from `src/` to the package root and output moved to `dist/src/main.js` —
`npm start` then died with `MODULE_NOT_FOUND` on `dist/main.js`.

Fixed by pinning `"rootDir": "./src"` and `"include": ["src/**/*"]` in
`tsconfig.json`, with a separate `tsconfig.seed.json` (`noEmit`) covering
`prisma/`. The seed runs through `ts-node` **without** `--transpile-only`, so it
is genuinely type-checked — the same lesson §9 already records about
`ts-node-dev` hiding real defects behind skipped type checking.

### 10.12 Still open

- The §9 rough edge is **still not fixed**: in `AuthService.requestOtp` the
  rate-limit check still runs before the one-email-one-role check. Untouched by
  this module; it stays on the list.
- No admin endpoints yet for approving a business or moderating `PENDING`
  media — both wait for the admin portal.
- Gallery `displayOrder` can be set on upload but there is no reorder endpoint;
  add one when the frontend grows drag-to-reorder.
- Orphaned storage objects (upload succeeded, row creation failed) have no
  cleanup job. Low volume for now; worth a sweep once uploads are at real scale.

---

## 11. Auth fix — role conflict is now checked before the rate limit (2026-08-29)

Closes the rough edge logged in §9. A contained reorder inside
`AuthService.requestOtp`; nothing else in the Auth module was touched.

### The bug

`enforceRateLimits()` ran before the one-email-one-role check. OTP history is
keyed by **email alone** — it has no notion of role — so the two interacted
badly: someone with an existing business account who had requested a code
recently, then mistyped that email into the Customer app, was told
*"Please wait 47s before requesting another code"* instead of
*"This email is already registered as a business account."*

The cooldown message wasn't wrong, exactly — it was a real cooldown, from their
own earlier business logins. It was just answering a question nobody asked. The
correct message did eventually appear once the window elapsed, which arguably
made it worse: the feedback changed depending on how recently the person had
last logged in, for a condition that has nothing to do with timing.

### The fix

Look up the existing user and throw the role-conflict `BadRequestException`
first. `enforceRateLimits()` is only called once we know the request could
legitimately produce an OTP — a new account, or an existing one under its
correct role.

The role conflict is a **permanent** property of the email, not a transient
one. It should be reported the same way regardless of request history.

### Why this is safe

**No new information disclosure.** The role-conflict message was already
returned immediately on a clean first attempt for an email — rate limiting only
engages once there is prior OTP history. Verified directly: a registered
business account with its OTP history aged past the cooldown returns the
role-conflict message on the first try, both before and after this change. The
reorder makes that answer *consistent*, it does not expose anything a fresh
attempt didn't already reveal.

Rate limiting itself is unchanged and still enforced for every request that
could actually issue a code.

### Verified (2026-08-29)

A/B tested against a live server on the **same email, inside the same active
cooldown window** — the §9 scenario reproduced exactly:

| | Request as CUSTOMER on a BUSINESS-registered email, mid-cooldown |
|---|---|
| **Before** (HEAD) | `Please wait 59s before requesting another code.` |
| **After** (fixed) | `This email is already registered as a business account.` |

Rate limiting proven still live at that same moment: the correct-role
(`BUSINESS`) request returned `Please wait 56s...`.

Regressions checked: clean new email still receives a code; same-role repeat
still hits the cooldown; role conflict with no active cooldown still answers
immediately (the disclosure baseline above); and the second-gate role check in
`verifyOtp` still fires when a genuinely valid code is redeemed under the wrong
role.

### Open item — the conflict check now has no request cap of its own

A role-conflict response returns before any `OtpCode` row is written, so it
**consumes no rate-limit quota**. Confirmed empirically: 10 consecutive
role-conflict requests left the `otp_codes` count for that email unchanged, and
the 10th response was identical to the first.

That makes `POST /auth/otp/request` an uncapped oracle for "is this email
registered, and under which role?" — worth noting, though its practical value is
limited, since the same answer was already available uncapped on any email with
no recent OTP history.

**Not built now — out of scope for this fix.** The eventual answer is a
lightweight IP-based rate limit on the endpoint as a whole, sitting in front of
the per-email OTP quota rather than replacing it (`@nestjs/throttler` is the
obvious fit). Logged here the same way §9 was, to be picked up when the
frontends start hitting these endpoints for real.

---

## 12. Availability & scheduling (2026-08-29)

Module 3 of the build order. Answers one question — *when can a customer book
at this location?* — and stores as little as possible in order to answer it.

### 12.1 Availability is computed, never stored

The three inputs are the weekly template (`LocationHours`, from §10), the
date-specific overrides added here, and existing appointments. They are combined
**live on every request**. There is deliberately no table of pre-generated
future slots.

**Why pre-generation was rejected:** a slot table is a second copy of a truth
the template already owns, and copies go stale. The moment a business edits its
Tuesday hours, every generated Tuesday for the next N months is wrong, and now
the system needs a backfill job, a horizon policy ("how far ahead do we
generate?"), and a reconciliation story for the window between the edit and the
backfill. Computing on read has none of those failure modes: an edit is visible
on the very next request because there is nothing else to update.

The cost is real but small — a handful of indexed reads per lookup, no joins
across a slot table, and the arithmetic is a loop over at most 96 grid points.
If it ever becomes hot, the answer is a short-TTL **cache** in front of the
computation, which can be thrown away and rebuilt at any time. That is
categorically different from a stored slot table, which is a source of truth
that can silently disagree with the template.

`getAvailability(locationId, date, durationMinutes, viewerUserId?)` applies
precedence in a fixed order:

1. **`LocationScheduleException`** for that exact date, checked *first*.
   `isClosed` returns empty; custom hours become that date's hours.
2. **Weekly template** for the date's day-of-week, consulted only when no
   exception governs the date. Closed, or no row at all, returns empty. (A
   location that configured only Mon–Fri is simply shut at the weekend — a
   missing row is not an error.)
3. Generate every 15-minute-aligned start between the resulting open and close.
4. Subtract **`LocationTimeBlock`** rows for that date.
5. Subtract **`BOOKED`** appointments overlapping that date. `CANCELLED` hands
   its time back.
6. Keep only starts where the service **fully fits before closing**.

~~The order matters and is tested: a template-closed day returns empty at step 1
*without consulting exceptions*, so a custom-hours exception on a day the
template calls closed does nothing.~~ **Superseded — corrected in §13.1.** The
exception is now checked before the template, so "we are normally shut on
Sundays, but we are opening 10:00–14:00 this one" is expressible.

The response reports which rule produced it (`source`: `TEMPLATE`, `EXCEPTION`,
`CLOSED_TEMPLATE`, `CLOSED_EXCEPTION`, `NO_TEMPLATE`), so "why is this day
empty?" is answerable without reading the database.

### 12.2 Fixed 15-minute grid

Start times land on `:00`, `:15`, `:30`, `:45`. The grid is **absolute**, not
relative to opening time: a location opening at 08:10 has its first bookable
start at 08:15.

Service *durations* are not constrained to multiples of 15. A 50-minute service
starts on the grid and ends off it — that is fine and intended. Only starts are
grid-aligned, because the grid exists to make a browsable list of times, not to
quantise how long work takes.

**The fit rule is the subtle part.** A slot is only offered if
`start + durationMinutes <= closeTime`. With a 45-minute service closing at
17:00, the last offered start is 16:15 — not 16:45. Verified across 15/30/45/
60/90/120-minute durations: every one ends at exactly 17:00 and none overrun.

### 12.3 No buffer time between appointments

Intervals are **half-open** — `[start, end)`. An appointment ending at 14:00 and
one starting at 14:00 do not overlap, so back-to-back booking is allowed.

This is visible in the tests: with a 12:00–14:00 block and a 60-minute service,
11:00 survives (11:00 + 60 = 12:00, touching but not overlapping) while 11:15,
11:30 and 11:45 disappear because they would run *into* the block. Half-open
intervals are what make that come out right without any special-casing.

**Revisit if** turnaround/cleanup time becomes a requirement. It would be a
per-service or per-location `bufferMinutes` added to the candidate interval's
end — a contained change, precisely because the overlap logic is in one place.

### 12.4 Booking is against a location, not a staff member

There is no staff model and none was built. A location is the bookable resource,
and its capacity is one appointment at a time.

~~**Implication, stated plainly:** a salon with four chairs currently models as
four *locations*, or accepts that only one customer can book any given slot.~~
**Partly resolved in §16.4:** `Location.capacity` now allows N concurrent
appointments, so the four-chair salon is one location with `capacity: 4`. What
remains unbuilt is *per-staff* calendars — capacity counts interchangeable units
of service, not named people, so "book me with Grace specifically" is still not
expressible.

### 12.5 The Appointment table is a placeholder

`Appointment` did not exist, and availability cannot subtract booked time
without it. Added with the minimum: `locationId`, nullable `serviceId`,
`startTime`, `endTime`, `status` (`BOOKED` / `CANCELLED`), `createdAt`.

**~~This is a placeholder and the real Appointment module (module 4) is next.~~
Superseded — the real model landed in §16.5.**
It will **extend this table, not replace it** — adding the customer relation,
the deposit and platform-fee columns from §2, the full status lifecycle
(`PENDING_PAYMENT`, `CONFIRMED`, `COMPLETED`, `NO_SHOW`, cancellation variants
that decide who keeps the deposit), and the business's direct date/time edit
from §5. The columns present today are the ones availability reads, and they are
expected to survive that migration unchanged.

**There is no endpoint that writes to this table**, deliberately — booking is
module 4's job. Availability only ever reads it. The test data for appointment
subtraction was inserted with SQL for exactly this reason.

### 12.6 Decisions the spec did not settle

Three judgment calls, flagged so they can be overruled cheaply.

**Timezone — `PLATFORM_TIMEZONE`, default `Africa/Juba`.** This one was
unavoidable: `LocationHours` stores wall-clock strings (`"08:30"`) while
`Appointment.startTime` is an absolute `DateTime`, and subtracting one from the
other is meaningless without knowing which zone "08:30" is in. Platform-wide for
MVP since every business is in one market; it becomes a `Location` column the
day the platform crosses a border, and `AvailabilityService` has exactly one
line to change. Conversion goes through `Intl` with the platform tz database
rather than a hardcoded `+2`, and resolves the offset twice so it stays correct
across a DST boundary — verified against Europe/London's 2026 spring-forward,
even though Africa/Juba has no DST today.

**Past slots are excluded — a 7th rule beyond the six specified.** A public
endpoint offering 09:00 when it is already 15:00 is offering something
un-bookable. Verified live: at 21:19 Juba time the first offered slot was 21:30.
Called out because it is an addition, not something the six steps asked for —
easy to remove if unwanted.

~~**The public endpoint does not filter on `BusinessStatus`.**~~ **Superseded —
resolved in §13.2.** The endpoint now serves non-APPROVED locations only to
their owner, and 404s for everyone else. The reasoning that made it worth
deferring — a PENDING business needs to preview its own hours — turned out to be
satisfiable *and* safe at the same time, once the caller's identity was
available on the route.

### 12.7 Write-side semantics

- **`POST .../schedule-exceptions` upserts.** One exception per location per
  date is a database constraint, and setting one twice plainly means "change
  it". Rejecting with a 409 would force the frontend into a read-modify-write
  for what is conceptually one action. Flipping a custom-hours exception to
  closed explicitly nulls the old times rather than leaving them behind.
- **An exception must actually be exceptional.** Not closed and no custom hours
  is rejected — such a row says nothing, and storing it would make the exception
  table lie about which dates differ from the template.
- **Overlapping time blocks are allowed.** Two overlapping blocks remove exactly
  the same time as one merged block, so rejecting them would be pedantry that
  costs a retry for no benefit.
- **Dates are `@db.Date`**, not `DateTime` — a calendar day carries no time and
  no offset. The API speaks `"YYYY-MM-DD"` in both directions, and `2026-02-30`
  is rejected rather than silently rolling into March.
- `BusinessAccessService` is reused from §10 rather than reimplemented, so there
  is exactly one definition of "this location belongs to this caller".

### 12.8 Endpoints added

| Method | Path | Auth |
|---|---|---|
| GET | `/locations/:id/availability?date=&durationMinutes=` | **public** |
| POST / GET | `/business/locations/:id/schedule-exceptions` | business + ownership |
| DELETE | `/business/locations/:id/schedule-exceptions/:exceptionId` | business + ownership |
| POST / GET | `/business/locations/:id/time-blocks` | business + ownership |
| DELETE | `/business/locations/:id/time-blocks/:blockId` | business + ownership |

`durationMinutes` is optional, defaulting to 15 — a caller who has not yet
picked a service still wants the shape of the day, and the grid unit yields the
most permissive honest answer.

### 12.9 Verified end-to-end (2026-08-29)

Live server, curl, fixture of Mon–Fri 09:00–17:00 / Sat 10:00–14:00 / Sun
closed. Time helpers unit-checked separately before any endpoint was called.

Confirmed: 32 slots on a normal weekday, all on the 15-minute grid with no
irregular gaps; Sunday empty via `CLOSED_TEMPLATE`; Saturday's different hours;
the fit rule exact across six durations; a 5-hour service on a 4-hour Saturday
yielding nothing; full-day closed exception emptying a working day; custom-hours
exception shifting the grid to 12:00–15:45; upsert replacing rather than
duplicating; delete restoring the template; a 12:00–14:00 block removing
11:15–13:45 for a 60-minute service while 11:00 and 14:00 survive; multiple
blocks; block deletion restoring slots; a `BOOKED` appointment at 08:00Z
correctly removing 10:00–10:45 local; `CANCELLED` not consuming capacity; an
appointment spanning midnight blocking only the part landing on the queried
date; template-closed beating a custom-hours exception; past slots excluded; and
all seven cross-business attempts returning 404 with the victim's data intact.

### 12.10 Still open

- ~~**Capacity is hardcoded at one appointment per location** (see §12.4).~~
  **Done in §16.4.** Per-staff calendars remain unbuilt.
- ~~**Approval-status filtering on the public availability endpoint** must be
  settled before booking ships (see §12.6).~~ **Done in §13.2.**
- **Overnight hours** are still unsupported anywhere — `LocationHours`,
  exceptions and blocks all require close later than open. A 24-hour or
  past-midnight business needs a deliberate model change.
- **No availability endpoint takes a `serviceId`.** Callers pass
  `durationMinutes` themselves, which means the frontend must look the service
  up first. Accepting `serviceId` and reading the duration server-side would be
  a small, obvious improvement once booking exists.
- The §11 open item (no request cap on the role-conflict check) is unchanged.

---

## 13. Availability fixes — exception precedence and public status filtering (2026-08-29)

Two contained corrections to §12, both closing items that section had flagged
rather than solved. Nothing else in the availability module changed.

### 13.1 Exceptions are now checked before the weekly template

**The bug.** `getAvailability()` read `LocationHours` first and returned an
empty list the moment the weekly template called that weekday closed — without
ever looking at `LocationScheduleException`. A business normally shut on Sundays
could therefore never open one. The exception row saved fine, listed fine, and
did nothing, which is the worst shape a bug can take: silent, with the UI
showing the business a setting that has no effect.

**The fix.** The exception for the exact date is consulted first and outranks
the template outright:

- `isClosed: true` → empty, regardless of what the template says.
- custom hours set → those hours become the day's hours, **even when the
  template calls that weekday closed**.
- no exception → fall back to the template's own open/closed state.

Both rows are now fetched in a single parallel round trip rather than
sequentially, since the exception decides whether the template matters at all.

One defensive branch worth noting: an exception that is neither closed nor
carries custom hours falls through to the template while keeping its `reason`.
Write-side validation rejects that shape (§12.7), so it is unreachable through
the API — it exists so a row edited directly in the database annotates a date
without silently blanking its hours.

**Verified.** A location with Sunday closed in its template plus a
10:00–14:00 exception on 2026-09-13 returned **16 slots** (`source: EXCEPTION`),
where the same request returned 0 before the change. The fit rule still applies
within the overridden window — a 60-minute service on that Sunday stops at 13:00.

All four other precedence paths were re-checked and are unchanged: a
closed-exception on a normally-open Monday still empties it
(`CLOSED_EXCEPTION`); a Sunday with no exception is still empty
(`CLOSED_TEMPLATE`); an ordinary Tuesday is still a plain `TEMPLATE` day with 32
slots; and deleting the exception reverts the date to closed.

### 13.2 The availability endpoint now filters on `BusinessStatus`

**The rule**, finally applied where §10.8 always said it belonged:

- **The owning business** sees its own location at any status. A PENDING
  business must be able to preview that its hours produce sensible slots before
  an admin ever reviews it — that was the reason this filter was deferred, and
  it is preserved rather than traded away.
- **Everyone else** — anonymous callers, customers, and rival businesses alike —
  sees a location only when its business is `APPROVED`.
- Non-approved returns **404, not 403**, matching the ownership checks
  everywhere else: the public should not be able to tell an unapproved location
  apart from one that does not exist. Confirmed byte-identical responses for a
  nonexistent uuid and a real-but-PENDING location.

### 13.3 The "optionally authenticated" pattern

Making the above work needed a route that is neither fully public nor fully
protected. `OptionalJwtAuthGuard` (`src/auth/guards/optional-jwt-auth.guard.ts`)
extends Passport's `AuthGuard('jwt')` and overrides `handleRequest` to return
`undefined` instead of throwing. `canActivate` is inherited untouched, so the
JWT strategy still runs and still verifies signature and expiry exactly as
strictly as on a protected route — the *only* behavioural difference is that
failure yields no user rather than a 401.

**The safety property that makes this acceptable: a bad token is treated exactly
like no token.** It can never authenticate anyone, so the worst a forged or
stale token achieves is the public view. Tested directly against the PENDING
location: a token carrying the real owner's `sub` but signed with the wrong key
got 404, and a correctly-signed but *expired* owner token also got 404, while
the genuine owner token got 200. Ownership cannot be claimed by a token the
strategy rejects.

**This is the reusable pattern for public-but-richer-for-the-owner endpoints.**
The gallery and service catalogue are the obvious next candidates: both are
currently business-only, and both will need a customer-facing read that shows
APPROVED media and active services to the public while still letting the owner
preview everything. They should use this guard rather than growing a second
mechanism.

Two rules for anything adopting it:

1. The handler **must** treat `request.user` as possibly undefined and default
   to the public projection. `CurrentUser` is now typed
   `AuthenticatedUser | undefined` to make that visible at the call site.
2. The visibility decision belongs in the **service**, next to the query that
   loads the owning business — not in the controller — so the ownership
   comparison and the row it is comparing against come from one query.

Note the ownership test here compares `businessProfile.userId` to the caller's
id directly, rather than calling `BusinessAccessService.requireBusinessId()`.
That is deliberate: `requireBusinessId` throws `Forbidden` for a non-business
account, which is right for a write path but wrong here — a *customer* holding a
valid token must be treated as an ordinary public caller, not handed a 403.
`BusinessAccessService` remains the single definition of ownership for write
paths.

### 13.4 Regression check

Changing the shared `CurrentUser` decorator touches every authenticated route,
so the whole protected surface was re-tested. All eight strictly-protected
endpoints still return 401 without a token and 401 for a garbage token; the role
guard still returns 403 for a CUSTOMER token on a business route; every one
still returns 200 with a correct token; and cross-business writes still 404.
The optional-auth relaxation is confined to the single route that opts into it.

### 13.5 Explicitly not touched

The §12.4 note — that with no staff model a location's capacity is one
appointment at a time, so a four-chair salon models as four locations — is a
real limitation and stays open until a staff/resource module. Out of scope here.

---

## 14. Multi-person business accounts (2026-08-29)

Replaces the assumption every earlier module was built on — that a business *is*
a user — with an explicit membership table. A business is now a thing several
people work in, each with a role.

### 14.1 What changed structurally

`BusinessProfile.userId` (a `@unique` 1:1 back to `User`) is **gone**. In its
place:

- **`BusinessMembership`** — `userId` (unique), `businessProfileId`, `role`,
  `status`. The single answer to "which business is this person in, and as
  what".
- **`BusinessInvitation`** — `businessProfileId`, `email`, `role`,
  `invitedByUserId`, `status`, `expiresAt` (7 days).

Every earlier meaning of "the user who owns this business" became "any ACTIVE
member of this business", with the OWNER/MANAGER/STAFF distinction layered on
top rather than baked into the lookup.

The blast radius was small because §10 had already funnelled essentially
everything through `BusinessAccessService.requireBusinessId(userId)`. That one
method changed from a `businessProfile.findUnique({ where: { userId } })` to a
membership lookup, and the location/service/gallery/schedule services needed no
edits at all. Only four call sites touched the old relation directly: the auth
signup path, the profile service, `/users/me`, and the availability visibility
check.

**The migration is hand-written and ordered deliberately.** Prisma's generated
diff drops `business_profiles.userId` *before* creating the new tables, which
would silently orphan every existing business — the column is the only record of
who owns what, and dropping it before copying it out destroys the link with no
way to reconstruct it. The committed migration creates the tables, **backfills
every existing `userId` as an ACTIVE OWNER membership**, and only then drops the
column. Verified on the live dev database: the pre-existing business came
through the migration still owned by the same account.

### 14.2 Roles

| | OWNER | MANAGER | STAFF |
|---|---|---|---|
| Read profile, locations, services, hours, gallery, schedule | yes | yes | yes |
| Write those | yes | yes | **no** |
| View member list | yes | yes | yes |
| Invite, remove, change roles, manage invitations | yes | **no** | **no** |

The OWNER/MANAGER line is exactly one thing: **who may change who has access.**
A manager runs the business day to day and can do everything operational; they
cannot alter the membership of the business itself.

**STAFF is deliberately read-only for now.** Their real purpose is managing
bookings, and appointments do not exist yet beyond the §12.5 placeholder. Rather
than guess at permissions for a module that has not been designed, they can see
everything and change nothing. **STAFF permissions will expand when the
Appointment module lands** — that is the point at which "staff can manage the
diary but not the price list" becomes expressible.

Viewing the member list is open to every active member on purpose: seeing who
you work with is not a privilege.

### 14.3 Exactly one OWNER, permanently

Enforced by closing every path rather than by a periodic check:

- Invitations only accept MANAGER or STAFF — validated in the DTO, so OWNER is
  unreachable at the API boundary.
- The role-change endpoint only accepts MANAGER or STAFF, so nobody can be
  promoted into a second owner.
- The owner's own role cannot be changed, and the owner cannot be removed.

The founding signup's OWNER is therefore permanent for MVP. **Ownership transfer
is not built** — it needs a real design (does the old owner become a manager? is
it a two-sided confirmation? what if they have left the company?) and inventing
one here would have been guesswork.

### 14.4 OTP verification *is* invitation acceptance

There is no separate accept endpoint and no accept token. An invited person
simply logs in with the address they were invited at, and the OTP verification
links them.

**Why:** an accept-token flow needs a second email, a second expiry, and a
landing page, and it creates a dead-end state where someone has an account but
has not clicked accept and cannot work. Since the invitation is already keyed by
email and OTP login already proves control of that email, the click adds a step
without adding proof.

The branch in `AuthService.findOrCreateUser` for a new BUSINESS user:

- **Pending, unexpired invitation** → create the user, create the membership
  with the invited role, mark the invitation ACCEPTED. **No new BusinessProfile.**
- **No invitation** → create the user, create a BusinessProfile (PENDING as
  before), and make them its OWNER. This is the original behaviour, preserved
  exactly.

An **expired or revoked** invitation is treated as no invitation, so that person
founds their own business instead. Verified. That is the correct default but is
worth knowing: letting an invitation lapse does not park the person in limbo, it
quietly turns them into their own owner.

### 14.5 One business per person — and where that is enforced

`BusinessMembership.userId` is `@unique`. One person, one business, for MVP.

**The rejection happens at invite time, not at login.** The spec described
rejecting during OTP verification, and that is a real trap: rejecting a login
because of a pending invitation hands any stranger a lockout primitive — invite
the email of a business owner, and their next login fails on an invitation they
never asked for and cannot revoke. Reachable with two invitations.

So the check moved to where it can fail safely. `MembersService.invite()`
refuses upfront when the email already has an active membership (in this
business or any other), already has a pending invitation elsewhere, or belongs
to a non-BUSINESS account that could never complete a business login. Verified:
all four are 409/400 at invite time with distinct messages.

If a membership somehow appears between invitation and login, acceptance is
skipped, a warning is logged, and **the login still succeeds** with the
invitation left pending for the owner to revoke. A person can never be locked
out of their own business by someone else's invitation.

~~**Known consequence of the unique constraint.** It constrains the *row*, not
just active rows, so a REMOVED member still occupies their one slot and cannot
join a different business — permanently, under the current schema.~~
**Superseded — fixed in §15.** The blanket unique is now a partial unique index
covering only ACTIVE rows, so a departed member is free to join another
business while their history stays put. Re-hiring into the *same* business still
reactivates the existing row rather than duplicating it.

### 14.6 The permission guard

`@BusinessRoles(OWNER, MANAGER)` + `BusinessRolesGuard`, sitting on top of the
existing `JwtAuthGuard` + `RolesGuard`. Three distinct questions, three layers:

1. `JwtAuthGuard` — who is calling?
2. `RolesGuard` + `@Roles(BUSINESS)` — is this a business account at all?
3. `BusinessRolesGuard` + `@BusinessRoles(...)` — what are they within their
   business?

The guard does two jobs: it **resolves** the caller's ACTIVE membership (403 if
there is none) and attaches it to the request, then **authorises** against the
declared roles. Resolving there means the handler can take the business id from
`@CurrentBusiness()` instead of re-deriving it, so the permission check and the
handler are guaranteed to be talking about the same membership. It calls
`BusinessAccessService` rather than carrying its own copy of the lookup.

Every endpoint declares its roles explicitly, including read-only ones — an
undeclared handler would default to "any active member", and permissions should
be readable at the method rather than inferred from an absence.

**Roles are read live from the database on every request, never from the JWT.**
Verified: demoting a MANAGER to STAFF revoked their write access immediately,
with their existing token unchanged, and promoting them back restored it. Had
the role been a JWT claim, a demotion would not take effect until the token
expired — which for a removal is exactly the window that matters.

### 14.7 Availability preview follows membership

§13.2 let the *owner* preview a non-APPROVED location's availability. That check
now accepts **any active member**: a manager setting up the schedule needs the
same view of it the owner has. Outsiders and anonymous callers still get 404 for
anything not APPROVED.

### 14.8 Verified end-to-end (2026-08-29)

Live server, curl. Fresh signup still auto-creates a business and makes the
signer its OWNER (`/users/me` shows the membership). OWNER invited a MANAGER and
a STAFF; both joined by ordinary OTP login with **no new BusinessProfile
created** — all three confirmed sharing one business id, and the pending
invitation list emptied as they accepted.

The full permission matrix was exercised across all three roles and 15
endpoints: STAFF reads everything (200) and writes nothing (403); MANAGER writes
everything (200/201) except member management (403); OWNER does everything.

Owner invariants: cannot change own role, cannot be removed, cannot promote
anyone to OWNER, cannot invite an OWNER — all rejected. Soft removal keeps the
row (`status=REMOVED` confirmed in the database) while every business endpoint
returns 403 for that person, including after a fresh login with a valid new
token; their `/users/me` still works, since the account is fine, only the
membership is not.

One-business-per-person: business B inviting A's manager and A's owner both
returned "already linked to another business"; A re-inviting its own member
returned "already a member of your business"; inviting a customer's email was
refused. Cross-business isolation returned 404 on all six data operations and on
both attempts to manage B's memberships by id.

Regressions: anonymous and garbage tokens still 401, CUSTOMER tokens still 403,
`/categories` still public, and the §11 one-email-one-role check still fires.

### 14.9 Deferred

- ~~**Invitation emails are not sent.**~~ **Done in §20.** Invitations are now
  emailed through the notifications channel. Because an invitee usually has no
  account yet, there is no inbox row to write — only a message to send (§20.4).
- ~~**STAFF permissions expand with the Appointment module** (§14.2).~~
  **Done in §16.6:** STAFF can verify, complete and no-show appointments.
- **Ownership transfer** (§14.3).
- ~~**Partial unique index** to free REMOVED members to join elsewhere (§14.5).~~
  **Done in §15.**
- No endpoint lets a member *leave* a business on their own; only an owner can
  remove someone.

---

## 15. Membership uniqueness is now scoped to ACTIVE rows (2026-08-29)

Closes the limitation §14.5 flagged. One contained schema change plus the code
it forced.

### 15.1 The problem

`BusinessMembership.userId` was `@unique` across **every** row. Removal is a
soft delete, so a departed member's REMOVED row kept occupying their one slot
forever — they could never join a different business again. Rejoining the *same*
business always worked, because that path reactivates the existing row rather
than inserting another.

The rule was always "one **active** business per person". The constraint said
"one business per person, ever", which is a different and stricter thing.

### 15.2 The fix: a partial unique index

```sql
CREATE UNIQUE INDEX "business_memberships_active_userId_key"
  ON "business_memberships" ("userId")
  WHERE "status" = 'ACTIVE';
```

Unique across ACTIVE rows, unconstrained across the historical REMOVED ones —
the intended rule, expressed exactly.

A second index was added alongside it, this one expressible in Prisma:

```prisma
@@unique([userId, businessProfileId])
```

At most one row per person per business, whatever its status. This is what
makes the re-hire path unambiguous: a person's history with a given business is
a single row that flips between ACTIVE and REMOVED, so reactivation never has to
choose between duplicates. Without it, the partial index alone would happily
allow several REMOVED rows for the same pairing.

### 15.3 Prisma cannot express a partial index — what that costs

Prisma's schema DSL has no `WHERE` clause for indexes, so the migration is
hand-written, following §14's precedent. The knock-on effects are worth
recording, because **any future "unique only while active" constraint will hit
all three**:

1. **The relation becomes a list.** Prisma infers 1:1 from a `@unique` scalar.
   Dropping it turned `User.businessMembership` into
   `User.businessMemberships[]`, which is semantically correct now — a person
   accumulates REMOVED rows — but it changes every consumer. Three had to be
   updated: the auth acceptance path, the invite eligibility check, and
   `/users/me`.

2. **The API shape had to be defended.** `/users/me` collapses the
   one-element ACTIVE list back to a single `businessMembership` object, so the
   response is unchanged from before the index existed. The list is an artefact
   of how the constraint has to be modelled, not something clients should have
   to know about. Verified: no `businessMemberships` array leaks into the
   response.

3. **The index is invisible to Prisma.** It is created by raw SQL and does not
   appear in `schema.prisma`. Checked after applying: `prisma migrate diff`
   reports **no drift** and does not propose dropping it — Prisma simply cannot
   see it. That is the good outcome, but it is worth a glance whenever a
   generated migration touches this table: nothing in the schema would restore
   the index if a migration ever dropped it. A comment on the model says so.

Every query still goes through `BusinessAccessService.requireActiveMembership`,
which already filtered on `status: ACTIVE`, so the access layer needed no change
at all.

### 15.4 Migration safety

Same care as §14. The migration opens with a guard that counts users holding
more than one ACTIVE membership and raises a named exception if any exist. The
old blanket unique makes that impossible on real data, but `CREATE UNIQUE INDEX`
would otherwise fail with a generic duplicate-key error that says nothing about
why — the guard makes the reason legible if this is ever replayed against a
database that reached this state another way.

### 15.5 Verified end-to-end (2026-08-29)

**A removed member can now join a different business.** A worker joined business
A as STAFF, was removed, and was then invited by business B and joined as
MANAGER — an invitation that returned 409 "previously linked to another
business" before this change. Both rows now coexist: A's as REMOVED, B's as
ACTIVE. They gained write access in B (201 on service creation) and still get
404 against A's data.

**Rejoining the same business still reactivates, not duplicates.** B removed
them and re-invited them as STAFF; on login the *same* row id came back ACTIVE
with the new role, and the total row count stayed at 2.

**One active business at a time still holds.** While ACTIVE in A, an invitation
from B was refused with "already linked to another business". At the database
level, a direct INSERT of a second ACTIVE membership — bypassing the API
entirely — was rejected by `business_memberships_active_userId_key`. The
identical INSERT succeeded once no ACTIVE row remained, leaving a worker with
two REMOVED rows and exactly one ACTIVE across three different businesses.

Regressions checked: `/users/me` shape unchanged, fresh signup still becomes
OWNER of a new business, STAFF still reads (200) and cannot write or invite
(403), owner still cannot be removed or demoted, and cross-business isolation
still returns 404.

### 15.6 Note for future modules

The pattern to reuse when something should be unique **only while active**:

- Drop the blanket `@unique`; add `@@unique([...])` on whatever pairing keeps
  the soft-delete history to one row per subject.
- Add the partial index in a hand-written migration, with a pre-flight guard.
- Expect the Prisma relation to become a list, and filter to the active row at
  every read — including reshaping the API response if the list would otherwise
  leak.

Likely next candidates: a customer's default payment method, and any
"one primary X per Y" rule in the payments or notifications modules.

---

## 16. The Appointment system (2026-08-30)

Module 4. Replaces the §12 placeholder with the real booking lifecycle, and
turns the platform fee from a design note into a live, admin-tunable number.

### 16.1 The state machine

```
                        ┌───────────────────┐
   POST /appointments → │  PENDING_PAYMENT  │
                        └─────────┬─────────┘
                    mark-deposit-paid │            └──── cancel ──→ CANCELLED
                        ┌─────────▼─────────┐
                        │      BOOKED       │──── cancel ──→ CANCELLED
                        └─────────┬─────────┘──── no-show ─→ NO_SHOW
                     verify(code) │                (also automatic, +24h)
                        ┌─────────▼─────────┐
                        │    IN_PROGRESS    │
                        └─────────┬─────────┘
                           complete │  (also automatic, +24h)
                        ┌─────────▼─────────┐
                        │     COMPLETED     │   terminal
                        └───────────────────┘
```

Terminal states are COMPLETED, CANCELLED and NO_SHOW; nothing leaves them.
Every transition is validated against the current status and rejected with a
message naming it, so a client never has to guess why a button did nothing.

Deliberate non-transitions, each tested:

- **No cancel from IN_PROGRESS.** The service is already under way; the honest
  outcomes are completion or a dispute, not cancellation.
- **No no-show from IN_PROGRESS.** A verified code is proof the customer
  arrived, so "they never came" is no longer an available claim.
- **No verify except from BOOKED.** Verifying an unpaid or finished appointment
  means nothing.

### 16.2 COMPLETED requires verification, with no bypass

`complete` accepts **only** IN_PROGRESS, and the sole route into IN_PROGRESS is
entering a 6-digit code emailed to the customer. There is no override, no
force flag, and no admin path.

**Why this is the hard gate:** completion is what the business's money hangs
on. If a business could mark an appointment COMPLETED directly from BOOKED,
"completed" would mean nothing more than "the business said so" — exactly the
self-reporting that §2 built the whole deposit model to avoid. Requiring a
secret only the customer holds makes completion a two-party fact.

The code is generated with `crypto.randomInt`, **bcrypt-hashed** like OTPs, and
never stored raw. Wrong attempts are counted and capped at 5, mirroring OTP
handling, so the code cannot be brute-forced by a business that wants a
completion it did not earn. Attempting to complete from BOOKED returns an error
that says what to do rather than just refusing.

### 16.3 Deposit and fee: percentages of the price, snapshotted at booking

**This supersedes §2's flat platform fee.** The fee is now a percentage of the
service price, held in `PlatformSetting.platformFeePercentage` (default 10.00)
and editable by an admin at runtime. §2's mechanics are otherwise intact: the
fee comes out of the deposit first, and the remainder is the business's.

```
deposit     = round(priceCents × service.depositPercentage  / 100)
platformFee = round(priceCents × platform.feePercentage     / 100)
business    = deposit − platformFee
```

Three decisions worth spelling out:

**Both percentages apply to the same base — the service price.** That is what
makes the rule "a service's `depositPercentage` must be >= the platform fee
percentage" meaningful: it is precisely the condition under which the fee fits
inside the deposit, i.e. `businessAmountCents` can never go negative. At the
floor the two are equal, the business receives **nothing** from the deposit, and
its entire take is the balance settled offline. Tested: a 4500c service at
10%/10% yields deposit 450c, fee 450c, business 0c.

> **Future change (not implemented):** MTN's own transaction fee is absent from
> this split and will eventually be subtracted before it, absorbed by the
> business's share. See §19 — including why the deposit floor rule above has to
> change at the same time.

**`business` is derived by subtraction, not by its own rounded percentage.**
Rounding three values independently would let them disagree by a cent, and the
invariant

```
platformFeeAmountCents + businessAmountCents === depositAmountCents
```

has to hold exactly — it is the ledger line saying who is owed what. Verified
across eleven cases including awkward rounding (999c at 33.33%) and 1c prices.

**All three are snapshotted onto the appointment at booking time.** They are
stored, never recomputed, because every input can move afterwards: an admin can
change the platform fee, and a business can change its price or deposit
percentage at any moment. What the customer agreed to pay, and what the business
is owed, must not silently change underneath them months later when the Payments
module settles up. The arithmetic runs entirely in `Prisma.Decimal` — percentages
are decimals and money is integer cents, and routing either through a JS float is
how a ledger acquires drift nobody can explain.

The deposit floor is validated on **every** service write against the live
setting, never a constant. Verified: with the fee at 10%, a 9.99% deposit is
rejected; after an admin raises the fee to 25%, a 20% deposit that was
previously fine is rejected with a message naming 25.00%, and no redeploy was
involved.

### 16.4 Capacity

`Location.capacity` (Int, default 1) is how many appointments a location can run
at the same instant. Default 1 is exactly the behaviour every location had
before the column existed, and the migration sets it explicitly for existing
rows.

Availability changed from "any overlapping appointment blocks the slot" to
"a slot survives while **fewer than capacity** appointments overlap it".

**Closures are not capacity.** A time block or schedule exception takes the
whole location out of service regardless of capacity — "the owner is away 2–4pm"
does not mean one of four chairs is busy, it means the place is shut. The two
are kept in separate lists in `collectUnavailability` precisely so this cannot
be blurred. Verified: a capacity-3 location with a 14:00–15:00 block offers no
14:00 slot at all.

**Which statuses consume capacity** — `CAPACITY_CONSUMING_STATUSES`:
PENDING_PAYMENT, BOOKED, IN_PROGRESS, COMPLETED. CANCELLED and NO_SHOW do not,
extending §12's "CANCELLED hands its time back" rule to no-shows for the same
reason: neither appointment happened.

**PENDING_PAYMENT is included, which the spec for this module did not ask for.**
Excluding it would let any number of customers each hold a PENDING_PAYMENT
booking for the same slot and then all pay, overbooking the location past its
capacity — the exact thing capacity exists to prevent. The cost is that an
abandoned booking holds a slot until someone cancels it; the fix is a
payment-expiry sweep, which landed in §17.4. Reverting this is
a one-line change to that array if the trade is judged the other way.

Booking runs inside a transaction holding a **Postgres advisory lock on the
location** (`pg_advisory_xact_lock`). Without it, two customers checking the last
slot simultaneously would both see it free and both insert — a plain
check-then-act race. The lock serialises bookings per location so the second
caller's capacity check runs after the first has committed.

### 16.5 The real Appointment model

Replaces the §12 placeholder. `serviceId` is now required and `onDelete:
Restrict` (services are soft-deleted precisely so a booked appointment always
resolves), `customerId` is new, and the money, verification and transition-
timestamp columns are added.

The migration is **split in two** and hand-written. Postgres permits
`ALTER TYPE ... ADD VALUE` inside a transaction but forbids *using* the new
value in that same transaction, and Prisma wraps each migration in one — so
adding `PENDING_PAYMENT` and then setting it as a column default in one
migration fails with "unsafe use of new value of enum type". The enum values get
their own migration, hence their own transaction. The second migration opens
with a guard that aborts if the placeholder table is not empty, since the new
NOT NULL columns have no defaults and could not be backfilled.

Separate `completedAt` / `cancelledAt` / `noShowAt` columns rather than one
generic timestamp: the auto-transition job and any later audit need to know
*which* clock started when, and `updatedAt` is overwritten by every write.

### 16.6 STAFF finally has a job

§14 left STAFF read-only because the thing they actually do did not exist yet.
It does now: **STAFF can verify, complete and mark no-show**, alongside OWNER
and MANAGER.

That is the receptionist's work, and none of it changes the business's
configuration — which is what the OWNER/MANAGER line protects. Verified: STAFF
successfully verified and completed an appointment while still getting 403 on
creating services, changing capacity and inviting members.

### 16.7 `mark-deposit-paid` is a temporary seam — ~~temporary~~ REMOVED in §17

`POST /appointments/:id/mark-deposit-paid` flips PENDING_PAYMENT → BOOKED and
**takes no money**. It exists only so the rest of the lifecycle could be built
and tested before the Payments module lands.

It is restricted to the appointment's own customer, so it at least cannot be
triggered by anyone else, and it logs a warning on every call saying no payment
was taken.

**Resolved in §17.** The endpoint is **deleted**, not deprecated, and replaced
by `POST /appointments/:id/initiate-deposit-payment`. The prediction held: the
seam was exactly one transition wide, and nothing else in the lifecycle changed.

### 16.8 The auto-transition job

`@nestjs/schedule`, every 15 minutes. Two sweeps, both keyed on
`endTime + 24 hours` having passed:

- IN_PROGRESS → **COMPLETED** (`completedAt` set)
- BOOKED → **NO_SHOW** (`noShowAt` set)

**Why it must exist:** businesses forget to press buttons. Without it an
appointment verified on Monday sits IN_PROGRESS forever and one the customer
skipped sits BOOKED forever, so every earnings figure built on status is wrong
and Payments cannot tell what it owes.

**Why 24 hours makes each inference safe:** a full day after the appointment
ended, a verified one plainly did happen and an unverified one plainly did not.
Both transitions preserve the manual meaning exactly, and — importantly — the
job **never** turns a BOOKED into a COMPLETED, so §16.2's no-completion-without-
verification rule holds on the automated path too.

Each transition is logged individually with appointment id, location, both
statuses and the end time. Batch-updating would be faster; "12 rows updated" is
useless when someone disputes one appointment months later.

Verified against seeded rows: IN_PROGRESS ended 25h ago → COMPLETED, BOOKED
ended 30h ago → NO_SHOW, while IN_PROGRESS at 2h, BOOKED at 10h and a
PENDING_PAYMENT at 40h were all correctly left alone.

### 16.9 Endpoints added

| Method | Path | Who |
|---|---|---|
| GET / PATCH | `/admin/settings/platform-fee` | ADMIN |
| PATCH | `/business/locations/:id/capacity` | OWNER, MANAGER |
| POST | `/appointments` | CUSTOMER |
| POST | `/appointments/:id/mark-deposit-paid` | the booking CUSTOMER (temporary) |
| POST | `/business/appointments/:id/verify` | OWNER, MANAGER, STAFF |
| POST | `/business/appointments/:id/complete` | OWNER, MANAGER, STAFF |
| POST | `/business/appointments/:id/no-show` | OWNER, MANAGER, STAFF |
| POST | `/appointments/:id/cancel` | the customer, or any active business member |
| GET | `/appointments` | customer sees own; business member sees the business's |
| GET | `/appointments/:id` | either participant |

`GET /appointments` filters by `status`, `from` and `to`, and paginates with
`limit`/`offset`, returning `total` alongside the page.

The admin endpoints are protected correctly but **there is no admin portal** —
per §3 an ADMIN account cannot be created through the auth flow at all, so
reaching them today requires a manually seeded user. The UI is a future module;
the point of building these now is that the platform fee is a live database
value rather than a constant baked into a deploy.

### 16.10 Verified end-to-end (2026-08-30)

Money math unit-checked first across eleven cases — invariant held in all,
including 999c at 33.33% and 1c prices.

Live curl: admin gating (customer/business/anonymous all refused, seeded admin
allowed); the deposit floor rejecting 9.99% and 5%, accepting exactly 10% and
20%, then tracking an admin change to 25% and back with no redeploy; booking
producing PENDING_PAYMENT with `deposit=900c fee=450c business=450c` on a 4500c
service at 20%, and `450/450/0` at the floor; `endTime` derived server-side;
the verification code appearing in the mail log while the database holds only a
bcrypt hash.

Booking rejections: off-grid start, outside opening hours, in the past, too
close to closing for the service to fit, unknown service, and a BUSINESS token
attempting to book.

Lifecycle: complete refused from PENDING_PAYMENT and from BOOKED (with the
"verify first" message); mark-deposit-paid refused for a different customer and
accepted for the booking customer; wrong codes counting down 4→3→2→1→none and
then locking out on the sixth; the correct code moving BOOKED → IN_PROGRESS with
`verifiedAt` set; no-show and cancel both refused once IN_PROGRESS; complete
succeeding and then refusing a second time.

Capacity: a capacity-2 location took two overlapping bookings and rejected the
third; raising to 3 reopened the slot and admitted a third; a fourth was
rejected; cancelling one and no-showing another handed both units back; and a
time block closed the whole location despite capacity 3.

Isolation: another customer got 404 on GET, cancel and mark-deposit-paid; a
rival business got 404 on verify, complete, no-show and GET; both legitimate
parties got 200; and a rival's list returned `total=0`.

### 16.11 Deferred

- ~~**Real payment capture** replaces §16.7's seam — the next module.~~ **Done in §17.**
- ~~**A payment-expiry sweep** to release abandoned PENDING_PAYMENT holds
  (§16.4).~~ **Done in §17.4** — the 5-minute rule.
- **No refund or forfeit accounting.** §2 says the deposit is non-refundable on
  cancellation; cancelling currently just sets a status and moves no money.
- **Per-staff calendars** (§16.4) — capacity counts interchangeable units, so
  "book me with Grace" is still not expressible.
- **No rescheduling endpoint.** §5 says a business may edit an appointment's
  date/time directly; that edit is not built, and would need to re-run the same
  availability and capacity checks booking does.
- **No admin portal** for the settings endpoints (§16.9).
- ~~**No customer-facing notification** on cancellation or no-show; only the
  booking email exists.~~ **Done in §20.**

---

## 17. Payments — deposits via MTN MoMo (2026-08-30)

Module 5. Replaces §16.7's `mark-deposit-paid` stand-in with real money
movement, and finally builds the 5-minute PENDING_PAYMENT expiry that §16 left
open.

### 17.1 A swappable PaymentProvider, not an MTN integration

Everything the booking flow touches goes through a two-method
`PaymentProvider` interface — `initiatePayment` and `checkPaymentStatus`.
`MomoPaymentProvider` implements it; `AppointmentsService` and the polling jobs
inject the `PAYMENT_PROVIDER` token and never name MTN.

Same reasoning as StorageService's R2/local-disk split (§10.6): the caller
states *what* it needs and knows nothing about who fulfils it. Adding NilPay, or
pointing at a different MTN environment, means writing one class and adding one
case to the factory in `payments.module.ts`. Nothing in the appointment code
changes.

The interface is deliberately narrow. Refunds, payouts and balance queries are
not on it, because each raises provider-specific questions that deserve their
own design rather than a guessed-at method signature now.

**Provider differences are absorbed at the boundary.** MTN distinguishes
`FAILED`, `REJECTED`, `TIMEOUT` and `EXPIRED`; to the booking flow those are one
event — no money arrived, let the customer retry — so they collapse into a
single `FAILED`, with the specific reason preserved for logs and support. A
future provider with its own vocabulary maps into the same three outcomes.

### 17.2 MTN MoMo Collections

**Sandbox provisioning is a script, not a startup check.** `npm run
momo:provision` creates the sandbox API user (`POST /v1_0/apiuser` with a
self-generated UUID) and its API key (`POST /v1_0/apiuser/{id}/apikey`), then
verifies the pair by fetching a token before printing them. Run once per sandbox
account; the values go in `.env` as `MOMO_API_USER` / `MOMO_API_KEY` and **do not
expire** — regenerate only if the sandbox account is reset. Running it again
creates a *second, separate* user rather than rotating the first, so it refuses
to run when both values are already set.

These two endpoints are **sandbox-only**; MTN issues credentials directly for
production, so there is no production equivalent of this script. Something that
mints credentials should never fire as a side effect of booting a server, which
is why it is not a startup check.

**Access tokens are cached.** `POST /collection/token/` with Basic auth returns
a token valid for 3600s. It is held in memory and refreshed on demand, with a
60-second safety margin so a token cannot expire in flight and surface as a
spurious 401 on an otherwise good payment.

**request-to-pay is asynchronous.** `POST /collection/v1_0/requesttopay` returns
**202 Accepted**, which means "the customer's handset will be prompted" — not
"the money moved". The caller supplies `X-Reference-Id` (a UUID we generate),
and that is what `GET /collection/v1_0/requesttopay/{id}` is keyed on, so it is
stored on the appointment as `paymentProviderReferenceId`.

Amounts go over the wire as major units (`"9.00"`), converted from our integer
cents at exactly one place. Dividing an integer by 100 and fixing to 2dp cannot
lose a cent.

**Currency is EUR, and that is a sandbox constraint, not a decision.** MTN's
sandbox only accepts EUR.

~~It is a single env var (`MOMO_CURRENCY`), so the change is configuration, but
note the knock-on: `Service.priceCents` and the deposit maths are
currency-agnostic integers today, and nothing in the system records *which*
currency a stored amount is in.~~ **Resolved in §18.** Amounts now carry an
explicit currency, the internal unit of account is USD, and conversion happens
at charge time against an admin-set rate. `MOMO_CURRENCY` is gone — the provider
currency lives in `PlatformSetting`.

**Which currency MTN South Sudan actually requires in production remains
open** — see §18.5.

### 17.3 Polling, not callbacks

MTN supports a `providerCallbackHost`, and this integration deliberately does not
use it. Two reasons: sandbox callback delivery is unreliable, and a callback
endpoint has to be publicly reachable, which a local dev backend is not. Polling
behaves identically in both environments and needs no tunnel.

Two poll paths, sharing one implementation:

- **`PaymentsScheduler.pollPendingPayments`**, every 20 seconds, asks the
  provider about every appointment that has a reference and is still
  PENDING_PAYMENT. Fast enough that a customer approving a prompt sees the
  booking confirm while still looking at the screen.
- **`GET /appointments/:id/payment-status`** queries the provider *directly* on
  request, so a frontend polling it is not gated on the background job's cycle.

Both funnel into `AppointmentsService.applyPaymentResult`, so there is exactly
one definition of what a payment outcome does to an appointment. Its updates are
conditional (`updateMany` scoped to status *and* reference), so if the two race,
the loser writes nothing rather than overwriting the winner.

**On SUCCESSFUL** the appointment becomes BOOKED. **On FAILED** it stays
PENDING_PAYMENT and the reference is **cleared**, because a failed MoMo reference
cannot be retried at the provider — keeping it would strand the appointment
until it expired. Clearing it lets the customer immediately call
`initiate-deposit-payment` again.

**A second initiation is refused while one is in flight.** Two request-to-pay
calls for one appointment means two prompts on the customer's phone and, if they
approve both, two debits for one booking.

**An unrecognised provider status is treated as PENDING, never FAILED.** Guessing
"failed" on a state we do not understand risks releasing a slot for a payment
that actually succeeded, leaving a customer charged for an appointment they no
longer have. Pending is safe because the expiry sweep bounds how long it lasts.
This is not hypothetical — see §17.6.

### 17.4 The 5-minute PENDING_PAYMENT expiry

`PaymentsScheduler.expirePendingPayments`, every minute: any appointment still
PENDING_PAYMENT more than 5 minutes after `createdAt` becomes CANCELLED with
`cancelledAt` set.

Five minutes is roughly how long someone takes to find their phone and approve a
prompt, and it bounds how long an unpaid booking can squat on a slot. This
matters *because* PENDING_PAYMENT consumes capacity (§16.4): without it, one
abandoned checkout holds a slot forever.

**Integration with capacity is automatic, by design.** CANCELLED is not a
capacity-consuming status, so the slot is released the instant the sweep runs —
no separate bookkeeping, and the next availability query simply counts one fewer
overlapping appointment. Verified: a capacity-1 slot was unbookable while
PENDING_PAYMENT and bookable by a second customer immediately after expiry.

**The rescue branch.** An appointment with a payment still in flight gets a
**final status check before being cancelled**, and is BOOKED instead if that
check comes back SUCCESSFUL. Cancelling something the provider is about to
confirm would take the customer's money and give them no appointment — the worst
outcome this module can produce, and the one most likely to go unnoticed because
both halves look locally correct. If the provider cannot be reached at all, the
appointment is left alone for the next sweep rather than cancelled on incomplete
information.

### 17.5 Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/appointments/:id/initiate-deposit-payment` | booking CUSTOMER | body `{ phoneNumber }`, MSISDN digits only |
| GET | `/appointments/:id/payment-status` | either participant | queries the provider live |
| ~~POST~~ | ~~`/appointments/:id/mark-deposit-paid`~~ | — | **removed** |

The seam is deleted rather than deprecated: leaving a no-payment path alongside
a real one is exactly the kind of thing that survives into production.

### 17.6 Verified against the real MTN sandbox (2026-08-30)

No mocks. Real provisioning, real tokens, real request-to-pay.

**Sandbox test numbers, determined empirically** rather than taken on trust —
MTN's testing page is JS-gated and the community guidance is only that "any
number not on the test list always returns SUCCESSFUL". Probing the live API:

| MSISDN | POST | status | reason |
|---|---|---|---|
| 46733123450 | 202 | FAILED | INTERNAL_PROCESSING_ERROR |
| 46733123451 | 202 | FAILED | APPROVAL_REJECTED |
| 46733123452 | 202 | FAILED | EXPIRED |
| 46733123453 | 202 | PENDING | — |
| 46733123454 | 202 | **CREATED** | — |
| 260962217114 | 202 | SUCCESSFUL | — |

**That probe caught a real bug.** MTN returns a `CREATED` status that appears in
none of the documentation consulted, and the original `switch` had it falling
through `default:` to FAILED — which would have failed live, in-flight payments
whose customers were about to approve them. `CREATED` is now handled as
in-flight alongside `PENDING`, and the unknown-status default was inverted from
FAILED to PENDING for the reason in §17.3.

End-to-end, against the sandbox: token obtained (3600s); request-to-pay accepted
(202) for a 900c deposit as `amount: "9.00" EUR` with the MSISDN masked in logs;
the appointment correctly staying PENDING_PAYMENT on a 202; the poll confirming
and moving it to BOOKED; all three MTN failure reasons surfacing through the
abstraction as FAILED with the reason preserved; the reference cleared on failure
and a retry with a good number succeeding; expiry cancelling an unpaid booking
and freeing capacity for another customer; the rescue branch returning
`{cancelled: 0, rescued: 1}` with the appointment BOOKED and `cancelledAt` null;
and the TTL restored to 5 minutes and re-verified in both directions — untouched
at 75 seconds, cancelled once aged past five minutes.

Isolation: another customer got 404 initiating payment or reading payment-status
on someone else's appointment; a BUSINESS token got 403 (initiation is
customer-only); no token got 401; the owning customer and the business member
both got 200 on their permitted calls.

### 17.7 Deferred

- ~~**Production currency and target environment** (§17.2).~~ Currency *tracking*
  is done (§18); which currency production needs is still open (§18.5).
- **No ledger.** §2 describes deposit → fee split → business payable, and the
  three amounts are stored per appointment (§16.3), but there is no
  double-entry record of platform revenue or business balances. That is the
  wallet/payout module.
- **No payouts.** Money reaches MTN's collection account; nothing moves it to
  businesses.
- **No refunds or forfeit accounting.** §2 says the deposit is non-refundable on
  cancellation; cancelling still just sets a status and moves no money. Note the
  expiry sweep cancels *unpaid* appointments only, so it never forfeits anything.
- **The secondary subscription key is unused.** It exists for rotation; nothing
  reads `MOMO_SUBSCRIPTION_KEY_SECONDARY` yet.
- **No webhook path** (§17.3). Worth revisiting for production, where callbacks
  are reliable and would cut confirmation latency below the 20-second poll.
- **Polling does not back off.** Every in-flight payment is checked every 20
  seconds until it resolves or expires, which is fine at 5-minute maximum
  lifetimes and small volumes, but is a per-payment cost that scales linearly.

---

## 18. Currency tracking — USD as the unit of account (2026-08-30)

Closes the gap §17.2 flagged: amounts were bare integers with no record of what
currency they were in.

### 18.1 USD is the internal unit of account

Every price, deposit and fee is computed and stored in **USD cents**, whatever
currency actually changes hands. Conversion happens once, at the moment of
charging.

**Why not price natively in the local currency:** South Sudan's SSP has run at
roughly **97% annual inflation**. A salon pricing a haircut in SSP would be
repricing its entire catalogue every few weeks, and every historical
appointment, deposit and fee would be denominated in a unit that means something
different each month — making "what did we earn last quarter" unanswerable
without a rate table nobody kept. Holding the platform's own numbers in a stable
unit keeps prices, the fee percentage and all reporting comparable over time,
and confines the volatility to a single conversion at the edge.

The trade is that a business's SSP take varies with the rate between pricing and
payout. That is inherent to pricing in a foreign unit, and it is the more
tractable half of the problem — it moves with the market rather than compounding
into the entire price history.

### 18.2 Currency is stored, never inferred

- `Service.currency` — ISO 4217, default `"USD"`.
- `Appointment.currency` — one field covering `depositAmountCents`,
  `platformFeeAmountCents` and `businessAmountCents`. One rather than three,
  because a deposit, the fee taken from it and the remainder are the same
  currency by construction; three fields could only ever disagree by accident.

Every row reads `"USD"` today, and the columns still earn their place: **an
unlabelled amount is unambiguous only while exactly one currency has ever
existed, and that property cannot be restored afterwards.** Adding the column
later would mean guessing what old rows meant. Both are backfilled explicitly in
the migration rather than relying on the column default, since the default only
covers rows written after it existed.

Neither field is settable through the API. Nothing downstream could handle a
non-USD service price, and an endpoint that accepted one would be advertising
support that does not exist. The column records the fact; it does not pretend to
offer a choice.

### 18.3 A manual exchange rate, deliberately

`PlatformSetting` gains `providerCurrency`, `exchangeRateUsdToProviderCurrency`
(nullable `Decimal(18,8)`) and `exchangeRateUpdatedAt`, with
`GET`/`PATCH /admin/settings/exchange-rate` behind the same ADMIN gate as the
platform fee.

**Manual, not a live FX feed** — a scope decision, not an oversight. A live feed
means choosing a provider, handling its outages, deciding what happens to a
booking when the rate is unavailable, and auditing what rate applied when. That
is its own module. At MVP volumes an admin setting a rate they can see and
correct is honest and sufficient. **A live feed is a legitimate upgrade once
volume justifies it**, and `exchangeRateUpdatedAt` exists so the cost of *not*
having one is visible: the admin read returns `ageInHours`, so a rate that has
gone stale is obvious at a glance rather than silently wrong.

`Decimal(18,8)` spans both ends of the plausible range — a rate near 1 (USD→EUR)
and one in the thousands (USD→SSP) — without losing precision at either.

The rate is **not cached**, unlike the platform fee. The fee is read on every
booking so caching pays for itself; the rate is read only when a payment is
actually initiated, so a stale value would be a needless risk for no measurable
saving. An admin correcting a wrong rate takes effect on the very next charge.

Omitting `providerCurrency` on a PATCH **keeps the stored value** rather than
resetting it, so a rate can be corrected without restating the currency.

### 18.4 Conversion at charge time, and failing loudly

`initiateDepositPayment` is the one place USD meets the provider's currency:

```
providerCents = round(depositAmountCents × rate)   // HALF_UP, Prisma.Decimal
```

**With no rate configured, payment initiation fails with a clear error and sends
nothing to the provider.** No fallback, no default, no sending the USD figure
labelled as the provider's currency. A wrong amount here is indistinguishable
from a successful payment to everyone involved, so the only acceptable behaviour
is refusal. Verified: with no rate set, the request 400s and MTN receives zero
requests.

A second guard rejects a rate that rounds a real deposit to **zero**, which
would otherwise have the provider collect nothing while the appointment booked
normally.

**Both sides are stored** on the appointment — `providerCurrency`,
`providerCurrencyAmountCents` and `exchangeRateUsed` alongside the USD amounts.
This is for reconciliation: when a provider statement disagrees with our ledger,
the difference can only be *explained* rather than merely observed if the
converted amount and the rate that produced it both survive. A later rate change
does not touch an already-charged appointment — verified.

One assumption stated in the code: both currencies use two decimal places. True
for USD, EUR and SSP; a zero-decimal currency (JPY) or three-decimal one (KWD)
would need a per-currency minor-unit exponent, which is not modelled.

### 18.5 Still open — confirm during production onboarding

- **Does MTN South Sudan require SSP, or does it support USD-denominated
  collections directly?** If USD is supported the conversion layer stays but the
  rate becomes 1.0 and the whole question of FX drift disappears. If SSP is
  required, the manual rate becomes load-bearing and a live feed moves up the
  priority list. Not answerable from the sandbox.
- **MTN's own transaction fee.** Worth flagging honestly: *no MTN transaction fee
  was ever documented in §17* — the integration was built and tested without one
  appearing, and the sandbox does not charge. But MTN certainly charges something
  on live collections, and it is **not currently modelled anywhere**: the deposit
  split in §16.3 divides the deposit between platform fee and business with no
  provider cut taken out first. ~~Whatever MTN charges will come out of one of
  those two, and which one is a commercial decision, not a technical one.~~
  **Who absorbs it is now decided — see §19.** The percentage itself is still
  unconfirmed, and must be obtained in the same MTN conversation as the
  SSP-vs-USD question above.
- **Multi-currency pricing** is not supported, only recorded. A business cannot
  price in anything but USD.

### 18.6 A crash found while testing

Setting a rate of `0.0000001` returned a **500**, not a validation error.
class-validator's `@IsNumber({ maxDecimalPlaces })` is effectively
`value.toString().split('.')[1].length`, and `(0.0000001).toString()` is
`"1e-7"` — no `"."`, so the split yields `undefined` and reading `.length`
throws. Any number below 1e-6 triggers it.

**The same pattern was present in two other DTOs** — `platformFeePercentage` and
`Service.depositPercentage` — so all three were 500s waiting on ordinary input.
Replaced with a `@MaxDecimalPlaces()` decorator that measures scale via
`Prisma.Decimal`, which parses exponent notation correctly and is the type these
values are stored and multiplied as anyway. All three now return clean 400s.

This is also why the first zero-conversion test was invalid: the PATCH that was
supposed to set a tiny rate had 500'd, leaving `SSP @ 6600` in place, so the
request that followed was rejected by MTN for an unsupported currency rather
than by the zero guard. Re-tested after the fix, with the guard firing and zero
requests reaching MTN.

### 18.7 Verified end-to-end (2026-08-30)

Conversion unit-checked across ten cases including a USD→SSP-scale rate
(`900 × 6500 = 5,850,000`) and half-up boundaries.

Live, against the real MTN sandbox: no rate configured → 400 with zero
request-to-pay calls; rate set to `0.92` via the admin endpoint; a 900 USD-cent
deposit charged as **`amount: "8.28", currency: "EUR"`** — confirmed by querying
**MTN's own transaction record**, which returned `financialTransactionId
2083834372`, `8.28 EUR`, `SUCCESSFUL`; the appointment storing `900 USD` and
`828 EUR @ 0.92000000` side by side; a later change to `0.75` leaving that
snapshot untouched; the zero-conversion guard blocking a `0.0000001` rate before
any provider call; ADMIN gating (403 for customer, 401 anonymous); rate and
currency validation including the exponent-notation case; and omitting
`providerCurrency` preserving a stored `SSP` rather than resetting it to `EUR`.

---

## 19. Who absorbs MTN's transaction fee (2026-08-30)

**Status: DECIDED, NOT IMPLEMENTED.** Recording a decision taken in conversation
that was never written down. No code changed for this entry.

### 19.1 The decision

**The platform fee is always fully protected. MTN's transaction fee on
collections is absorbed by the BUSINESS's share of the deposit.**

`platformFeePercentage` (§16.3) is what the platform actually receives, not a
figure the provider's cut is later taken out of.

**Why:** this mirrors how card-processing fees are normally handled — a standard
cost of accepting digital payments, borne by the party receiving the money. The
alternative, netting the provider fee out of the platform's share, would make
platform revenue depend on a number MTN controls and can change, so the
platform's own pricing would silently drift every time the provider adjusted its
rate.

### 19.2 What is still unknown

**MTN's actual transaction fee percentage is unconfirmed.** It is not in MTN's
sandbox (which charges nothing) and was never documented during §17. It has to
come directly from MTN during production onboarding.

**Both open MTN questions must be settled in the same conversation**, because
the answers interact:

1. **This one** — the transaction fee percentage, and whether it is a flat
   percentage, a tiered rate, or has a per-transaction floor or cap.
2. **§18.5** — whether MTN South Sudan requires SSP or supports USD-denominated
   collections directly.

They interact because a provider fee charged in SSP against a deposit priced in
USD has to be converted before it can be subtracted, which means the fee
calculation depends on the exchange-rate machinery from §18 — and on whether
that machinery is load-bearing at all or is sitting at a rate of 1.0.

### 19.3 Until then, nothing changes

§16.3's split is **unchanged and stays that way**: the deposit is divided between
platform fee and business share with no provider cut modelled. That is the
correct behaviour while the real percentage is unknown — a placeholder rate
would produce numbers that look authoritative and are wrong, which is worse than
a gap everyone can see.

### 19.4 The shape of the fix, when the rate is confirmed

One more subtraction ahead of the existing split:

```
providerFee = round(deposit × providerFeePercentage)   // MTN's cut
platformFee = the platform's share, taken from what remains
business    = deposit − providerFee − platformFee
```

Structurally the same as the currency conversion already built in §18.4: a
value read live from `PlatformSetting`, applied at one point, with the resulting
amounts snapshotted onto the appointment so a later rate change never alters a
completed booking. It should get a stored `providerFeeAmountCents` on
`Appointment` for the same reconciliation reason as `providerCurrencyAmountCents`
(§18.4), and the §16.3 invariant becomes:

```
providerFeeAmountCents + platformFeeAmountCents + businessAmountCents
    === depositAmountCents
```

**One consequence that is easy to miss.** §16.3's deposit floor rule —
`depositPercentage >= platformFeePercentage`, enforced in
`ServicesService.assertDepositCoversPlatformFee` — exists precisely to guarantee
`businessAmountCents` can never go negative. It stops guaranteeing that the
moment a third subtraction is added. At the floor the two percentages are equal
and the business already receives **exactly zero** from the deposit (a 4500c
service at 10%/10% gives deposit 450c, fee 450c, business 0c), so subtracting
any provider fee at all pushes it below zero.

The floor therefore has to become:

```
depositPercentage >= platformFeePercentage + providerFeePercentage
```

and existing services sitting at the old floor will fail that check — so
implementing this needs a migration plan for them (raise their deposit
percentage, or grandfather them), not just a change to the validator. Worth
knowing before the work is scoped, because it turns a one-line arithmetic change
into a data-migration conversation.

---

## 20. Notifications (2026-08-31)

Module 6, built ahead of Chat.

### 20.1 Why this jumped the queue

`MailService` had exactly two methods: the OTP, and the customer's booking
code. Which meant **a business was never told it had a booking.** The only way
to discover one was to poll `GET /appointments`.

That is a bigger hole than a missing chat. Chat is for negotiating with someone
you already know exists; notifications are what make the appointment loop work
at all. And Chat *depends* on this — a message nobody is told about is half a
feature. §7's order has been corrected rather than followed.

### 20.2 Notifications are stored, not fired and forgotten

A `Notification` row per message, with recipient, type, channel, status,
rendered subject/body, `readAt` and an optional appointment link.

Two reasons for a table rather than a bare `sendMail` call:

- **It is the audit trail.** When a business says nobody told them about a
  booking, the row either exists or it does not — with `sentAt`, `failureCount`
  and `lastError` to say what happened. That question is unanswerable if the
  only record is an SMTP call that already returned.
- **It is the in-app inbox**, so a frontend can list notifications later
  without a schema change.

**Copy is rendered once, at send time, and stored.** Re-rendering on read
against live data would let a later cancellation silently rewrite the message
that announced the booking. The inbox has to show what was actually sent.

The appointment link is `onDelete: SetNull`, not Cascade: a notification is
evidence that something was communicated, and should outlive what it referred
to.

### 20.3 Raising a notification can never break what caused it

`NotificationsService.notify()` **never throws.** A booking, a payment
confirmation or a cancellation is already a fact by the time anyone is told
about it, and none of them should roll back because SMTP was briefly
unreachable. Failures are recorded on the row and retried by a sweep every 5
minutes, giving up after 5 attempts so a permanently bad address is not retried
forever — the row then stays FAILED with its `lastError`, which is what makes
"why didn't they hear?" answerable.

### 20.4 What is sent, and to whom

| Event | Recipient |
|---|---|
| `APPOINTMENT_BOOKED` | every active business member |
| `DEPOSIT_CONFIRMED` | customer **and** business |
| `APPOINTMENT_CANCELLED` | customer **and** business (incl. expiry) |
| `APPOINTMENT_NO_SHOW` | customer |
| `DEPOSIT_FAILED` | customer only |
| `APPOINTMENT_REMINDER` | customer |
| `BUSINESS_INVITATION` | the invitee |

Three deliberate asymmetries:

- **A failed payment goes only to the customer.** It is theirs to retry, and
  the business has nothing to act on until it succeeds.
- **A no-show goes to the customer**, because a forfeited deposit (§2) should
  never be a silent charge someone discovers later.
- **Bookings go to every active member, not just the owner.** Staff run the
  day's appointments (§16.6), so a booking nobody on the floor hears about is
  precisely the failure this module exists to fix. Per-person preferences are a
  later concern.

**Invitations are the one case with no inbox row.** `Notification.recipientId`
is a foreign key to `users`, and the whole point of an invitation is to reach
someone who has not signed up. When there is no account,
`notifyUnregisteredEmail` renders through the same templates and sends through
the same channel, with no row — correct, because there is no inbox to put it
in. This closes §14.9.

### 20.5 Reminders

A sweep every 15 minutes sends a reminder for appointments starting within 24
hours. Every 15 minutes rather than nightly, so an appointment booked *inside*
the window still gets one instead of waiting for a batch that has already run.

Only `BOOKED` and `IN_PROGRESS` qualify — reminding someone about an
appointment they never paid for would be worse than silence.

`Appointment.reminderSentAt` is the dedup marker, and it is **claimed
conditionally before the send**, so two overlapping runs cannot both remind the
same customer. Verified: a second immediate run sent 0.

This is the highest-value notification in the set: `NO_SHOW` currently only
records the damage, and a reminder is the cheapest way to reduce it.

### 20.6 Email now, SMS-ready

`NotificationChannelDriver` mirrors §17's `PaymentProvider` — callers state what
to deliver and know nothing about who delivers it. `EmailNotificationChannel`
is the only implementation; `SMS` already exists in the channel enum.

This matters more than the usual abstraction argument. The platform targets
South Sudan, where SMS reaches people far more reliably than email — a booking
alert landing in an unchecked inbox is not really a notification. The channel
is *expected* to change, and building the seam now is what stops that being a
rewrite across every service that raises a notification. Swapping it is one
class and one case in the factory.

`MailService` gained a generic `sendGenericEmail` for this, which deliberately
does **not** swallow errors the way the OTP and booking-code methods do — a
notification's delivery result has to reach the caller so it can be recorded
and retried.

### 20.7 Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | own inbox; `unreadOnly`, `limit`, `offset`; returns `unread` count |
| PATCH | `/notifications/:id/read` | idempotent |
| PATCH | `/notifications/read-all` | |

Guarded by `JwtAuthGuard` only — customers, business members and admins all
have an inbox, and every query is scoped to the caller's own id inside the
service, so there is nothing role-specific to enforce.

### 20.8 Verified end-to-end (2026-08-31)

Against a live server and Mailhog, with a real MTN sandbox payment driving the
deposit events.

A booking notified the business, with the email delivered and the time rendered
as `10:00` Africa/Juba from an `08:00Z` start. A real sandbox deposit notified
both sides; a rejected one (MSISDN 46733123451) notified only the customer, and
the business's inbox correctly held zero `DEPOSIT_FAILED` rows. Cancelling
notified both with `Reason: Cancelled by the customer.` A no-show notified the
customer. An invitation reached an address with no account, producing an email
and zero notification rows.

Reminders: of three seeded appointments — BOOKED in 6h, BOOKED in 3 days,
PENDING_PAYMENT in 5h — only the first was reminded, and a second run sent 0.
Retry: a row forced to FAILED was recovered on the next sweep
(`{retried: 1, recovered: 1}`).

Inbox: another user marking someone else's notification read got "Notification
not found"; the owner's own succeeded; `unreadOnly` and `read-all` behaved; no
token returned 401.

### 20.9 Deferred

- **SMS is not wired**, only anticipated (§20.6). Needs a provider account and
  has a per-message cost, which matters when deposits are small.
- **No per-user preferences or quiet hours.** Deliberately skipped: there is no
  frontend or admin portal to reach such settings, so they would be API-only
  and untestable by a real user.
- **Every active member gets every booking notification.** Fine at one or two
  staff; a busy salon will want this narrowed, which is the same feature as
  preferences above.
- **No digest or batching.** Ten bookings send ten emails.
- **The reminder lead time is a constant**, not per-business configurable.
- **No notification for `COMPLETED`**, or for the §16.8 auto-transitions —
  arguably a customer should be told their appointment was auto-completed or
  auto-marked a no-show 24h later.

---

## 21. Chat (2026-08-31)

Module 7. In-app messaging between a customer and a business — the channel §5
assumed when it dropped the postponement workflow in favour of "two parties can
settle it in a message".

### 21.1 One Thread model, two shapes

A single `Thread`, distinguished only by whether `appointmentId` is set:

- **set** — tied to a booking, created automatically *with* the appointment.
- **null** — a pre-booking inquiry, created on demand, exactly one per
  (customer, business) pair and reused forever after.

Two tables would have duplicated every message, read-state and permission rule
for a distinction that only matters at creation time. Everything downstream —
posting, listing, unread counts, participation checks — is identical.

**The appointment thread is created inside the booking flow**, not as a separate
customer action. A booking should always have somewhere to talk without anyone
setting that up. It is created best-effort and never throws: a chat thread
failing to materialise must not roll back a booking, the same rule notifications
follow (§20.3).

**The inquiry thread is idempotent.** A customer asking a second question weeks
later lands in the same conversation rather than starting a parallel one the
business has to notice separately. Verified: three consecutive requests returned
the same thread id and left one row.

### 21.2 Two constraints Prisma cannot express

Both are hand-written in the migration, the same way §15 handles membership.

**One inquiry thread per pair** needs a *partial* unique index — the rule
applies only `WHERE appointmentId IS NULL`, because a customer may also have
many appointment-scoped threads with the same business, one per booking:

```sql
CREATE UNIQUE INDEX "threads_inquiry_customer_business_key"
  ON "threads" ("customerId", "businessProfileId")
  WHERE "appointmentId" IS NULL;
```

Enforcing it in the database rather than only in the service is what makes the
race safe: two simultaneous inquiry requests both pass the existence check, and
the loser catches `P2002` and returns the winner's thread. The caller wanted a
thread; one now exists.

Note `appointmentId` itself needs only a plain `@unique` — Postgres treats NULLs
as distinct, so "at most one thread per appointment" and "unconstrained for
inquiries" come free from the same index.

**A message must carry something**, enforced by a CHECK so the rule holds
however a row is inserted, not just through the API:

```sql
CHECK (NULLIF(BTRIM("body"), '') IS NOT NULL OR "photoUrl" IS NOT NULL)
```

`NULLIF(BTRIM(...))` is deliberate: a whitespace-only body is not content. The
service rejects the same case first, with a clear message.

### 21.3 Read state is per person, not per thread

`ThreadReadState` is one row per (thread, user) rather than a flag on the
thread, because a business has several people in it (§14). **An owner glancing
at a message must not silently mark it read for the staff member who actually
has to answer it.** Verified: after the owner marked a thread read, their unread
count went to 0 while the staff member's stayed at 3.

Unread counts also exclude your own messages — nobody has unread mail from
themselves.

### 21.4 Ten new inquiry threads per customer per day

A rolling 24-hour cap on **new** inquiry threads. It exists to stop one account
spraying fresh conversations across many businesses, which is what spam looks
like here.

**Reuse never counts against it.** The limit is on starting relationships, not
on asking questions inside one — a customer at their cap can still message every
business they have already contacted. Verified: the 11th new inquiry was
refused while reopening an existing thread still returned 200.

### 21.5 Notifications are debounced, not suppressed

New messages notify the other side through the §20 infrastructure — no parallel
delivery path. Business-side messages go to every active member, for the same
reason bookings do (§20.4): whoever is on the floor should see it.

At most **one email per thread, per recipient, per 5 minutes**. A back-and-forth
conversation would otherwise produce an email per line, which trains people to
ignore the channel entirely.

The marker is `lastNotifiedAt` on `ThreadReadState` — the key is already exactly
"per thread, per person", so a second table would duplicate it for nothing. It
is **claimed atomically before sending**, with the cutoff inside the `WHERE`
clause of an `updateMany`, so two rapid messages cannot both pass. Same
claim-the-timestamp trick as appointment reminders (§20.5).

Verified: three rapid messages produced **one** notification; ageing the marker
past the window and sending a fourth produced a **second**; the sender received
none for their own messages.

### 21.6 Photos reuse the gallery's storage and limits

`chatUploadOptions` **is** `galleryUploadOptions` — the same object, not a copy.
15MB, jpg/png/webp, memory storage, one file, and `MulterExceptionFilter` for
the same clear oversize error. Uploads go through `StorageService` exactly as
§10.6 does: R2 when configured, the dev-only local fallback otherwise, under a
`chat/<threadId>/` prefix.

Two configs would drift the moment one limit changed, and a customer refused a
20MB photo in a gallery should get the identical refusal attaching it to a
message. Verified: 20MB → 413 with the 15MB message, PDF and GIF → 400 naming
the allowed types, and an uploaded photo served back byte-identical.

### 21.7 Voice notes and video are deliberately out of scope

Not built, and not an oversight.

- **Bandwidth and cost.** Same reasoning as §10's video decision. A voice note
  is orders of magnitude larger than a text message, and mobile data in Juba is
  expensive enough that a chat which quietly burns it is a chat people stop
  using. Storage and egress costs scale the same way.
- **There is no frontend.** Capturing and playing audio is almost entirely a
  client concern — recording UI, waveform, playback, permissions. Building the
  server half now would mean designing an API against a client nobody has
  written, and testing it with `curl` proves only that bytes round-trip.

`Message` carries `body` and `photoUrl`; adding `voiceUrl`/`videoUrl` later is
additive. **Revisit once a frontend exists** and the real cost of a voice note
on a Juba mobile connection can be measured rather than guessed.

### 21.8 Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/threads/inquiry` | CUSTOMER only |
| GET | `/threads` | either side; scoped to the caller |
| GET | `/threads/:id` | participants |
| GET | `/threads/:id/messages` | participants, chronological, paginated |
| POST | `/threads/:id/messages` | participants; multipart, optional photo |
| POST | `/threads/:id/read` | participants |

Inquiry creation is CUSTOMER-only on purpose: a business cold-opening a
conversation with someone who never contacted them would make this an outbound
marketing tool rather than a support channel.

Everything else is guarded by `JwtAuthGuard` alone, with participation enforced
per-thread inside the service by scoping every query to the caller. Non-
participants get **404, not 403** — confirming a thread exists but belongs to
someone else is itself a small leak (§10.7).

### 21.9 Verified end-to-end (2026-08-31)

A booking auto-created its thread with no customer action. Inquiry creation
returned the same id three times over one row. PENDING, REJECTED, SUSPENDED and
a nonexistent business all returned an identical `404 Business not found`. The
10/day cap refused the 11th new inquiry while still returning an existing thread
on reuse. Text-only, photo-only and text+photo all sent; empty and
whitespace-only were refused. 20MB → 413, PDF and GIF → 400. Messages listed in
ascending order and the attachment came back byte-identical. Owner and staff
held independent read state on one thread. Nine isolation probes — another
customer and a rival business reading, posting, and marking read — all returned
404, while both legitimate participants got 200 and the rival's thread list was
empty. Debounce: 3 rapid → 1 notification, 4th past the window → 2, sender → 0.

### 21.10 Deferred

- **Voice and video** (§21.7).
- ~~**No realtime transport.** Messages are polled; there is no WebSocket, so a
  frontend refreshes rather than receives. Fine before a frontend exists, and
  the obvious next step once one does.~~ **Done in §22** — and the stated reason
  for deferring did not survive scrutiny; see §22.1.
- **No editing, deleting or reactions.**
- **No typing indicators or delivery/read receipts** visible to the other side —
  read state is private to each person.
- **No moderation or reporting.** `LocationMedia` has a PENDING/APPROVED status
  (§10) but chat photos are published immediately, which is a gap once the
  platform is public.
- **The debounce window and the 10/day cap are constants**, not
  admin-configurable — unlike the platform fee (§16), which earned a setting.
- **No attachment cleanup.** A photo whose message is deleted has no deletion
  path, since messages cannot be deleted yet.

---

## 22. Realtime chat transport (2026-08-31)

A WebSocket layer **alongside** the §21 REST endpoints. No schema changed, no
endpoint changed, nothing was replaced.

### 22.1 Correcting the deferral

§21.10 deferred this on the grounds that "a WebSocket has nothing to connect to
without a frontend, and its hard parts are shaped by how the client behaves".

**That reasoning does not hold.** Every module in this project has been built
and verified without a frontend, using curl as a stand-in client. The socket
layer is no different: a throwaway `socket.io-client` script exercises it the
same way, and the parts that genuinely need a real client — reconnection
strategy, presence, offline queueing — are exactly the parts deliberately left
out of the gateway (§22.4). What remains is authentication, authorisation and
delivery, all of which are server-side and independently testable.

The honest version: the deferral confused "the client half is unknown" with
"the server half is unknown". Only the first was true.

### 22.2 REST stays the single source of truth

The gateway is **push-only**. There is no `message:send` event.

Creating a message carries real logic — the empty-message rule, the 2000-char
limit, photo upload through StorageService, the gallery's size and type limits,
the `lastMessageAt` update, and the notification debounce. Accepting messages
over a second transport would mean two paths that must agree forever, and they
would drift the first time one changed.

So the split is: **sending is REST, receiving live is socket.** A client POSTs
to `/threads/:id/messages` exactly as before and learns about other people's
messages over the socket.

The emit sits immediately after the message is persisted, next to the existing
`notifyOtherParty` call, so the socket push and the debounced email are
triggered by the same event and neither can fire for a message that was not
saved. It never throws — realtime delivery is a convenience on top of a message
that already exists, the same rule notifications follow (§20.3).

### 22.3 Authentication over the handshake, not the query string

The client connects with the existing access token in socket.io's `auth`
handshake payload. An `Authorization: Bearer` header is also accepted for
clients that cannot set handshake auth.

**A query-string token was rejected outright.** URLs end up in access logs,
proxy logs, referrer headers and browser history, and an access token in any of
those is a credential leak that outlives the connection.

Verification is as strict as `JwtAuthGuard` on the REST side: a missing,
malformed, wrongly-signed or expired token **disconnects** rather than
degrading to an anonymous socket. There is nothing an unauthenticated socket
could usefully subscribe to. The error message does not distinguish expired
from malformed from wrong-signature — that difference is only useful to someone
probing.

### 22.4 Rooms, and what the gateway deliberately does not do

One socket.io room per thread. A client emits `thread:join` after connecting,
and the gateway authorises it by calling **ChatService's own participation
check** — `assertParticipant`, a thin public wrapper over the same
`requireParticipant` the REST endpoints use. One definition of who may see a
thread, not two.

A non-participant gets an explicit error event and is **not** joined. Failing
silently would leave a client believing it is subscribed while quietly missing
every message. The error says `Thread not found.`, matching the REST 404, so
the leak §21.8 avoids does not become observable just because the transport
changed.

**Reconnection and missed-message replay are not the gateway's job.** A client
that reconnects — or opens the app fresh — calls the existing
`GET /threads/:id/messages` to backfill, then relies on the socket for what
arrives after that. Building replay into the gateway would duplicate the
pagination, ordering and participation checks the REST endpoint already gets
right, and would need its own notion of "where was this client up to", which
the client itself knows better.

`thread:read` is offered over the socket because marking read naturally happens
while a socket is already open. It calls the same `ChatService.markRead` as
`POST /threads/:id/read`, so read state cannot diverge between transports.

### 22.5 Events

| Direction | Event | Notes |
|---|---|---|
| server → client | `connected` | after successful auth |
| client → server | `thread:join` | acked; authorised via ChatService |
| client → server | `thread:leave` | |
| client → server | `thread:read` | same logic as the REST endpoint |
| server → client | `message:new` | the created message, pushed to the room |
| server → client | `error` | `{ event, message }` on any failure |

Namespace `/chat`. CORS matches the REST app's permissive setting — tighten
both together before production.

ChatService and ChatGateway reference each other (the gateway asks who may
join; the service asks the gateway to push), resolved with `forwardRef` on both
sides.

### 22.6 Verified end-to-end (2026-08-31)

With `scripts/ws-smoke-test.js`, a `socket.io-client` harness kept in the repo
because it is the only executable check of this layer and curl cannot exercise
it. It drives the REST POST itself, so there is no race between the test and
the shell.

Connection auth — all five cases: no token, garbage, valid-shape/wrong-
signature and correctly-signed-but-expired were each **rejected and
disconnected**; a valid token connected as CUSTOMER.

Rooms: the participant joined; the **non-participant was refused with
`Thread not found.`**; a missing threadId was refused.

Delivery: two messages POSTed over REST by the business arrived on the
customer's socket in real time — `13:50:26.256` POST → `13:50:26.291` received,
about **35ms**. The outsider, connected but never joined, received **0**.
Server logs confirm `Pushing message:new to thread:… (1 socket(s) in room)`.

`thread:read` succeeded for the participant and was refused for the outsider.
Harness exit code 0, which it returns only when the participant got both
messages and the outsider got none.

### 22.7 Deferred

- **No presence or typing indicators.** Both need product decisions about what
  the other side should see, and neither is meaningful without a frontend.
- **No delivery or read receipts pushed to the other party** — read state
  remains private per person (§21.3).
- **Single-node only.** socket.io rooms live in the process's memory, so two
  backend instances would not deliver to each other's clients. Fixing that is
  the Redis adapter, and it should land with whatever else makes this
  horizontally scalable — nothing here is multi-instance safe yet.
- **No socket-side rate limiting.** Message creation is REST and unthrottled
  there too; the inquiry cap (§21.4) is the only chat rate limit.
- **CORS is `*`**, matching the REST app. One decision, to be made once.

---

## 23. Automated test suite (2026-08-31)

Infrastructure, not a module. Nine modules had been verified by hand with curl
and never re-checked afterwards, so every later change risked silently breaking
an earlier one.

### 23.1 Four areas, deliberately not full coverage

Chasing endpoint coverage would produce hundreds of tests asserting that
`@IsString()` rejects a number. These four were chosen because a silent
regression in them is **expensive and invisible**:

1. **The money invariant.** `platformFee + business === deposit`, across a
   spread of prices and percentages including exactly at the fee floor, plus the
   currency conversion from §18. A rounding error here is money, and nobody
   notices for months.
2. **The appointment state machine.** Every transition, legal and illegal. The
   load-bearing one is that COMPLETED is unreachable from BOOKED — verification
   is the only route in (§16.2). A regression there would let a business mark
   work done without the customer ever confirming they arrived, which is what
   the whole deposit model rests on.
3. **Capacity counting.** Including that PENDING_PAYMENT consumes a unit
   (§16.4) — the non-obvious rule that prevents overbooking, and the one most
   likely to be "simplified" by someone who has not read why.
4. **Cross-tenant isolation.** Location, Service, Appointment and Thread. This
   is the class of bug that is silent until it is a disclosure.

Each test is named for the specific rule it guards, so a failure identifies the
broken invariant rather than merely reporting that something is wrong.

### 23.2 A real database, never a mocked Prisma

The invariants above are largely *database* behaviour — a partial unique index
(§15, §21.2), a CHECK constraint, capacity counted across rows. A mocked Prisma
would assert that the mock behaves as written, which is a different claim, and
would have caught none of the bugs found by hand in earlier modules.

**A separate database on the existing Postgres instance**, not a second
container:

- `docker compose up` stays the only manual step. A second compose service is
  one more thing to remember and keep in sync.
- Same server and version, so tests exercise the engine behaviour these modules
  actually depend on.
- Isolation that matters is at the database level: `booking_platform_test`
  shares no tables, rows or sequences with `booking_platform`.

The trade-off — a wrong `DATABASE_URL` could point the suite at dev data — is
closed in `test/setup/env.ts`, which throws unless the URL names the test
database. `globalSetup` creates the database if absent and runs
`prisma migrate deploy` (not `migrate dev`), so the schema under test is the
schema that ships, hand-written partial indexes included.

Suites truncate with `TRUNCATE ... CASCADE` before and after themselves, so runs
are order-independent and repeatable. Jest runs serially — the suites share
those tables, and the suite is far too fast for parallelism to be worth the
flakiness. Verified: two consecutive `npm test` runs, 118 tests each, no manual
reset in between, dev database untouched.

### 23.3 Two things the setup had to work around

**Jest runs in ESM mode.** `@nestjs/common@12` ships ESM only
(`"type": "module"`, no CommonJS build). Node 24.1 handles `require(esm)` so the
application runs fine, but Jest's own module registry cannot until Node 24.9.
Hence `NODE_OPTIONS=--experimental-vm-modules`, a `tsconfig.test.json` emitting
ESNext, and `import { jest } from '@jest/globals'` — in ESM, Jest injects
`describe`/`it`/`expect` as globals but not `jest` itself.

**Suites build a targeted provider list rather than importing AppModule.**
Booting the whole AppModule under Jest's ESM loader hangs indefinitely at
`.compile()` — measured at over three minutes at ~2% CPU, so blocked rather than
slow. A targeted module compiles in ~74ms. This is better testing anyway: each
suite states exactly which collaborators the behaviour under test needs, and
anything reaching the network is stubbed.

The consequence worth stating plainly: **these tests exercise the service layer,
not the HTTP layer.** Guards and pipes are not covered. That is acceptable for
what is being asserted here, because isolation in this codebase is enforced by
query scoping inside the services rather than by guards — the guards only
establish identity and role. `NotFoundException` is what Nest maps to 404, so
asserting the exception type asserts the status. But it is a real gap: a
regression in the guard chain itself would not be caught.

### 23.4 A latent defect the suite surfaced immediately

`ChatService` and `ChatGateway` imported each other, resolved with `forwardRef`
on both sides (§22.5). CommonJS tolerates that; ES modules do not — under ESM
the gateway's decorator metadata evaluates before `ChatService` is initialised,
giving `Cannot access 'ChatService' before initialization`.

It was fixed properly rather than worked around: a `CHAT_REALTIME` token and a
one-method `ChatRealtimePublisher` interface, so the dependency now runs one way
only — the gateway knows the service, the service knows only the token. No cycle,
no `forwardRef` on either side. The application build is CommonJS and was never
broken by this, but a circular import that only works under one module system is
a fragility worth removing regardless.

### 23.5 What is deliberately not tested here

- **The MTN MoMo integration.** It depends on an external sandbox and real test
  MSISDNs, so an automated suite covering it would fail for reasons unrelated
  to this code. It stays a manual check, as does the chat WebSocket layer via
  `scripts/ws-smoke-test.js`.
- **The HTTP layer** — guards, pipes, status codes (§23.3).
- **Availability slot generation**, notifications, uploads, and everything else
  hand-verified in earlier sections.

### 23.6 This is a foundation, not the test-writing effort

118 tests across four files is a starting point, and the danger is that it
becomes the one and only time tests were written.

**Every future module should add its own critical-path tests as part of the
module, not later.** The bar is not coverage — it is the same question asked
here: *which invariant in this module, if it silently broke, would cost money,
leak data, or corrupt a record before anyone noticed?* Test that, name the test
after the rule, and leave the rest to the hand-verification pattern the rest of
this file records.

The obvious next additions, when the modules they cover next change:
availability slot generation including the fits-before-closing rule (§12.2),
the notification debounce (§21.5), and the HTTP guard chain (§23.3).

---

## 24. Support tickets (2026-09-02)

How customers and businesses report problems to the platform: payment failures,
disputes over whether an appointment happened, account problems, bugs.

### 24.1 Parallel to Chat, not built on it

Tickets deliberately do NOT reuse `Thread`/`Message` (§21). The participants
differ — a reporter and the platform's admins, rather than a customer and a
business — and a ticket carries status, assignment, resolution and a reopen
window that a chat thread has no notion of. Forcing both onto one table would
mean a `Thread` with half its columns null in every row.

What is borrowed is the *shape*, not the models: a denormalised `lastMessageAt`
for queue ordering, query-level visibility scoping, and the same notification
service.

### 24.2 References come from a sequence

`reference` is `TKT-` plus a zero-padded `nextval('ticket_reference_seq')`,
taken inside the creating transaction.

A count-and-increment read is not collision-safe: two concurrent creates read
the same count and mint the same reference, and the unique index then fails one
of them for a reason the user cannot act on. `nextval()` is atomic and never
returns a value twice. Tested with 20 concurrent creates — 20 distinct
references.

### 24.3 The status machine lives in one method

`TICKET_TRANSITIONS` is a table of `{from, to, actors}`, and
`transitionStatus()` is the only thing that writes `status`. Anything not in the
table throws. Keeping it in one place is what stops the reopen window, the
resolution-note rule and the actor checks being bypassed by a second code path.

| From | To | Who |
|---|---|---|
| OPEN | IN_PROGRESS | admin; assigns them |
| IN_PROGRESS | RESOLVED | admin; `resolutionNote` **required** |
| RESOLVED | IN_PROGRESS | reporter, within 14 days; increments `reopenCount` |
| RESOLVED | CLOSED | admin, or the sweep |
| CLOSED | — | terminal |

A resolution with no note is rejected, whitespace included: a resolution the
reporter cannot read is not one they can act on. Reopening clears `resolvedAt`,
so the next resolution has to state its own reasoning rather than leaving the
superseded one in place.

All 12 illegal pairs are asserted rejected, generated from the state list rather
than hand-listed, so adding a status to the enum without adding its rules makes
the test fail rather than silently pass.

### 24.4 Auto-close: a daily cron, because the project already had a scheduler

The brief allowed either a scheduled job or lazy closure. **`@nestjs/schedule`
is already a dependency** with five existing sweeps (§16.8, §17.4, §20.5), so a
daily 03:00 cron closing RESOLVED tickets past 14 days adds no dependency and
matches the established pattern. The lazy-closure fallback was not needed.

Reads *also* treat a past-window RESOLVED ticket as CLOSED. That is not
redundancy: it closes the gap between the window elapsing and the next sweep, so
a reopen cannot slip through at hour 337. The sweep does the persisting, keeping
a read a read.

### 24.5 Internal notes are excluded by the query

`isInternal` messages are filtered with `where: { isInternal: false }` for every
non-admin read — never stripped from a result afterwards, because a filter
applied late is one someone eventually forgets on a new endpoint.

Reporter-facing messages do not even carry the `isInternal` field, so its
absence is structural rather than a value the client is trusted to ignore.
Asserted three ways: the note is absent, no message carries the field, and the
serialised response does not contain the text anywhere.

A reporter who sets `isInternal` is rejected outright rather than silently
downgraded — otherwise they would author something they could never see again.

### 24.6 Visibility, in both layers

Guards restrict who reaches a route at all (`@Roles(CUSTOMER, BUSINESS)` for the
reporter controller, `@Roles(ADMIN)` for the admin one), and the service scopes
every query on top:

- **Customer** — `reporterId = self`.
- **Business member** — `businessId = their business`. The whole queue, not only
  tickets they personally raised, because a colleague picking up someone's
  problem is the normal case.
- **Admin** — everything, including internal notes.

Non-participants get **404, not 403**, as everywhere else. `reporterType` is
derived from the authenticated role, never read from the body, so a customer
cannot file as a business and gain its queue.

An `appointmentId` is verified in the **service**: the reporter must be the
customer on it or a member of the owning business. A guard cannot see a body
field without duplicating that query.

### 24.7 The billing hook — what I found, and what I did not build

**STOP AND REPORT, as the brief instructed.** The brief says to read the
existing invoicing code and integrate with how it computes the billable set.
**There is no invoicing code.** A search for `invoice`, `billable`, `billing` or
`monthly` across all source and the schema returns nothing; there is no Invoice
model and no invoice run.

More importantly, the premise does not match this platform. The brief describes
"a fee per completed appointment, invoiced monthly". This platform does the
opposite, deliberately: **the platform fee is a percentage taken out of the
customer's deposit at booking time** and snapshotted onto the appointment
(§2, §16.3). §2's stated reason is precisely to avoid billing businesses —
"revenue never depends on businesses honestly self-reporting that an appointment
was completed". There is no monthly billable count for a credit to exclude an
appointment from.

So:

- `BillingAdjustment` is built exactly as specified and **records intent**. An
  admin resolving a ticket can attach `{appointmentId, type, amount, reason}`,
  and the row is written with `appliedInvoiceId = null`, validated so an
  adjustment cannot be attached to another business's appointment.
- **Nothing consumes those rows**, because there is nothing to consume them.
  `appliedInvoiceId` is a plain nullable String rather than a relation, since
  there is no Invoice model to reference. The index
  `(businessId, appliedInvoiceId)` is exactly the query a future invoice run
  would make.
- The two invoice-related tests could not be written as specified. In their
  place the suite asserts what is actually true: adjustments are created,
  correctly attributed, and remain unapplied.
- **No invoicing was restructured or invented**, per the instruction.

~~**This needs a decision before it means anything.**~~ **Answered in §25:** the
fee model is unchanged, and the adjustment types were renamed to match it. The
table's invoicing-shaped fields were corrected before any row was ever written.

### 24.8 A regression this module exposed — introduced in §23, now fixed

While verifying the app boots with the new module, **the whole application
turned out to hang at startup** — before route mapping, no error logged. It
reproduced with `TicketsModule` removed, so it predates this work.

Cause: §23.4's fix for the ChatService/ChatGateway ESM cycle replaced
`forwardRef` with `{ provide: CHAT_REALTIME, useExisting: ChatGateway }`. That
removed the *import* cycle but created a **dependency-injection** cycle —
Gateway → Service → CHAT_REALTIME → Gateway — and Nest's injector hangs on one
rather than reporting it.

**It shipped because §23's suite builds targeted provider modules and never
boots AppModule** — the exact gap §23.3 records. The tests all passed against a
binary that could not start.

Fixed by inverting the direction: `ChatGateway` implements `OnModuleInit` and
registers *itself* with `ChatService`, which holds a no-op publisher until then.
No token, no `forwardRef`, no cycle in either sense. Verified: the app boots,
12 ticket routes map, the gateway still subscribes, and the §22 websocket smoke
test passes end-to-end (participant received both messages, outsider none).

`scripts/ws-smoke-test.js` was also unrunnable — a mangled comment header from
when it was moved into `scripts/` in §22, never executed after the move. Also
fixed.

**The lesson is §23.3's gap, now concrete:** a suite that never boots the real
application cannot tell you the application boots. A smoke test that starts
AppModule and asserts it listens would have caught both.

### 24.9 Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/tickets` | CUSTOMER or BUSINESS; multipart, optional attachment |
| GET | `/tickets` | own scope; `status`, `category`, paginated, `lastMessageAt` desc |
| GET | `/tickets/:id` | own scope; internal notes excluded |
| POST | `/tickets/:id/messages` | reporter; blocked when CLOSED |
| POST | `/tickets/:id/reopen` | reporter; RESOLVED only, inside the window |
| GET | `/admin/tickets` | ADMIN; adds `assignedAdminId` filter |
| GET | `/admin/tickets/:id` | ADMIN; includes internal notes |
| PATCH | `/admin/tickets/:id/assign` | ADMIN |
| PATCH | `/admin/tickets/:id/status` | ADMIN; optional billing adjustment |
| POST | `/admin/tickets/:id/messages` | ADMIN; supports `isInternal` |

Admin routes are API-only, like the platform-fee and exchange-rate settings
(§16.9). Attachments reuse `StorageService` and the gallery's multer options
object — 15MB, jpg/png/webp — so ticket limits cannot drift from gallery limits.

### 24.10 Verified (2026-09-02)

50 new tests, 168 total across the suite, no regressions. Covers: every illegal
transition; reopen refused past 14 days; resolution without a note refused;
CLOSED refusing reporter messages; internal notes absent from all three
reporter-facing shapes; customer A blocked from reading, messaging or reopening
customer B's ticket; business A blocked from business B's; a colleague who did
not create a ticket seeing their business's; an unrelated `appointmentId`
rejected at creation for both reporter types; 20 concurrent creates yielding 20
unique references; auto-close closing stale and sparing fresh.

Also verified over HTTP against the running app: guards (403 customer → admin
routes, 401 anonymous), multipart creation returning `TKT-000002`, and the
project's standard validation error shape.

### 24.11 Deferred

- **The billing hook does nothing until invoicing exists** (§24.7).
- **No attachment on the reopen or status endpoints** — only on create and
  messages.
- **No SLA, priority or category-based routing.** Every ticket goes to every
  admin until assigned.
- **No attachment cleanup** when a ticket is deleted; tickets are never deleted.
- **Notifications are not debounced** the way chat messages are (§21.5). Ticket
  traffic is far lower, but a busy thread will email per message.

---

## 25. Correcting BillingAdjustment to the real fee model (2026-09-02)

§24.7 flagged that `BillingAdjustment` was specced against monthly invoicing,
which this platform does not do. This corrects the table before it holds a
single row.

### 25.1 The confirmed money rules

The fee model is unchanged from §2 and §16.3 — the platform fee is a percentage
taken out of the customer's **deposit at booking time**. What was missing was
what happens when a booking falls through:

- **Business cancels** → the customer is refunded **in full**, including the
  platform fee taken at booking. The payment gateway's own charge (1–2%) on that
  refund is borne by the **business**.
- **Customer cancels, or no-shows** → **no refund at all.** Nothing reverses.
  This is §2's non-refundable deposit, unchanged.

The asymmetry is the point: the deposit exists to make a customer's commitment
real, so it cannot survive the business being the one to break it.

### 25.2 What changed, and why the names mattered

| Was | Now |
|---|---|
| `FEE_CREDIT` | `FEE_REFUND` |
| `FEE_CHARGE` | `GATEWAY_FEE_DEBIT` |
| `appliedInvoiceId` | `settledAt` + `settlementRef` |
| index `(businessId, appliedInvoiceId)` | index `(businessId, settledAt)` |

"Credit" and "applied invoice" are invoicing words. They describe adjusting a
bill that has not been sent yet — and this platform never sends one, because the
money was already taken at booking. Left in place, those names would have
quietly reintroduced the invoicing premise every time someone read the model:
the schema would have been documentation for a system that does not exist.

The replacements describe what actually has to happen. A `FEE_REFUND` is settled
by reversing a charge at the payment provider, so `settledAt` records when the
money moved and `settlementRef` records the provider's reference for it —
the same reconciliation pairing as `providerCurrencyAmountCents` +
`exchangeRateUsed` on Appointment (§18.4).

`GATEWAY_FEE_DEBIT` exists because the gateway's cut is not recoverable: when a
business cancels and the customer is made whole, someone absorbs the provider's
1–2%, and that someone is the business.

The migration rewrites the enum and columns in place, guarded by a check that
aborts if the table is not empty. It was — the feature shipped one commit
earlier and only an admin resolving a ticket can write to it.

### 25.3 Still records intent, deliberately

**Nothing writes these rows automatically and nothing settles them.** There is
no cancellation-refund flow, and this commit did not build one. `settledAt` is
null on every row by definition.

That is correct for now: the row is a record that an admin decided a refund is
owed. Building the movement is a payments concern and belongs with the refund
accounting §17.7 already lists as missing.

**Nothing reporter-facing says or implies money has moved.** Verified, and now
asserted by a test: the adjustment appears in no reporter response and no
notification — not on the transition response, not on the ticket detail view.
The only thing the reporter sees is the admin's own `resolutionNote`, which
describes a decision. Telling someone they have been refunded when no money has
moved would be worse than telling them nothing, and it is the kind of wording
that ends up in a dispute.

### 25.4 Verified

169 tests pass. The new one asserts that a resolution carrying a FEE_REFUND
leaks neither the type, nor the word "adjustment", nor `settledAt` into any
reporter-facing shape, while still surfacing the admin's note.
