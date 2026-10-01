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

### 2.1 Correction: the fee is a percentage of the SERVICE PRICE (2026-09-02)

The wording above — and the §16.3 note that superseded the flat fee — says the
fee "comes out of the deposit". That describes where the money is *taken from*
and is right about the cash flow, but it has misled every reading of the
arithmetic. **Both percentages apply to the service price, not to each other:**

```
deposit     = round(price × depositPercentage / 100)
platformFee = round(price × platformFeePercentage / 100)   ← price, NOT deposit
business    = deposit − platformFee
```

The fee is a percentage **of the full service price**, and it is then collected
out of the deposit. A 10% fee on a $45 service is $4.50 whether the deposit is
20% or 90% — the deposit only determines how much cash is on hand to take it
from. `computeAppointmentAmounts` (`appointment-pricing.ts`) has always worked
this way; only the prose was wrong.

**The rule that follows: `depositPercentage >= platformFeePercentage`.**

Because `business = deposit − fee` and both derive from the same base, the
business's share is non-negative if and only if the deposit percentage is at
least the fee percentage. Below it, the business would owe money for accepting a
booking. This is now enforced in three places — see §40.

**At `deposit == fee` the business's share is exactly zero.** That is legal and
deliberate, not a bug: the deposit exists purely to make the customer's
commitment real, the platform takes all of it, and the business is paid its
entire take offline as the balance. The consequence to state plainly is that
**such an appointment generates no payout at all** — its two ledger entries net
to zero, and a payout run skips a business whose available balance is not
positive (§35.3).

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
9. **Reviews & reporting** — DONE (§28 reviews, §29 analytics)
10. **Admin portal** — NEXT

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
~~Booting the whole AppModule under Jest's ESM loader hangs indefinitely at
`.compile()` — measured at over three minutes at ~2% CPU, so blocked rather than
slow.~~ **That diagnosis was wrong — see §26.1.** The hang was the DI cycle
introduced in §23.4, not the ESM loader; with it fixed, AppModule compiles and
boots inside Jest in about a second. The targeted-module approach is kept
because it is genuinely better testing — each suite states exactly which
collaborators the behaviour under test needs, and anything reaching the network
is stubbed — but it is a preference, not a workaround.

The consequence worth stating plainly: **these tests exercise the service layer,
not the HTTP layer.** Guards and pipes are not covered. That is acceptable for
what is being asserted here, because isolation in this codebase is enforced by
query scoping inside the services rather than by guards — the guards only
establish identity and role. `NotFoundException` is what Nest maps to 404, so
asserting the exception type asserts the status. But it is a real gap: a
regression in the guard chain itself would not be caught.

> **CLOSED in §27.** The gap is now covered by HTTP-level tests against the real
> booted application. The claim above that "the guards only establish identity
> and role" turned out to understate them — see §27.3, where removing one
> `@Roles(ADMIN)` exposed every ticket on the platform to any customer.

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
- ~~**The HTTP layer** — guards, pipes, status codes (§23.3).~~ **Done in §27.**
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
availability slot generation including the fits-before-closing rule (§12.2) and
the notification debounce (§21.5). ~~the HTTP guard chain (§23.3)~~ — closed in
§27 rather than waiting for Auth to change next.

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

---

## 26. Boot smoke test (2026-09-02)

One test that starts the real application and asserts it answers.

### 26.1 The misdiagnosis it corrected

§23.3 recorded that booting AppModule under Jest "hangs indefinitely at
`.compile()` — blocked rather than slow", and attributed it to Jest's ESM
loader. **That was wrong.** The hang was the dependency-injection cycle
introduced in the very same commit (§23.4, fixed in §24.8). With the cycle gone,
AppModule compiles, boots, listens and serves inside Jest in **about a second**.

Worth stating plainly because the wrong diagnosis had a cost: it made "we cannot
boot the real app in tests" look like an environmental constraint to work
around, when it was a bug in our own wiring. That belief is precisely what let a
non-booting binary ship green.

### 26.2 What the test does

Boots the whole `AppModule` through `NestFactory`, applies the same global
configuration `main.ts` applies, listens on an **ephemeral port** (`listen(0)`,
so it never collides with a dev server or a parallel run), fetches an unknown
route, asserts a 404, and closes.

An unknown route is deliberately the cheapest possible assertion: reaching a 404
proves the server bound a port, the router resolved, and the exception layer
rendered a response. A health endpoint would prove the same thing and this
project has none, so inventing one purely for a test would be the tail wagging
the dog.

**The timeout is explicit and tight — 25 seconds.** The failure mode being
guarded against is a *hang*, not an exception, so the default timeout mattering
is the whole design: a test that waits patiently for a hang is worthless.

### 26.3 `configureApp` was extracted so the test cannot drift

`main.ts` previously inlined its `ValidationPipe` and CORS setup. That is now
`configureApp(app)` in `src/app-bootstrap.ts`, called by both `main.ts` and the
test.

Copying the configuration into the test would have been the obvious shortcut and
the wrong one: `main.ts` could later gain a global filter or interceptor and the
test would keep passing against a shape production no longer uses. Sharing one
function means the test exercises whatever bootstrap actually does. `main.ts`
behaviour is unchanged.

### 26.4 Verified to fail for the right reason

A test that passes proves little on its own — it has to fail when the bug
returns. The §23.4 DI cycle was temporarily reintroduced and the suite re-run:
the boot test **failed with `Exceeded timeout of 25000 ms`**, exactly the hang
signature, while nothing else changed. The cycle was then reverted.

170 tests pass, and this one runs as part of the default `npm test` rather than
an opt-in script — a smoke test nobody runs is not a smoke test.

---

## 27. Guard-chain tests over HTTP — closing §23.3 (2026-09-02)

§23.3 recorded that authorization was verified only at the service layer, never
through the real request pipeline, and deferred fixing it. The blocker was the
AppModule boot hang; §24.8 fixed it and §26 built the harness, so it is closed
now rather than "next time Auth changes".

### 27.1 What is covered

One representative route per protected module — appointments, chat, tickets —
against the real booted application, over the wire. The guards are declared per
controller, so re-testing every handler would assert the same decorator
repeatedly.

- **No token → 401**, on all three modules.
- **Malformed token → 401.** **Wrong signature → 401.** **Correctly signed but
  expired → 401.**
- **Wrong role → 403:** a BUSINESS token booking an appointment or opening a
  chat inquiry (both CUSTOMER-only); a CUSTOMER token on a BUSINESS route.
- **Admin routes → 403** for both CUSTOMER and BUSINESS tokens, 200 for ADMIN,
  across `/admin/tickets` and `/admin/settings/platform-fee`.
- **Business role tiers → 403:** STAFF cannot create a service, can still read
  the list, and the OWNER can.
- **Another tenant's resource → 404**, consistently, with the response
  indistinguishable from a genuinely missing id.
- **The global ValidationPipe is in the chain:** an unknown property is
  rejected 400 (proving `whitelist`/`forbidNonWhitelisted` are active), as is a
  malformed uuid path param.

### 27.2 Which of these actually test a guard

The brief asked for this specifically, and the answer is not uniform.

**Genuinely guard-dependent:**

- Every **401**. Without `JwtAuthGuard` the handler would run with no `user` and
  fail on a property access — a 500, not a 401. The status is the guard.
- **Admin-route 403s** — see §27.3, the strongest case in the suite.
- **STAFF → 403 on service creation.** `ServicesService.create` resolves the
  caller's business and never checks their role, so without
  `BusinessRolesGuard` a staff member would successfully create a service.
- **BUSINESS token → 403 on booking.** `AppointmentsService.create` takes a
  customerId and does not verify the caller is a customer.

**Passes, but not because of a guard:**

- **The cross-tenant 404s.** A valid token with the right role passes the entire
  guard chain and reaches the handler; the *service's* query scoping is what
  refuses. They are worth having — they prove the scoping survives the real
  pipeline, which the service-level suite cannot show — but they are not
  evidence about guards, and should not be read as such.
- **CUSTOMER token → 403 on `/business/services`.** `RolesGuard` refuses it, but
  `BusinessRolesGuard` would too: a customer has no active membership, so
  `requireActiveMembership` throws Forbidden. This test cannot distinguish which
  layer fired.

### 27.3 One guard is doing far more than §23.3 assumed

§23.3 asserted the guards "only establish identity and role", with isolation
enforced by service-level scoping. That is true almost everywhere — and false in
one place that matters.

`TicketsService.listForAdmin` applies **no scoping at all**: it is the admin
queue, so it deliberately returns every ticket on the platform. Its only
protection is `@Roles(ADMIN)` on the controller.

This was tested rather than reasoned about. With that one decorator temporarily
removed, a request from an ordinary customer's token returned **200 and included
another user's private ticket subject**. The decorator was restored immediately
and the experiment was not committed.

So the general claim in §23.3 needed correcting: for most routes the guards are
a coarse first filter over a service that would refuse anyway, but for the admin
endpoints they are the *entire* access control. A service-layer-only suite would
never have shown that.

### 27.4 Harness

`test/setup/e2e-app.ts` boots the real `AppModule` through `NestFactory`, applies
the same `configureApp` as `main.ts` (§26.3), and listens on an ephemeral port.
It uses the existing test database, `resetDatabase` and factories — no second DB
strategy and no new framework, per the existing setup.

Tokens are minted with the application's own `JwtService` and real signing
secret, so they are indistinguishable from tokens issued by the OTP flow; the
guards verify them normally. Cron jobs are stopped once listening, since they
are irrelevant to authorization and would otherwise mutate fixtures mid-run —
the §26 boot test is the one that leaves the real schedule running.

### 27.5 Verified

33 new tests, **203 total across 7 suites**, all passing.

---

## 28. Reviews (2026-09-02)

The customer-facing trust signal, scoped per location.

### 28.1 Per location, not per business

A `Review` carries `locationId` alongside `businessId`, and the aggregate lives
on `Location`. A chain gets a separate rating per branch.

A well-run branch should not be dragged down by a badly-run one, and a customer
choosing between two branches of the same salon is choosing between those
branches. Asserted directly: a review at branch A leaves branch B's
`ratingAvg` null, for the same business.

### 28.2 What actually prevents a double review

`@unique` on `appointmentId`, and the service handles the constraint violation
(`P2002` → `ConflictException`) rather than reading first.

A read-then-write check loses the race: two concurrent submissions both find no
existing review and both insert. Only the index can decide.

`businessId` and `locationId` are copied from the appointment and never accepted
from the body — a review has to describe where the service actually happened.
Both preconditions (status is COMPLETED, caller is the appointment's customer)
are checked in the service, since a guard cannot see either without repeating
the query.

### 28.3 Editable for 7 days, never deletable

The customer may change rating and comment for 7 days; after that it is locked.
Any edit stamps `editedAt`, which every response exposes — a rating that changed
after the business replied is context the reader needs.

**There is no customer delete**, deliberately. Delete-and-repost is how a review
escapes a business response it did not like, and a review the business has
already answered is a two-sided record.

The business gets one response, editable by that business for 7 days
(`responseEditedAt`), also not deletable. Any ACTIVE member may respond,
including STAFF: replying to a customer is day-to-day work, not configuration,
so it sits with the STAFF-permitted actions (§16.6) rather than the OWNER-only
ones.

Response fields live **on** `Review` rather than in a table, because the rule is
exactly one response and a separate table would imply many.

### 28.4 Moderation is a soft-hide

Admin hide sets `hiddenAt`, `hiddenReason` (required) and `hiddenById`. Hidden
reviews leave public listings and aggregates but **stay in the table** — a
hidden review is usually the evidence in the ticket that got it hidden, so
deleting it destroys the record of why it was hidden.

Requiring a reason is not ceremony: hiding customer feedback without recording
why cannot be reviewed later or explained in a dispute.

Both sides are notified — the author, because their words stopped being visible,
and the business, because its rating just moved.

### 28.5 Aggregates are recalculated on write, never computed on read

`Location.ratingAvg` and `ratingCount` are recomputed **inside the same
transaction** as any create, edit, hide or unhide. Location browsing is a hot
read path and must never run `AVG()` across the review table to draw stars.

Same transaction matters: an aggregate updated afterwards can disagree with the
rows it summarises, and a hidden review that still moves the star rating is not
hidden.

`ratingAvg` is **null**, not 0, when nothing is visible. "Not yet rated" and
"rated zero" are different claims, and 0 is not a valid rating.

Tested with exact numbers rather than "it changed": three reviews of 5, 3 and 4
give exactly 4.00; editing the 4 to a 1 gives exactly 3.00; hiding that review
gives exactly 4.00 over 2; unhiding restores 3.00 over 3; hiding the only review
returns the average to null.

### 28.6 Auth posture and customer identity — both found, not invented

**Posture, found:** the only other public `/locations` route is
`GET /locations/:id/availability`, guarded by `OptionalJwtAuthGuard` with the
§13.2 rule that a non-APPROVED business is 404 to anyone but its own members.
`GET /locations/:id/reviews` mirrors that exactly. No new posture.

**Identity: there is no precedent, because there is no data.** `User` has
**no name field at all** — only `email`, `role` and timestamps. The existing
practice is that a customer is exposed as `{ id, email }` and only ever to a
counterparty: the business sees its own customer on an appointment
(`APPOINTMENT_SELECT`) and in a chat thread. **Nothing about a customer is
public anywhere today.**

So the rule that follows the project rather than inventing something:

- **Anonymous / other viewers** — no customer identity at all. Rating, comment,
  dates, business response.
- **A member of the owning business, or an admin** — `{ id, email }`, exactly as
  appointments and chat already do for the same counterparty relationship.

Deriving initials from an email was rejected: it exposes part of an identifier
the customer never chose as a public handle, and at a small salon with one
review it identifies them anyway. **A real `User.displayName` is the missing
piece** — it needs a product decision about where a name is collected, since
signup is OTP-by-email and asks for nothing else.

### 28.7 Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/appointments/:id/reviews` | CUSTOMER, COMPLETED appointments only |
| PATCH | `/reviews/:id` | the author, within 7 days |
| GET | `/locations/:id/reviews` | optionally authenticated, as availability is |
| POST | `/reviews/:id/response` | any ACTIVE member of the owning business |
| PATCH | `/reviews/:id/response` | same, within 7 days |
| PATCH | `/admin/reviews/:id/hide` | ADMIN, reason required |
| PATCH | `/admin/reviews/:id/unhide` | ADMIN |

### 28.8 Verified

37 service tests and 11 HTTP tests on the §27 harness; **254 total across 8
suites**, all passing, and the application boots with all seven routes mapped.

Covers every non-COMPLETED status rejected, a non-participant customer rejected,
the conflict on a second review, ratings 1 and 5 accepted with 0/6/-1 refused,
the edit window in both directions, one-response-only, a different business
refused, aggregates asserted as exact numbers through create/edit/hide/unhide,
per-location separation, and identity hidden from anonymous callers but shown to
the owning business. Over HTTP: 401 unauthenticated, 403 for a business token
creating a review and for any non-admin hiding one.

---

## 29. Business analytics (2026-09-02)

Reporting for businesses, and the last piece of the reviews-and-reporting pair.

### 29.1 What money data actually exists — checked before building

The appointment carries three snapshotted amounts, written once at booking and
historical thereafter (§16.3): `depositAmountCents`, `platformFeeAmountCents`,
`businessAmountCents`, with `currency`, plus the gateway record
(`paymentProviderReferenceId`, `providerCurrency`,
`providerCurrencyAmountCents`, `exchangeRateUsed`).

**What does not exist, and therefore is not reported:**

- **The service price at the time of booking.** It lives on
  `Service.priceCents`, which a business can edit at any time (§10). Joining to
  it gives *today's* price for a booking made months ago.
- **Any way to reconstruct it.** `deposit = round(price × depositPercentage)`
  and `platformFee = round(price × platformFeePercentage)`, but neither
  percentage is snapshotted and both are editable, so the equations cannot be
  inverted.
- **Therefore the balance owed directly to the business is NOT COMPUTABLE**, and
  it is not returned. The endpoint says so explicitly —
  `balanceOwedToBusiness: { available: false, reason }` — rather than omitting
  the field, so a caller does not assume it was forgotten. Approximating it from
  today's price would produce a figure that silently changes when a business
  edits a price, which is exactly the "reads one number, finds it wrong, stops
  trusting the dashboard" failure worth avoiding.
- **Whether an offline balance was ever paid.** Nothing records it; §2 places
  that settlement outside the platform entirely.
- **Full online payment.** §2 offers it as a customer option; it is not
  implemented, so there is nothing to sum. Only the deposit flow exists.

**One imprecision, stated rather than hidden.** A deposit is known collected for
BOOKED, IN_PROGRESS, COMPLETED and NO_SHOW. CANCELLED is ambiguous — the §17.4
expiry sweep cancels *unpaid* holds, while a customer or business cancelling
from BOOKED had a deposit that is non-refundable (§2) — and nothing records
which, since there is no `depositPaidAt` and no status history. Cancelled
appointments are **excluded**, making the collected figure a floor, and the
response carries a note saying so.

### 29.2 Two money figures, never one

`collectedThroughPlatform` (deposits, and the business's share after the fee)
and `platformFeesPaidCents` are separate fields with distinct names. There is
deliberately **no** `revenue` — asserted by a test that the string never appears
in the response.

The platform simply does not see most of a business's takings: the balance is
settled in person. A single number labelled "revenue" would be wrong by whatever
that balance is, and a business that discovers this stops believing the rest of
the dashboard too.

Platform fees are reported as **paid**, never owed. The fee is taken from the
deposit at booking, so it is always historical — reintroducing any notion of an
accrued or outstanding fee would be the invoicing model this project does not
have (§25).

### 29.3 Conventions chosen

- **Range is half-open, `[from, to)`** — an appointment exactly on `from` counts,
  one exactly on `to` does not. This matches `GET /appointments`, which already
  uses `gte` on `from` and `lt` on `to`. Both directions are tested.
- **Membership of the period is by `startTime`** — when the appointment happened,
  which is what a business means by "last month's numbers".
- **Empty period returns `null` for every rate**, never `0` and never `NaN`.
  "No appointments" and "0% completed" are different claims, the same reasoning
  that makes `Location.ratingAvg` null rather than zero (§28.5). Counts and
  money return `0`, which is genuinely zero.
- **Rate denominator is every appointment in the range**, whatever its status.
- **Default range is 30 days; the maximum is 365**, rejected with the standard
  validation error beyond that.

### 29.4 Aggregated in the database, including the roll-up

Every metric is a `groupBy`, an `aggregate`, or one raw grouped query. Nothing
is loaded into memory and reduced.

The business-wide roll-up is **the same query with the location filter
omitted**, not a loop over locations. That is not only faster — it is the only
way the rates come out right. A rate across two locations is not the mean of
their rates: 1 of 2 and 3 of 4 is 4 of 6, or 66.67%, not (50 + 75) / 2 = 62.5%.
Tested explicitly against both numbers.

Busiest day and hour use `$queryRaw` because Prisma's `groupBy` cannot express
`EXTRACT` over a timezone conversion — but the grouping still happens in the
database. The double `AT TIME ZONE` idiom converts the stored UTC timestamp into
`PLATFORM_TIMEZONE`; without it "busiest hour" would be reported in UTC and be
wrong by the offset. Day numbering is 0 = Sunday, matching
`LocationHours.dayOfWeek` (§10.4).

### 29.5 Access

`@Roles(BUSINESS, ADMIN)` gates the route; `assertMayRead` decides *which*
business — an admin any, a business user only one they are an ACTIVE member of.
`BusinessRolesGuard` is deliberately not used here: it requires a membership,
which an admin does not have.

A `locationId` belonging to another business is refused with 404 rather than
silently ignored, so it cannot be used to widen a query.

Cross-tenant refusal is `Forbidden`, not `NotFound`, unlike most of this
project: the caller supplies a business id they already know, and business
profiles are discoverable through public browsing, so there is no existence to
protect.

### 29.6 Verified

21 service tests and 7 HTTP tests; **284 total across 9 suites**, all passing,
and the route maps on a real boot.

Figures are asserted as exact numbers throughout — 57.14% completion over 7
appointments, 4500 cents collected from 5 of 7, fees matching an independently
computed sum — because "a value is present" would pass against arithmetic that
is quietly wrong.

---

## 30. Pricing snapshot on Appointment (2026-09-02)

Records the inputs the money amounts were already computed from. **No
arithmetic changed and no money moved** — this commit adds three columns.

### 30.1 What was missing

`depositAmountCents`, `platformFeeAmountCents` and `businessAmountCents` were
snapshotted at booking (§16.3). The values they were *derived from* were not:

- `Service.priceCents` and `Service.depositPercentage` are editable at any time
  (§10), so a historical appointment joined to today's price.
- `PlatformSetting.platformFeePercentage` is a live admin setting (§16.3).

So a past appointment's numbers could not be explained. `servicePriceCents`,
`depositPercentage` and `platformFeePercentage` now sit on the appointment,
written in the same transaction, from the same values `computeAppointmentAmounts`
already received.

**Nullable, no backfill.** Rows booked before this genuinely lack the
information, and it cannot be recovered — the equations have two unknowns and
both sides have since been editable. Writing a guess would turn "unknown" into
"wrong". Every reader treats null as "not recorded".

Asserted by test: the snapshot reproduces all three stored amounts exactly, and
editing the service afterwards to 9999/55% leaves both the snapshot and the
amounts untouched — the precise failure this exists to prevent.

### 30.2 Balance owed is now computable, and says how complete it is

§29.1 reported `balanceOwedToBusiness` as not computable. With the snapshot it
is `servicePriceCents − depositAmountCents` over COMPLETED appointments in
range, and it is returned as a real figure.

Two qualifications ship **in the response**, not in documentation nobody reads:

- **It is not money the platform has seen.** §2 places balance settlement
  directly between customer and business, and nothing records whether it was
  collected. It is an expectation, not a receipt.
- **It may be partial.** Appointments without the snapshot are excluded, and
  `appointmentsMissingSnapshot` plus `complete: false` say so. A partial total
  that does not announce itself is the number a business acts on and then stops
  trusting.

It remains a separate field from `collectedThroughPlatform`; the two are never
summed (§29.2).

### 30.3 Two findings from the pre-work — reported, not fixed

**(a) Appointment responses render TODAY's service price.**
`APPOINTMENT_SELECT` includes `service: { select: { priceCents } }`, and that
select backs `findOne`, `findAll` and the return value of every transition
method. So a customer opening a booking from three months ago sees whatever the
business charges now, presented as that appointment's price.

Not fixed here, as instructed. The snapshot added above is what a fix would use:
render `servicePriceCents` when present and fall back to the join only when it
is null. Notification templates are unaffected — they use the deposit snapshot,
never the service price — and there are no receipts.

**(b) Cancellation records almost nothing, and the §25 refund policy is
therefore not implementable.**

The only field is `cancelledAt DateTime?`. There is **no `cancelledBy` and no
`cancellationReason`**. Two code paths set CANCELLED:

- `payments.scheduler.ts:171` — the expiry sweep, an unpaid hold.
- `appointments.service.ts:719` — `cancel()`, by either party.

`cancel()` *knows* who acted: it computes
`appointment.customerId === userId ? 'Cancelled by the customer.' : 'Cancelled by the business.'`
— but only to interpolate into a notification string. **It is never persisted.**

Consequently the stored data cannot distinguish:

1. a business cancellation from a customer cancellation;
2. either from an automatic expiry;
3. an expired unpaid hold from a paid appointment cancelled later.

§25's rules — business cancels means a full refund including the platform fee;
customer cancels means nothing reverses — **cannot be applied to any existing
row**, because which rule applies is exactly what was not recorded. This is also
why §29.1's collected-deposits figure has to exclude CANCELLED and describe
itself as a floor.

The fix is small (`cancelledBy` and `cancellationReason`, written where the
notification wording is already decided) but it is a schema and policy change,
and this commit was scoped to pricing. **Logged as the blocker for refunds.**

---

## 31. Customer display names for reviews (2026-09-02)

Reviews had no byline at all. `User` has no name field (§1), and §28
deliberately exposes nothing about the customer publicly, so every public review
was attributed to nobody. That is not privacy, it is a missing feature: a reader
cannot weigh feedback with no author, and a customer had no way to sign their
own words.

### 31.1 On the User, not on the Review

`User.displayName String?`. One field, one source of truth: a customer who
changes their name changes it on every review at once, instead of accumulating
one frozen name per review and appearing to be three different people.

This is the opposite of the snapshot rule in §16.3 and §30, and deliberately so.
Money must be snapshotted because it describes a transaction that happened at a
moment. A name describes a person now, and the person is the same person on all
of their reviews. Copying it per review would also make moderation a loop over
rows instead of one write (§31.4).

Nullable, no backfill.

### 31.2 "Anonymous" is rendered, never stored

Null renders as `Anonymous` at read time. The literal string is never written on
a customer's behalf.

The difference matters exactly once, and it is the case that would otherwise be
silently wrong: a customer who **chooses** "Anonymous" and a customer who skips
the field look identical to a reader, and must not be identical in the database.
Storing the literal would erase that, and it would also make an admin clear
(§31.4) indistinguishable from a deliberate choice.

Every review response now carries a `displayName` string. `GET /users/me`
returns the raw value — to the owner, null means "you have not set one", which
is a different statement from "Anonymous".

### 31.3 Exposure follows §28, with the name added

| Viewer | Sees |
| --- | --- |
| Anonymous / any other user | `displayName` only |
| Owning business, admin | `displayName` + `{ id, email }`, unchanged |

The public listing selects `displayName` and nothing else from the customer —
`id` and `email` are added to the select only for entitled viewers, rather than
selected and stripped afterwards. A field somebody adds to that select later
cannot leak to an anonymous reader, because it was never fetched.

### 31.4 Set through the review endpoints; there is no profile endpoint

`POST /appointments/:id/reviews` and `PATCH /reviews/:id` both accept an
optional `displayName` and write it to the `User` **in the same transaction** as
the review. A review that posted while its byline failed to save would publish
under the wrong name, visibly.

There is no profile-update endpoint in this project — `/users/me` is read-only
and nothing anywhere else writes a `User` row — and none was invented for this.
Omitting the field keeps whatever the customer has; supplying it overwrites,
last write wins. The edit path is bounded by the existing 7-day window (§28).

Renaming does **not** set `editedAt`: that marker tells a reader the review's
content changed, and changing your own name is not that.

**Moderation:** `PATCH /admin/users/:id/display-name/clear`, admin only, reason
required, and the customer is notified (`DISPLAY_NAME_CLEARED`) exactly as
review hiding notifies them — moderation nobody is told about reads as a bug to
the person it happened to. It clears to **null**, so the customer is shown as
"Anonymous" and can set a new name on their next review or edit. There is no
admin *edit*: substituting wording an administrator preferred would publish
words under a customer's byline that they never wrote.

The role is asserted in `UsersService` as well as by `@Roles(ADMIN)`, per §27.1
— a service method that trusts a decorator on a controller class is one refactor
away from being callable by anyone. Tested at both levels.

### 31.5 Validation, and what it deliberately rejects

Control and format characters are stripped and the value trimmed **before** any
other rule, so length is measured on what will actually be displayed and
invisible padding cannot smuggle a one-character name past a two-character
minimum. Then: 2–40 characters, no `@` together with a dot, and nothing that
reads as a link (a scheme, a `www.` prefix, a bare `something.tld`, or anything
`new URL()` accepts).

**Known trade-off:** the bare-domain rule rejects a single unspaced token ending
in a dot and two or more letters, so `Anne.Marie` is refused while `Anne Marie`
and `Anne-Marie` are accepted. Chosen knowingly — `mysite.com` as a review
byline is advertising on someone else's page, and the two forms are not
distinguishable by shape. If it proves a real annoyance the rule to relax is
that one, not the email rule.

---

## 32. Appointment responses show the price that was agreed (2026-09-02)

Fixes the bug §30.3(a) reported.

`APPOINTMENT_SELECT` pulled `priceCents` off the joined `Service` row. Services
are repriceable at any time (§10), and that select backs `findOne`, `findAll`
**and the return value of every transition method** — so a customer opening a
three-month-old booking was shown the business's price *today*, presented as
what they had agreed to pay. Not a reporting problem: a wrong number on the
customer's own booking.

The appointment now reports its own `servicePriceCents` snapshot (§30). The
joined price is gone from the select entirely, so no future caller can reach it
by accident.

**Pre-snapshot appointments return null, and null is the final answer.** There
is no fallback to the live price. That fallback would be the original bug
wearing a condition, and it would be worse for being intermittent — correct on
new rows, silently wrong on old ones. A client can render null as "not
recorded"; it cannot know that a number it was handed is fiction.

The service **name** stays joined. A renamed service makes the label drift,
which is cosmetic and self-correcting. A repriced service makes the number
wrong, which is neither.

No consumer anywhere read `appointment.service.priceCents` — the build is clean
and there is no frontend in this repository. The only other read of
`Service.priceCents` is in `create()`, which is where the snapshot comes from
and is unchanged.

---

## 33. Recording who cancelled, and whether the deposit was paid (2026-09-02)

Clears the blocker §30.3(b) reported. **This commit records state. It moves no
money, implements no refund, and changes no fee or deposit calculation.**

### 33.1 The gap

§25's refund policy turns on which party called an appointment off — a business
cancellation refunds the customer in full and charges the gateway's 1–2% to the
business; a customer cancellation or no-show reverses nothing. The stored data
could not answer that question. `cancel()` derived the actor, spent it on a
notification sentence, and discarded it; the expiry sweep was indistinguishable
from a real cancellation; and once a row was CANCELLED nothing said whether its
deposit had ever been taken.

### 33.2 Two fields for the actor, deliberately

```
cancelledBy          CancelledBy?   // CUSTOMER | BUSINESS | SYSTEM_EXPIRY
cancelledByUserId    String?
cancellationReason   String?
cancellationTicketId String?
depositPaidAt        DateTime?
```

`cancelledBy` is **who bears responsibility** — the input to the money outcome.
`cancelledByUserId` is **who physically performed the action**. Usually the same
person, and deliberately not always: when an admin resolves a dispute by
reclassifying an appointment as business-cancelled, `cancelledBy` is `BUSINESS`,
`cancelledByUserId` is the admin, and `cancellationTicketId` links the ticket
that explains it. Collapsing them into one column would mean either lying about
who acted or building a second refund path for admin-resolved cancellations. One
refund path can serve both, because the field it reads means the same thing in
both.

There is no admin reclassification **endpoint** yet — that belongs with refunds.
The columns are the contract it will write through, and a test asserts the two
fields hold divergent values independently.

`cancellationReason` is **required when a business cancels**, optional for a
customer, null for the sweep. A business cancellation now costs the business
money, so it should be a deliberate act with a stated reason; a customer calling
off their own booking owes nobody an explanation. The check is in the service,
not the DTO, because only the service knows which side the caller is on.

The notification now reads the persisted value back rather than recomputing the
actor. One source of truth: the sentence the customer receives and the value the
refund module will act on cannot drift apart.

### 33.3 `depositPaidAt`, because status forgets

Status cannot answer "was this ever paid?" once a later transition has moved the
row on. A CANCELLED appointment looks identical whether it was an unpaid hold
released by the sweep or a deposit that was taken and then called off — which is
precisely why §29.1 could only report collected deposits as a floor.

A timestamp survives every subsequent transition. Written in exactly one place,
the `SUCCESSFUL` branch of `applyPaymentResult`, and never cleared. Tested to
survive both cancellation and completion.

### 33.4 No backfill, and analytics reads the gap as a gap

Existing CANCELLED rows keep `cancelledBy` null, meaning "not recorded". Nothing
infers it from timestamps or status history — that would manufacture an answer
to the one question the data never held, and that answer would go on to decide
who gets refunded.

Collected deposits now include CANCELLED rows with `depositPaidAt` set: the money
arrived and, per §2, was not returned. Excluding them understated the platform's
actual take.

The excluded remainder is exactly the pre-migration set, and it identifies itself
without guesswork: **every** cancellation since this commit records `cancelledBy`,
so a CANCELLED row with `cancelledBy` null is by construction older than the
migration. Those are counted as `cancelledWithUnknownPaymentState`, reported with
`complete: false`, and named in the note. The blanket "cancelled deposits may or
may not have been taken" caveat is gone; when the count is zero the response says
every cancellation in range is accounted for exactly.

One consequence worth stating: a deposit that was paid and then cancelled *by the
business* currently counts as collected, because refunds do not exist yet. When
they do, this figure must subtract them — see below.

### 33.5 What is still outstanding before refunds can ship

The data side is now clear. The **money** side is not, and the open question is
not about cancellation at all:

**How does deposit money reach businesses?** Today it does not. Deposits land in
MTN's collection account and nothing moves them onward (§17, and the "No payouts"
note). `businessAmountCents` records what a business is *owed* of each deposit;
no wallet, ledger or payout run exists to pay it.

That gap decides where the gateway-fee debit lands. §25 says the business bears
the 1–2% the gateway charges on a refund it caused — but "the business bears it"
has to be a mechanism, and every candidate depends on the payout model that does
not exist:

- net it off the next payout — requires payouts;
- hold it as a negative balance — requires a wallet;
- bill it separately — requires collecting money *from* businesses, which
  nothing does.

`BillingAdjustment` already models the row (`GATEWAY_FEE_DEBIT`, `settledAt`,
`settlementRef`) and §25.3 already records that nothing writes or settles those
rows. So the refund module is blocked on **the payout/wallet decision**, not on
cancellation data. That is the next thing to settle.

---

## 34. The ledger (2026-09-02)

§33.5 said refunds were blocked on the payout model. This is the first of three
commits that build it. **This one changes nothing a user can observe. It
records.**

### 34.1 What existed before: nothing

There was no payout, balance, transfer, settlement or wallet code anywhere —
the honest answer, as it was for invoicing in §24.7. `BillingAdjustment` models
a correction and §25.3 already recorded that nothing writes or settles those
rows. The MoMo integration is **collections only**: it holds one subscription
key pair and calls `/collection/token/`, `/collection/v1_0/requesttopay` and its
status endpoint. There is no disbursement client, no disbursement credential,
and `PaymentProvider` exposes exactly two methods, both inbound. So payouts are
manual by necessity, not by preference — see §35.

### 34.2 One table, signed amounts, and no balance column anywhere

`LedgerEntry` is an append-only row per money fact, signed from the **business's**
point of view: positive is owed to them, negative is owed back.

**A business's balance is always the SUM of its entries.** There is deliberately
no balance column, and there must never be one. A stored total and the rows that
justify it drift the first time a write fails halfway, and from then on nobody
can say which is right. Summing is cheap; it can only be wrong if an entry is
wrong, and an entry cannot be edited.

**Immutability is enforced by the database, not by convention.** A `BEFORE
UPDATE` trigger rejects any change to `type`, `amountCents`, `currency`,
`businessId`, `appointmentId`, `billingAdjustmentId`, `createdAt` or `id`. Only
`availableAt` and `payoutId` stay writable, because those record what *happened
to* an entry rather than what it *says*. Corrections are made by appending an
opposing entry. An edited ledger is not a ledger — if the history that explains a
balance can be rewritten to match whatever the balance was supposed to be, it has
stopped being evidence. Tested: four rejected mutations, one permitted one, and a
correction that leaves the original readable.

A deposit produces **two** entries, not one net row — `DEPOSIT_RECEIVED` and a
negative `PLATFORM_FEE` — because they are two facts that reverse independently:
a business cancellation hands back the deposit *and* the fee, as separate events
(§25). A single netted row could not express that. They sum to
`businessAmountCents` by construction, and a test asserts it.

### 34.3 When money becomes payable, and why the rule is not uniform

`availableAt` is null at insert and set when the appointment resolves. Funds are
held for a settling period in which a dispute can still arrive — not a
processing delay. Paying out inside it would mean clawing money back from a
business that already has it.

~~The hold is **7 days**.~~ **Superseded by §38 (2026-09-02): the hold is an
admin setting, `PlatformSetting.payoutHoldDays`, defaulting to 2 days.** The
hold in force at RESOLUTION time is the one that applies, and it is recorded on
the appointment as `payoutHoldDaysApplied`. The anchors below are unchanged.

| Outcome | Payable from |
|---|---|
| `COMPLETED` | `completedAt` + hold |
| `NO_SHOW` | scheduled **end time** + hold |
| Cancelled by `CUSTOMER`, deposit paid | scheduled **end time** + hold |
| Cancelled by `BUSINESS` | nothing released — a refund is owed (§36) |
| `SYSTEM_EXPIRY`, never paid | no entries exist at all |

The second and third rows are the point. Neither ever reaches `COMPLETED`, so
keying off `completedAt` would leave the business permanently unpaid for money
§2 says it keeps. The scheduled end time is the only date those appointments
have, and it is the right one: it is when the service would have happened.

**An unverified appointment does not sit unresolved forever.** The §16 auto-
transition sweep moves `BOOKED` → `NO_SHOW` and `IN_PROGRESS` → `COMPLETED` 24
hours after the end time, so every paid appointment reaches a resolved state and
becomes payable without anyone pressing a button. That sweep now releases the
ledger in the same transaction as the status change.

### 34.4 Exactly-once, and every write in a transaction

The deposit entries are appended inside the same transaction as the status
change, guarded by the same conditional `updateMany` that already prevented a
racing poll and status-read from both announcing a confirmation. A repeated
confirmation matches no `PENDING_PAYMENT` row, so no entries follow — tested with
three repeat calls. Release is idempotent for the same reason: it only touches
entries that are still unstamped.

Every money write in this commit is inside a transaction, including the
per-appointment writes in the auto-transition sweep, which were previously bare
updates. A confirmed deposit that failed to reach the ledger would be money the
platform holds and cannot account for.

### 34.5 Currency, and what is not designed here

An appointment carries three currency facts (§18): `currency` — always `USD`, the
internal unit of account — plus `providerCurrency`, `providerCurrencyAmountCents`
and `exchangeRateUsed`, recording what was actually charged and at what rate.
Ledger entries copy the appointment's `currency`, so **the ledger is denominated
in USD**, like every other money column in the schema.

A payout would plausibly have to be *paid* in the provider's currency, at the
rate on the payout date rather than the booking date — which is a real question
about who bears the movement between the two. **Not designed here, and not
guessed at.** Payout amounts are recorded in USD; converting them is a decision
for whoever wires up an actual transfer.

### 34.6 No backfill

Appointments that were paid before this existed have no entries and are not
payable through this system. There is no way to synthesise them honestly: the
entries would have to claim a `depositPaidAt` and a resolution date that were
never recorded for most of those rows (§33.4). They must be handled out of band,
and a business's ledger balance is a claim about the period since this commit,
not about all time.

### 34.7 A test now pins the `cancelledBy` inference

§33.4's analytics figure infers "`cancelledBy IS NULL` means the row predates
§33". That is only sound while every path writing `CANCELLED` sets it. A test
now reads `src/`, finds every `status: AppointmentStatus.CANCELLED` that sits
inside a `data:` block, asserts there are exactly two, and asserts each sets
`cancelledBy` in the same write — plus exercises both paths for real. A third
path added without it fails here, rather than quietly poisoning a money figure
months later.

---

## 35. Payout runs (2026-09-02)

The second of three. Money now leaves the ledger and becomes a payout — but
**no transfer API is called**, because there is none to call.

### 35.1 Payouts are manual, and that is the expected outcome

The MoMo integration is collections only (§34.1): one subscription key pair,
`/collection/token/`, `/collection/v1_0/requesttopay`, and its status endpoint.
There is no disbursement client, no disbursement credential, and
`PaymentProvider` has exactly two methods, both inbound. Nothing was found to
integrate, so nothing was invented.

A run therefore creates `PENDING` payouts, a human sends the money, and
`PATCH /admin/payouts/:id/mark-paid` records the provider's reference. The
reference is **required**: a payout marked paid with nothing to look it up by is
a claim that money moved which nothing can corroborate. `PayoutStatus` has no
`IN_PROGRESS` for the same reason — there is no transfer to be in the middle of.

### 35.2 What a run selects

Entries with **no payout** whose **`availableAt` has passed**. Both halves
matter: an unstamped entry that is not yet payable is money the platform holds
but does not owe yet.

Grouped in the database, not looped per business — the set of businesses with
money waiting is exactly what the `groupBy` returns, so there is no list to
iterate and no N+1.

A payout carries `amountCents`, but it is not the authority: the entries stamped
with its id are. The column exists so the figure a business was told survives an
entry being later reclassified by an opposing entry.

A run refuses to create a payout spanning two currencies rather than netting
across them at a rate this module does not own (§34.5).

### 35.3 A non-positive balance creates nothing, and stamps nothing

If a business's available sum is `<= 0`, **no payout is created and the entries
are left unstamped**. This is not an error path; it is the ordinary shape of a
business that cancelled a booking it had already been credited for.

Stamping them would be the bug. A stamped entry is settled, so stamping a
negative balance would quietly forgive the debt — the business would owe nothing
and the platform would have written off real money. Leaving them in the pool is
what lets the negative carry forward and net against the next earnings, which a
test walks through end to end: `-1000`, then `+2500`, produces one payout of
`1500` settling both.

This is the day-one case the spec called out, and it works on day one.

### 35.4 A failed payout returns its money to the pool

`mark-failed` requires a reason and **unstamps every entry the payout held**, in
one transaction. The entries were never wrong — only the transfer failed — so
they go back to being available and the next run picks them up. The `FAILED`
`Payout` row stays as the record that an attempt was made and why it did not
work. A failed payout that kept its entries stamped would strand that money
forever, invisible to every future run.

### 35.5 Two concurrent runs cannot pay the same money twice

Inside the transaction: select the available entries, create the payout, then
stamp with `updateMany` **conditional on `payoutId` still being null**. If the
stamped count is fewer than the selected count, something else took some of them
in between, and the whole transaction — payout included — is rolled back rather
than paying a partial, unexplained sum.

That works under the default isolation level: the loser blocks on the row locks,
re-evaluates the `payoutId: null` predicate, matches fewer rows, and aborts. It
needs no advisory lock and no serializable retry loop. The rolled-back run
leaves no payout behind, and its entries stay in the pool for the next one.

### 35.6 Balances are computed, never stored

`GET /businesses/:id/balance` sums entries on read — available now, pending
(`availableAt` in the future), unresolved (`availableAt` still null, i.e. the
appointment has not ended), and lifetime paid from `PAID` payouts only. A
`PENDING` payout is not "paid": it has not gone out.

Consistent with §34.2, none of this is stored. A test appends one entry between
two reads and asserts the figure moves — the only way it can move.

A negative available balance is returned as a negative number with a note saying
what it means, rather than clamped to zero. A business seeing `0` when it owes
money would find out at the worst possible moment.

### 35.7 Access

Two-layer throughout (§27.1). `@Roles(ADMIN)` on the admin controller and an
`assertAdmin` in the service; `@Roles(BUSINESS, ADMIN)` on the business routes
and an `assertMayRead` that lets an admin read any business and a business user
only their own — **404, not 403**, matching the rest of the platform. Tested at
both levels: service-level refusals for every role, and over HTTP through the
real guard chain.

`BusinessRolesGuard` is deliberately not used on the business routes, for the
same reason analytics does not use it: it requires an active membership, and an
admin has none.

### 35.8 Scheduling

A daily `@Cron` at 02:00 alongside the existing sweeps. Daily rather than
hourly because entries mature on a seven-day hold, so the difference is noise —
and because a human currently makes each transfer by hand, so batching matters.
The manual `POST /admin/payouts/run` stays regardless: a scheduled job nobody can
trigger is one nobody can test or use to fix a bad day.

---

## 36. Business-cancellation refunds, and executing adjustments (2026-09-02)

The third of three. §25's refund policy, written in October and unexecutable
until §33 recorded who cancelled, now runs.

### 36.1 What a business cancellation appends

Three entries, all payable immediately — the appointment is not happening, so
the seven-day settling window has nothing to settle:

| Type | Amount |
|---|---|
| `DEPOSIT_REFUND` | `-depositAmountCents` |
| `PLATFORM_FEE_REVERSAL` | `+platformFeeAmountCents` |
| `GATEWAY_FEE_DEBIT` | `-gatewayChargeCents` |

The first two net to exactly `-businessAmountCents`, cancelling the pair
appended when the deposit landed and returning the business to **zero** for that
appointment. That is what "refunded in full, including the platform fee" means
in ledger terms: the platform gives up its own cut rather than making the
business fund it. The customer gets the whole deposit back, not the deposit less
the fee — asserted directly.

The gateway charge is then the third, separate fact, and the only part of a
business cancellation the business actually bears. With a charge of zero the
business lands at exactly zero; with 50c it lands at −50c, which is a negative
balance that blocks its next payout and carries forward (§35.3). The full path
is tested end to end.

The deposit pair is released at the same time — settled by being reversed.
Leaving it unreleased would hide the refund from every payout run, and the debt
with it.

Refunding twice is refused: the method looks for an existing `DEPOSIT_REFUND` on
the appointment and throws.

### 36.2 The gateway charge is supplied, never derived

**The integration does not expose it.** `checkPaymentStatus` parses exactly two
fields off MTN's response — `status` and `reason` — and neither
`PaymentProvider` nor the MoMo client has any notion of a fee, charge or
commission anywhere. So the second branch of the spec applies: `gatewayChargeCents`
is an explicit figure supplied by whoever performs the cancellation-refund, and
it is **required** when a business cancels an appointment whose deposit was paid.
Not required when nothing was ever collected — there is no refund to be charged
for.

It is deliberately not computed from a percentage constant. A ledger that
asserts a fee the provider actually charged differently is a ledger nobody can
reconcile, and the whole point of §34 is that the rows explain the balance.

### 36.3 A customer cancellation and a no-show append nothing

The absence **is** the behaviour, so it is tested as one: after either, the
appointment still has exactly its two original entries, no `DEPOSIT_REFUND`
exists, no `GATEWAY_FEE_DEBIT` exists, and the net is `businessAmountCents`. The
existing entries simply become available per §34.3.

### 36.4 The admin dispute path calls the same code

`PATCH /admin/appointments/:id/business-cancellation` sets `cancelledBy =
BUSINESS`, leaves `cancelledByUserId` as the **admin** who acted, links the
ticket, and calls `recordBusinessCancellationRefund` — **the same method**, not a
second implementation. Two refund paths drift, and the one that drifts is the
one used rarely, under pressure, in a dispute.

A test asserts the entries are identical in type, sign, amount and currency to a
self-service cancellation's. Reclassifying twice is refused, so it cannot refund
twice, and a completed appointment cannot be reclassified at all.

This is the divergence §33.2 kept `cancelledBy` and `cancelledByUserId` apart
for, now doing real work.

It lives on an admin **appointments** route rather than inside ticket
resolution: the constraint was not to touch Tickets beyond adjustment execution,
and an optional `ticketId` gives the audit link without reaching into that
module.

### 36.5 Executing a BillingAdjustment

`PATCH /admin/billing-adjustments/:id/execute` emits an `ADJUSTMENT` entry
signed by the adjustment's type — `FEE_REFUND` positive, `GATEWAY_FEE_DEBIT`
negative, both from the business's perspective — sets `settledAt` and
`settlementRef`, and links the entry back via `billingAdjustmentId`. This is what
§25.2 renamed those columns for; until now nothing wrote them and every
adjustment was unsettled by definition.

`amount` is a `Decimal` in **major** units and the ledger is integer cents, so
the conversion runs through `Prisma.Decimal` with `ROUND_HALF_UP`, like every
other money conversion here — never float arithmetic.

**Executable exactly once**, enforced by requiring `settledAt` to still be null
inside the transaction. A twice-executed adjustment is a business paid, or
charged, twice for one decision. Tested, including that no second entry is
written.

`settlementRef` is optional here, unlike a payout's required reference: some
adjustments are settled by netting against a future payout rather than a
separate transfer, and inventing a reference for those would make a
reconciliation look complete when it is not.

### 36.6 Reconciliation

`GET /admin/ledger/held` returns the sum of every entry with no payout, by
currency, matured or not — matured money is still in the platform's hands until
a transfer actually goes out. This is the figure to compare against the
provider's balance.

Nothing compares it automatically, and that is deliberate for now: a
reconciliation that runs itself and reports "fine" is worse than one a human
performs, until there is something real to reconcile against. Tested that it
equals the sum of unstamped entries, that settled entries drop out of it, and
that unmatured money is counted.

### 36.7 What is now closed, and what is not

§33.5's blocker is cleared: deposits reach businesses through payout runs
(§35), and the gateway-fee debit lands as a negative ledger entry that nets
against future earnings — which was the open question about *where* it lands.

Still open, and now the next real decision:

- **No transfer is automated.** Every payout is sent by a human and recorded by
  hand (§35.1). That is correct given a collections-only integration, but it does
  not scale, and MTN Disbursements would need its own subscription, credentials
  and provider class.
- **Payout currency.** The ledger is USD; a business is paid in SSP. Nothing
  decides which day's rate applies or who bears the movement between the payout
  being calculated and the money being sent (§34.5).
- **Pre-§34 appointments have no entries** and are not payable through this
  system. They must be settled out of band.

---

## 37. Exchange-rate staleness (2026-09-02)

### 37.1 There is no display conversion, and no window

**The customer never sees an SSP figure from this platform before paying.**
`convertUsdCentsToProviderCents` is called in exactly one place —
`initiateDepositPayment` — and nowhere else in `src`. Service prices, deposits
and every appointment response are USD; the provider-currency amount first
exists on the customer's handset, in MTN's own prompt, and is written back to
`providerCurrencyAmountCents` afterwards.

So the question of whether the displayed rate and `exchangeRateUsed` can differ
has a clean answer: **they cannot**. There is one read of `getExchangeRate()`
per payment attempt, and the same `rate` variable both computes the charged
amount and is persisted as `exchangeRateUsed` on the appointment. No second read,
no window.

The one real interval is between that read and the customer approving the prompt
on their phone — seconds to minutes. The amount is fixed at the read rate for the
whole of it, which is correct: the customer approves a specific figure, and an
admin changing the rate mid-prompt must not change what they agreed to. A failed
attempt clears the reference (§17.3), and a fresh attempt reads a fresh rate,
which is also correct.

### 37.2 The rate's shape, and what was already there

A single admin-set `Decimal(18,8)` on the singleton `PlatformSetting` row,
nullable with no default, `providerCurrency` alongside it. Payment initiation
fails loudly when it is unset rather than falling back to anything.

It **was already timestamped** — `exchangeRateUpdatedAt`, surfaced with
`ageInHours` on the admin endpoint. What was missing: who set it, any definition
of "too old", and anything that told a human when it drifted past that. Those are
what this commit adds; the timestamp was not re-added.

### 37.3 Loud, never fatal

Added:

- `exchangeRateUpdatedById` — a manually-maintained rate that looks wrong is a
  question with an answer, and "when" alone does not say who to ask.
- `exchangeRateStalenessHours`, default **24**, admin-settable, 0–720.
  Configurable because the right threshold depends on how fast the currency is
  actually moving: 24 hours suits a stable pair and is far too slow for a
  collapsing one. Zero means "always warn", which is a legitimate setting here.
- `stale` and a `warning` **field** on every admin response exposing the rate.
  A field rather than only a flag, so the reader does not have to know what
  `stale: true` implies; null when there is nothing wrong, so the presence of
  the key is itself the signal. The warning says explicitly that deposits are
  still being charged at the rate.
- An hourly sweep that notifies every admin, **debounced to once a day** per
  stale spell via `exchangeRateStaleNotifiedAt`. A warning that arrives every
  hour is one people filter, and then the real one lands in a folder nobody
  reads. Updating the rate clears the marker, so a later stale spell warns
  promptly instead of a day late.

**Nothing blocks.** No booking, no payment initiation, no read is refused
because the rate is old — a stale rate is still served and still charged at.
A platform that stops taking money because nobody updated a setting is worse
than one charging a slightly old rate. There is a test asserting exactly that:
a 500-hour-old rate is still returned by `getExchangeRate()`.

An **unset** rate is deliberately not reported as stale. It is missing, not old,
and payment initiation already refuses outright on it — filing the two under one
heading would hide the fatal case behind the cosmetic one.

---

## 38. The payout hold becomes a setting (2026-09-02)

§34.3 held funds for a hardcoded 7 days. That is a product decision, not a
technical one, so it now sits beside the platform fee and the exchange rate.
**Default 2 days.**

### 38.1 The hold in force at RESOLUTION is the one that applies

Read once, when the appointment resolves, and never read again for that
appointment. Changing the setting affects appointments that resolve **after**
the change; it never rewrites an `availableAt` that is already set.

That is the whole rule, and it exists because an `availableAt` is a date a
business has already been shown. Moving it because an admin changed a setting is
changing a promise after the fact — and it would move in both directions,
including money a business had been told was coming tomorrow.

Tested in one assertion pair: two identical appointments, one resolved under a
2-day hold and one under a 10-day hold, land on dates 8 days apart from the same
anchor, and changing the setting to 30 afterwards moves neither.

### 38.2 The applied hold is recorded

`Appointment.payoutHoldDaysApplied`, written by the same transaction that sets
`availableAt`. Nothing stores the setting's history, so without this a business
asking "why is this payable on the 14th?" could only be answered with *today's*
hold, which may not be the one that produced the date.

On the appointment rather than the entry, because the entry is append-only
(§34.2) and the hold is not part of what an entry *says* — and because refund
and adjustment entries are payable immediately, with no hold involved at all.

Null for appointments not yet resolved, and for anything resolved before this
existed.

### 38.3 The anchors are unchanged, and they still do not line up

Confirmed by test rather than assumed. With a 2-day hold:

| Path | Payable |
|---|---|
| Auto-completed by the sweep | `completedAt` + 2d ≈ **end + 3 days** |
| Auto-no-showed by the sweep | `endTime` + 2d = **end + 2 days** |
| **Manually** completed | `completedAt` + 2d ≈ **end + 2 days** |

The extra day appears only when the 24-hour auto-transition sweep does the
completing. A business that presses the button itself is paid from when it
pressed it; the gap is the price of not pressing it.

**I do not think these should be made to line up, and I am not proposing a
change.** Two reasons:

1. A `NO_SHOW` has no `completedAt` to key off — that is precisely why the
   anchor differs — so lining them up would mean anchoring `COMPLETED` to
   `endTime` too. That would start the hold before the service was confirmed
   delivered, which is the one thing the hold exists to wait for.
2. The gap is not a penalty for the *customer's* no-show; it is an incentive for
   the business to close out its own appointments, and it disappears the moment
   they do.

If it does need changing later, the honest fix is to shorten the sweep's 24-hour
grace period, not to move the anchor — but that grace period is doing separate
work (§16) and should not be touched for a payout reason.

### 38.4 Access, and a note on the rest of the settings module

Validated 0–30 days. Zero is allowed and means "payable immediately", a
deliberate choice for a platform that trusts its businesses. Thirty is the cap:
past a month a hold stops being a settling window and becomes the business
financing the platform.

The two hold methods take the actor and assert `ADMIN` in the service as well as
in the guard, per §27.1. **The sibling fee and exchange-rate methods do not** —
they predate that rule and remain guard-only. Widening them is a refactor of the
settings module in its own right, and smuggling it into a commit about the
payout hold would make both harder to review. Logged here as outstanding.

---

## 39. Approximate SSP alongside USD (2026-09-02)

Customers in Juba shop in pounds; every price this platform shows is USD (§18).
Customer-facing reads now carry an indicative local-currency figure beside each
USD amount. **USD remains the authoritative price and the unit of account.**

### 39.1 What surfaces actually exist

Worth stating plainly, because the brief assumed more of them than the codebase
has: **there are no public service-listing or location-browsing endpoints.** The
only routes reachable without a business account are
`GET /locations/:id/availability` and `GET /locations/:id/reviews`, and neither
carries a money amount. Services are listed only through `GET /business/services`,
which is business-facing by definition.

So the customer-facing money surface is the appointment, and that is what
changed:

| Response | Changed |
|---|---|
| `POST /appointments` (create) | yes — always a customer |
| `GET /appointments` (list) | yes, when the caller's role is CUSTOMER |
| `GET /appointments/:id` | yes, when the caller is the appointment's customer |
| `POST /appointments/:id/cancel` | yes, same test — the route is shared |
| Business transitions (verify / complete / no-show) | no |
| `PATCH /admin/appointments/:id/business-cancellation` | no |
| Everything else | no |

Three of those routes are shared between a customer and a business member, so
the figure follows **who is reading**, not which endpoint they used. Tested over
HTTP: the same appointment, fetched by both, differs only by the presence of
this field.

### 39.2 Shape, and the one deviation

Per amount, keyed by the USD field it converts:

```
depositAmountCents: 900,
approxSettlement: {
  depositAmountCents: { currency, amountMinor, exchangeRate, rateAsOf, approximate },
  ...
}
```

The brief's shape was an `approxSettlement` object beside each amount. A single
top-level object would have been ambiguous about which amount it converted, and
four suffixed sibling keys would have bloated the response — so the object is
keyed by field name. The substance is unchanged: one figure per amount, so **a
client never converts anything itself**, which was the requirement.

Every USD amount gets one, the fee split included. Converting a subset would
leave a client converting the rest, which is the thing this exists to prevent.
`providerCurrencyAmountCents` deliberately gets none — it is already in the
provider's currency. A **null** amount is skipped rather than converted to zero:
a missing price and a free one are different claims.

**Rounded to whole units.** The rate behind this is set by hand and may be a day
old (§37), so presenting piastres would claim precision the number does not
have. `amountMinor` keeps the platform's integer-minor-units convention and is
therefore always a multiple of 100 — the rounding is in the value, not the unit.

One thing this commit had to fix in passing: `getExchangeRate()` logs an ERROR
when the settings row is missing, which is right for the payment path and wrong
for a display read that now runs on every customer request. An unconfigured rate
would have produced an error every few seconds, which is how a log stops being
read. Display uses `getExchangeRateForDisplay()`, which returns null quietly.

### 39.3 Rules, and who does not get it

- **One rate read per response**, reused for every item in a list. A page whose
  two items were converted at different rates would be indefensible to anyone
  comparing them, and it would happen precisely when the rate moved
  mid-request. Asserted by spying on the read and requiring exactly one call.
- **Unset rate → the field is absent.** Not zero, not null, not a placeholder.
- **Stale rate → the figure is still shown.** Staleness is an admin problem and
  is surfaced to admins (§37); degrading what a customer sees over it would
  punish the wrong person. `rateAsOf` is disclosed, so a client can label it.
- **Business and admin views stay USD-only.** A business prices in USD and is
  paid against USD (§35), so an indicative pound figure in their view would
  invite them to reconcile a payout against a number that means nothing.

**Never persisted, never compared, never calculated with, never accepted as
input.** There is no column, and the global `forbidNonWhitelisted` pipe rejects
`approxSettlement` on writes with a 400 rather than ignoring it — tested on two
write endpoints. A test also asserts the appointment row is byte-identical
before and after a rate change that visibly moves the displayed figure.

### 39.4 The gap between shown and charged is the point

`initiateDepositPayment` still converts from its own rate read and holds that
figure from the read until the customer approves MTN's prompt. Unchanged, and
tested to be unchanged: the charge keeps full precision while only the *display*
figure rounds to whole pounds.

So a displayed figure can differ from the charged one if the rate moves between
browsing and paying. That is exactly why it is labelled `approximate: true` — a
literal, not a computed flag, because it is never false.

**No rate is locked or reserved at browse time**, deliberately. A quoted rate the
platform cannot honour is worse than an honest approximation: honouring it would
mean either eating the difference on every stale quote or refusing payments that
drifted, and both are worse failures than a customer seeing "approximately".

---

## 40. Enforcing deposit >= platform fee (2026-09-02)

`businessAmountCents = deposit − fee`, and both derive from the service price
(§2.1). So a service whose `depositPercentage` is below the platform fee
percentage prices every booking with a **negative business share** — the
business paying to take work. This closes that off from both directions and
adds a backstop for whatever a future change opens.

### 40.1 State of the data before the change

Reported before touching anything, since it decided whether a data fix was
needed:

| depositPercentage | services | active |
|---|---|---|
| *(no rows)* | 0 | 0 |

**Zero services exist in the database**, and therefore zero active services
below the current 10.00% fee. No backfill or data correction was required, and
none was performed.

### 40.2 Three layers

**At service create and update — already existed.**
`ServicesService.assertDepositCoversPlatformFee` was written in §16.3 and reads
the fee live on every write. Only its message changed: it now states *why*
rather than only the number, because "must be at least 10.00%" tells a business
what to type without telling them what they would have been agreeing to.

**At platform-fee change — new.** `PlatformSettingsService` now refuses an
**increase** that would leave any ACTIVE service's deposit below the new fee.
The rejection carries `offendingCount` and up to **20** offenders (service id,
business id and name, service name, current deposit percentage) so the admin can
start the conversation immediately rather than go hunting.

- **Nothing is auto-raised.** Silently rewriting a business's deposit
  percentage changes their pricing without their knowledge — a far worse outcome
  than a failed admin request, given fee changes are rare and admin-only.
- **INACTIVE services are ignored.** A soft-deleted service takes no bookings,
  so it cannot produce a negative share; blocking on one would let a business's
  archive permanently veto a platform decision.
- **Decreases and no-op sets are always allowed.** Lowering the fee can only
  widen the margin.
- The check runs **before** the write, so a refused change leaves both the fee
  and everybody's pricing exactly as they were. Tested.

**In the money path — new.** `computeAppointmentAmounts` throws if the fee
exceeds the deposit. With the two checks above this is unreachable, which is the
point: a negative `businessAmountCents` must never reach the database whatever
route a later change opens.

It **never clamps to zero**. A clamp hides the misconfiguration and quietly
moves the business's money to the platform — the failure would be invisible
until someone reconciled a payout months later. The exception stops the booking
and names both percentages. It throws a plain `Error`, not a
`BadRequestException`: this is a server-side invariant violation, and a 500 is
the honest signal. Blaming the caller for a misconfigured platform would send
whoever debugs it to the wrong place entirely.

### 40.3 What did not change

The rounding and the subtraction that derive `businessAmountCents` are
untouched. `ROUND_HALF_UP` on both percentages, business by subtraction, and the
invariant `platformFee + business == deposit` all hold exactly as before.

### 40.4 The `deposit == fee` case, end to end

Legal, and now tested as a whole path rather than merely permitted:

- `businessAmountCents` is exactly `0` and `platformFeeAmountCents` equals the
  full deposit
- the two ledger entries net to `0`
- a payout run creates **no payout** for that business, because zero is not
  positive (§35.3), and the entries stay unstamped

That is the correct outcome: the deposit exists only to make the customer's
commitment real, and the business collects its entire take offline. A business
in this configuration should expect to see nothing from the platform, ever, and
the balance endpoint reports exactly that.

At `deposit > fee` the share is positive and pays out normally — also tested, so
the two cases are distinguished by behaviour and not by assertion alone.

---

## 41. Closing the last guard-only admin surfaces (2026-09-02)

§27.1 set the two-layer rule: an admin-only operation asserts the role in the
service as well as in the guard, because `@Roles(ADMIN)` is a decorator on a
controller class and a service method that trusts it is one refactor — or one
new caller — away from being reachable by anyone.

Three surfaces still relied on the guard alone. §38.4 logged the settings one;
**the reviews and tickets ones were never recorded anywhere**, which is the more
useful half of this entry.

### 41.1 What was open, and what it means

**`PlatformSettingsService`** — the platform-fee and exchange-rate methods took
no actor at all. Every method that reads or writes platform configuration now
takes one and asserts `ADMIN`.

**`ReviewsService.hide` / `unhide`** — took a bare `adminId: string` and trusted
the caller to have checked. A string parameter named after a role is not a
check: nothing stopped a future caller passing any user id. Both now take the
acting user.

**`TicketsService`** — three separate problems, and only one was a real hole:

- `assign` took **no acting user whatsoever**, only the id of the admin to
  assign *to*. Now asserts.
- `transitionStatus` takes `actor: 'ADMIN' | 'REPORTER' | 'SYSTEM'` as a
  **literal supplied by the caller**. The transition table checked which actor
  *may* make a move but never that the caller actually was that actor — so any
  future caller could move a ticket as an administrator simply by saying so. It
  now takes `actorRole` and verifies the claim. `REPORTER` and `SYSTEM` are
  unaffected: the reporter path is already scoped by `visibilityScope`, and the
  sweep is the system.
- `addMessage` was **not** a hole and was left alone. It is shared between the
  reporter and admin controllers, already scopes by `visibilityScope(user)`, and
  already refuses a non-admin posting an internal note. Asserting `ADMIN` there
  would have broken the reporter route — the fix would have been the bug.

**`AdminLedgerController`** asserted the role in the *controller body*, which is
functionally two-layer but structurally unlike everywhere else. The assertion
moved into `LedgerService` (`heldTotals`, `executeAdjustment`), so the rule is
"the service asserts" with no exceptions to remember.

**`AppointmentsSharedController`** carried no `@Roles` at all. `RolesGuard`
returns `true` when the decorator is absent, so an ADMIN token reached
`findAll` and was refused by the **service** — the same fall-through already
fixed in Chat (§23.1) and in `findAll` itself. It now declares
`@Roles(CUSTOMER, BUSINESS)`, and the service check stays as the second layer.

### 41.2 One deliberate asymmetry: the payout run

`POST /admin/payouts/run` called `PayoutsService.run()`, which takes no actor —
and must not require one, because the daily cron is a legitimate caller with no
acting user.

Rather than make the actor nullable (an optional actor is an actor that is easy
to pass as `undefined`, which is how this class of hole reappears), there are now
two methods: `run()` for the scheduler and `runAsAdmin(actor)` for the endpoint.
"The system may run this" and "only an admin may ask for it" stay two separate
statements. Both paths are tested.

### 41.3 Result

**Every admin-only or role-restricted service method now asserts its own role.**
Verified by enumerating every route on every controller declaring
`@Roles(ADMIN)` and following each to its service call. Nothing is guard-only.

Two categories deliberately do **not** assert a role, and should not:

- **`getExchangeRateForDisplay()`** — the customer-facing read behind §39. It
  exposes only a rate a customer is about to be charged at, and gating it would
  break the display path it exists for.
- **The `/business/**` surface** — `BusinessRolesGuard` resolves the caller's
  ACTIVE membership and attaches it, and the services take an already-resolved
  `businessId`. The second layer there is the query scoping (§5.4), not a role
  string. That is a different mechanism, not a missing one.

A service-level test with a non-admin actor now exists for every hardened
method, asserting both the refusal and that nothing was written.

---

## 42. Business approval (2026-09-02)

`BusinessStatus` has gated every public read since §13.2, but **nothing could
set it**. A business could only be approved by editing the database by hand,
which meant the entire public surface was unreachable in practice — the feature
existed and could never fire.

### 42.1 One surface was not gated at all

Availability (§13.2), the review listing (§28) and chat inquiries (§21) all
refused a non-`APPROVED` business. **`POST /appointments` did not check the
status at all.** A customer holding a location id could book with a business
that was suspended, rejected, or had never been approved.

Fixed here. Booking now refuses with **404, not 403** — the rule used
everywhere: a business that is not public does not exist as far as a customer is
concerned, and "this business is suspended" would leak a moderation decision to
someone with no standing to receive it.

`isPubliclyBookable(status)` is now a single exported predicate, so the four
call sites cannot drift into disagreeing about what "open for business" means.

### 42.2 One reason field, not one per state

`rejectionReason` is replaced by `statusReason`, plus `statusChangedAt` and
`statusChangedById`. A field that can only describe one of four states is a
field that is wrong three-quarters of the time; the migration carries existing
rejection reasons across before dropping the old column, because a rejection
reason is the only thing a rejected applicant has been told.

`statusReason` is **cleared** on approval and reinstatement. A stale rejection
reason sitting beside an APPROVED business reads as an accusation.

### 42.3 A declarative transition table

`business-status.ts` follows `ticket-status.ts`, deliberately — **not** the
appointment lifecycle, whose rules live in guard clauses across five methods
(§16.1) with no single place to read them.

| From | To | Reason required |
|---|---|---|
| `PENDING` | `APPROVED` | no |
| `PENDING` | `REJECTED` | **yes** |
| `REJECTED` | `APPROVED` | no — an appeal; there is no resubmission flow |
| `APPROVED` | `SUSPENDED` | **yes** |
| `SUSPENDED` | `APPROVED` | no — reinstatement |

Anything else throws. **Nothing returns to `PENDING`**: a decision cannot be
un-made, only replaced by another decision. A test derives the illegal set from
the table itself, so a new rule cannot be added without the test seeing it.

A reason is required exactly where the business is being told something bad.
Demanding one for approval too would produce boilerplate that makes the required
reasons look equally unimportant.

Every route funnels through one private `transition`, so the table, the audit
stamp and the notification cannot get out of step.

### 42.4 What each status does

**Not APPROVED** → invisible to availability, reviews and chat, and **new
bookings are refused** (§42.1).

**SUSPENDED does NOT cancel existing appointments.** Customers who already
booked keep them and the business is still expected to honour them. Cancelling
wholesale would punish customers for the business's conduct — they chose a time,
arranged their day, and paid a deposit. Tested: a suspension leaves a booked
appointment byte-identical.

**SUSPENDED DOES pause payouts.** The run skips those businesses and **leaves
their entries unstamped** — nothing is written off, the money simply waits, and
the first run after reinstatement pays it. Suspension usually means something is
wrong with the money or the conduct, and paying out mid-investigation is hard to
undo; leaving entries in the pool is not.

**This one is reversible if it proves wrong.** It is a `Set` membership check in
`PayoutsService.run` and a note on the balance response — deleting both restores
the previous behaviour with no data migration, because nothing about a paused
payout is persisted. If it turns out businesses are more often suspended for
paperwork than for fraud, holding their money will be the wrong default.

**The business keeps its dashboard**, and `GET /business/profile` now returns
`statusReason` and `statusChangedAt` alongside the status. `GET
/businesses/:id/balance` reports `payoutsPaused: true` with the reason and says
explicitly that nothing has been written off. Being suspended without being told
why is worse than the suspension — the business would otherwise discover it from
a customer who cannot book.

### 42.5 Endpoints and notifications

`GET /admin/businesses` (filterable, paginated, **oldest first** — a queue
sorted newest-first reads the person who has waited longest last),
`GET /admin/businesses/:id` (locations, services and members, so an admin can
actually decide), and the four transitions. All `@Roles(ADMIN)` plus a
service-level assertion, per §41.

Four new notification types go to every ACTIVE member: `BUSINESS_APPROVED`,
`BUSINESS_REJECTED` and `BUSINESS_SUSPENDED` (both with the reason), and
`BUSINESS_REINSTATED`. The suspension copy states plainly that existing
appointments still stand and that held money has not been lost, because those
are the two things a suspended business will assume the worst about.

---

## 43. Discovery and browsing (2026-09-02)

The platform had no customer front door. Nothing listed businesses, locations or
services to the public, so a customer had no way to obtain the location id that
every customer endpoint requires. The feature set was complete and unreachable.

### 43.1 Four answers that shaped the design

**(a) Services belong to the BUSINESS, not the location.** `Service.businessId`,
no `locationId`, and `AppointmentsService.create` proves the intent by checking
`service.businessId === location.businessId` and rejecting the mismatch. A
service is therefore offered at **all** of a business's locations (§10.2), so a
location's cheapest price is a property of its business — which is why
`cheapestByBusiness` groups by `businessId` and two branches of one salon
genuinely show the same `fromPriceCents`.

**(b) A single platform timezone already exists.** `PLATFORM_TIMEZONE`, default
`Africa/Juba`, read by `AvailabilityService` (§12). No per-location timezone is
stored anywhere. Discovery reuses that constant and the existing `time.util`
helpers rather than inventing a second notion of "today" — if the two disagreed,
"open now" and the availability calendar would contradict each other for the
same location.

**(c) Zero locations exist**, so zero are missing coordinates. **No business has
to be asked to add them**, and there is nothing to backfill.

**(d) Offset/limit**, response shaped `{ total, limit, offset, items }` — the
convention in six existing services. Followed exactly; no cursor.

### 43.2 Coordinates are required for new locations

`POST /business/locations` now requires `latitude` and `longitude`, range-checked
and with **0,0 rejected** — a valid pair of numbers and almost never a real
place. It is what a form submits when both fields were empty, or a geocoder
returned zeroes, and accepting it would put every misconfigured business at the
same point in the Gulf of Guinea, each one the others' nearest neighbour.

`PATCH` **cannot clear** coordinates that exist: clearing would silently drop a
location out of every distance search, which reads to the business as the
platform losing their listing. A location that lacks them may have them added,
which is exactly how a pre-§43 row becomes discoverable.

**The columns stay nullable.** Existing rows genuinely have no coordinates and
there is nothing honest to backfill them with. They still appear in ordinary
browse; they are excluded only from distance search, because a distance to an
unknown point cannot be computed and must not be faked.

### 43.3 A result is a LOCATION

Everything customer-facing here is already location-scoped — availability,
reviews, `ratingAvg`, hours, gallery — so a branch is the unit a customer
actually chooses between. Returning businesses would mean a customer picking a
company and then being asked a second question the data was already organised to
answer.

Only publicly bookable businesses appear, through `isPubliclyBookable()` from
§42 — not a second status check. A non-public location 404s on detail, matching
availability and reviews.

### 43.4 Query budget

**A page of any size costs a fixed number of queries. None are per-row.**

| # | Query |
|---|---|
| 1 | count |
| 2 | the page of locations (with business, category, subcategory joined) |
| 3 | ~~cheapest active service, **grouped by business**, for the whole page~~ **removed in §44 — it is a column now** |
| 4 | `LocationHours` for the whole page, today's weekday only |
| 5 | today's `LocationScheduleException` for the whole page |
| 6 | the exchange rate, once per response |
| (+1) | the bounding-box + haversine prefilter, only when searching by distance |

So **six, or seven with distance** — the same for 1 result as for 20. Asserted by
spying on each lookup and requiring exactly one call on a 20-result page.
**§44 removes row 3, bringing it to five (six with distance).**

*(The exchange-rate read was omitted from this table when it was first written;
it is a query and is counted here.)*

The exchange rate is read **once per response** and reused for every
`approxSettlement` in it (§39). A page whose rows converted at different rates
would be indefensible to anyone comparing them.

### 43.5 Distance without PostGIS

A bounding box on `(latitude, longitude)` — now indexed — cuts the candidate set,
then haversine is computed **in SQL** over what survives, in a subquery whose
outer `WHERE` applies the radius. The box is a superset of the circle (its
corners are farther than the radius), so the radius filter is what actually
enforces the limit.

`$queryRaw` is appropriate here for the reason §29 already established for the
busiest-hour aggregate: Prisma's builder cannot express a computed ordering key.
The aggregation stays in the database either way.

Two details worth keeping: the longitude delta is divided by `cos(latitude)`,
clamped at 0.01 so a search near a pole cannot produce an infinite box; and
`radiusKm` is capped at 200 km, which is what bounds the candidate set a
distance sort has to hold in memory to order it.

A test asserts a **computed distance against hand arithmetic** — 0.1° of
latitude is 11.12 km, from `6371 × π / 180` — not merely that ordering looks
right. Ordering can be right while every distance is wrong.

### 43.6 Text search, sorting, and what was deliberately not built

**Text search is a case-insensitive substring** over business name, location name
and service name (`contains` + `mode: 'insensitive'`). **No full-text index, no
trigram extension, no new dependency.** It will not handle typos, stemming or
relevance ranking, and when that becomes the complaint the answer is Postgres
full-text search — a decision worth making with real queries in front of it
rather than guessed at now.

**`sort=price` falls back to ordering by name.** The price lives on the
business's services, not on the location row, so SQL cannot order by it without
a join-and-aggregate that would change the query budget above. Stating it here
rather than shipping a sort that silently does nothing: `maxPriceCents` filters
correctly, and `fromPriceCents` is returned on every row, so a client can order a
page itself. If price ordering matters across pages, it needs a denormalised
`Location.fromPriceCents` maintained on service writes — the same shape as
`ratingAvg` — and that is a bigger decision than this module.

**Reviews are not embedded** in the detail response. `GET /locations/:id/reviews`
already exists, is paginated, and has its own exposure rules (§31); duplicating
them would mean two places to keep those rules right.

### 43.7 Open now, and the boundary

`openNow` uses the platform timezone from (b) and resolves the day exactly as
availability does (§13.1): **a date-specific exception outranks the weekly
template**, including one that opens a day the template calls closed.

**Boundary convention: half-open, `[open, close)`.** A location open 09:00–17:00
is open at exactly 09:00 and **closed at exactly 17:00**. This matches every
other interval in the codebase — slot overlap, `[from, to)` date ranges — and it
is the honest answer: at 17:00 the shop is shutting, and saying "open" sends
someone to a locked door.

Malformed or inverted stored hours are treated as **closed** rather than
throwing. Overnight hours (close ≤ open) are not modelled anywhere in this
platform — availability does not generate slots across midnight either — so such
a row is closed rather than silently guessed at. A search that 500s because one
location has a corrupt hours row is worse than one that omits it.

---

## 44. Denormalised `Location.fromPriceCents` (2026-09-02)

§43.6 shipped `sort=price` falling back to ordering by name, and said plainly
that real price ordering would need a denormalised column maintained on service
writes. This is that column.

### 44.1 Why a column, and not a smarter query

A value derived at read time can **filter** a page but cannot **order** rows the
page never fetched. Sorting 26 locations by price with a limit of 5 requires the
database to know every price before it picks the five — which means the price has
to be a column it can `ORDER BY`.

Same pattern as `ratingAvg` / `ratingCount` on the same model: an aggregate
maintained on write, never computed on read. `fromPriceCents Int?` holds the
cheapest **ACTIVE** service price of the owning business.

**Backfilled in the migration**, unlike the appointment pricing snapshot (§30).
The distinction matters: this is a *derived* value with exactly one correct
answer available right now, so computing it recovers a fact. §30's columns
recorded inputs that were never captured, where any value would have been
invented.

### 44.2 One statement, never a loop

Services are business-scoped (§10.2), so **one service write changes the headline
price of every branch that business owns**. `recalculateFromPrice` is a single
correlated `UPDATE`:

```sql
UPDATE "locations" l
   SET "fromPriceCents" = (SELECT MIN(s."priceCents") FROM "services" s
                            WHERE s."businessId" = l."businessId" AND s."isActive")
 WHERE l."businessId" = $1
```

Raw SQL because the new value is an aggregate over another table, which Prisma's
`update` cannot express — the same judgement as the haversine in §43.5. A salon
with six branches costs one statement, not six, and a loop would additionally
leave those six briefly disagreeing with each other. Asserted: no per-location
Prisma write is issued at all.

`MIN` over an empty set is `NULL`, which is exactly the meaning wanted, so no
special case is needed.

### 44.3 Maintained inside the same transaction, on four paths

Service **create**, service **update**, service **deactivate**, and location
**create**. A catalogue that has changed while the listing has not is a listing
advertising a price nobody can book at, so the two commit together.

The recompute on `update` is **unconditional** rather than gated on
`priceCents` appearing in the patch: an update can flip `isActive` back on, which
changes the cheapest price without touching a price field. Checking which fields
moved would be a second place to get the rule right.

A **new location inherits** the business's existing catalogue immediately — it
opens with a headline price rather than a blank that fills in whenever someone
next happens to edit a service.

The test factory maintains it too. A fixture that writes rows straight to the
database bypasses these paths, so without that every factory-built location would
look like a business with no services.

### 44.4 NULL means "no active services", and sorts last

Not "no results". Such a location still appears in ordinary browse, and under
`sort=price` it sorts **last** rather than being hidden — a business that has not
listed a service yet is a real business a customer may still want to find, and it
is certainly not free.

`maxPriceCents` **excludes** it, which is the opposite treatment and also right:
there is no price at or below the cap because there is no price at all.

### 44.5 Filter and sort now read the same number

`maxPriceCents` moved from a post-filter in application code into the query,
against the same column `sort=price` orders by. Two consequences beyond
correctness of the sort:

- **`total` now agrees with the filter.** Previously the count was taken before
  the price filter ran, so a filtered page reported a total that included rows it
  had removed.
- The filter and the sort can no longer disagree about what a location's
  cheapest price is, because there is only one number.

`openNow` remains a post-filter, because it is computed from today's hours rather
than stored — its `total` is still the unfiltered count.

### 44.6 Query budget: one lower

The listing reads `fromPriceCents` off the row it already fetched, so the grouped
query is gone.

| | Before (§43.4) | Now |
|---|---|---|
| Ordinary page | 6 | **5** |
| With distance | 7 | **6** |

Asserted directly: `service.groupBy` is now called **zero** times on a 20-result
page, while the remaining lookups are still exactly one each. (§43.4's table
omitted the exchange-rate read; it has been corrected to include it, which is why
the "before" figure there is six rather than the five originally written.)

---

## 45. Settlement amounts on the ledger (2026-09-02)

§34.5 and §36.7 left payout currency explicitly undecided. This decides it.

**The business's payable is fixed at the BOOKING-DATE rate.** A payout performs
no conversion and reads no exchange rate: every entry already carries the amount
it will be paid in. A rate change between booking and payout must not move a
payout by a single minor unit.

### 45.1 Two figures, two jobs

`amountCents` stays the **USD reporting and analytics** figure — every existing
analytics query is unchanged. `settlementAmountMinor` is **authoritative for
payouts**, carries the same sign, and sits alongside `settlementCurrency` and
`bookingExchangeRate`.

All three are nullable, and only because entries created before this — or whose
appointment never recorded a charged amount — genuinely have no settlement
figure. Those are **excluded from payouts and reported**, never converted at a
guessed rate. The immutability trigger (§34.2) now covers all three: a payout
amount that can be edited after the fact is not a ledger.

**Backfill:** the migration fills every entry whose appointment recorded a
charge, using the same arithmetic the application uses, so a backfilled pair and
a freshly written pair are indistinguishable. It runs **before** the trigger is
extended — once the trigger names these columns it would reject the very UPDATE
that populates them. On the current database there were **0 entries, 0
backfilled, 0 unbackfillable**.

### 45.2 The fee is a proportion of what was charged

The deposit entry takes `providerCurrencyAmountCents` — the figure the provider
**actually charged**, not a recomputation from a rate. A test uses a charged
amount deliberately one unit off the round conversion, so a recomputation would
be visible.

The fee is then a proportion **of that charged amount**:

```
fee = round(charged × platformFeeAmountCents / depositAmountCents)
```

Not `platformFeePercentage` applied to something converted independently. The
fee percentage applies to the **service price**, which was never denominated in
the provider's currency; converting it separately would drift from the money
really collected, and the ledger would disagree with the provider's statement by
a few units on every booking.

**Rounded once, on the fee. The business's share is the remainder** — exactly the
reasoning behind `businessAmountCents` being computed by subtraction in USD
(§16.3). Rounding both independently would let them disagree by a unit, and

```
DEPOSIT_RECEIVED + PLATFORM_FEE === the business's share
```

has to hold **exactly in both currencies**. Tested across nine amounts including
primes and thirds and sevenths, where an independent second rounding would show.

The §40 deposit ≥ fee rule guarantees the proportion is in [0, 1]. **At deposit
== fee it is exactly 1**: the fee takes the whole charged amount and the
business's settlement share is exactly zero — asserted in both currencies, not
"about zero".

### 45.3 A refund copies, never recomputes

`DEPOSIT_REFUND` and `PLATFORM_FEE_REVERSAL` are read back from the original
entries and negated, in both currencies. That is what guarantees a business
cancellation returns the business to **precisely** zero.

Recomputing from today's rate would leave a residue that grows with every rate
move — the business would be a little up or a little down on every cancelled
booking, for no reason anyone could explain. Tested by doubling the rate between
booking and cancellation and asserting the entries still sum to exactly zero.

### 45.4 The gateway charge is supplied in settlement currency

Renamed `gatewayChargeCents` → **`gatewayChargeMinor`**. It is minor units of the
**settlement** currency, because that is what the provider actually charged. A
name ending in "Cents" would have read as USD, which is the convention
everywhere else in this codebase — a misleading name on a money field is worse
than a rename.

Its USD figure is a **reporting equivalent** at the booking rate, not the
authority.

### 45.5 An adjustment settles at today's rate

Unlike a deposit, an adjustment is a decision made **now**, not one belonging to
a past booking — so it settles in today's provider currency at today's rate. The
admin's figure is in settlement currency and the USD amount is the reporting
equivalent, the mirror image of §36.5.

---

## 46. Payouts settle in settlement currency (2026-09-02)

A payout **performs no conversion and reads no exchange rate**. It sums
`settlementAmountMinor` over entries that already carry it (§45), so a rate
change between booking and payout cannot move a payout by a single minor unit.

### 46.1 Grouped by (business, settlement currency)

That pair is what a payout is denominated in, so it is the grouping key. `Payout`
gains `settlementCurrency` and `settlementAmountMinor`; `amountCents` stays as
the USD reporting figure and is **never** what is sent, never used to decide
whether to pay, and never used to decide how much.

**A payout can never mix settlement currencies.** The grouping makes it
structurally impossible, and `payOne` re-checks anyway — a payout denominated in
two currencies is not a payout anyone can send, and summing figures that share no
unit is the kind of error that looks fine until someone tries to transfer it.

`GET /businesses/:id/balance` now also reports
`availableBySettlementCurrency` — what will actually be sent, beside the USD
figures that are only reporting.

### 46.2 The test that is the decision

`A RATE CHANGE MUST NOT MOVE A PAYOUT — do not delete this`.

It books at 650, doubles the rate to 1300, runs a payout, and asserts the amount
is **exactly** what the entries were created with. Three companions:

- the run reads **no** exchange rate at all — both settings methods are spied and
  asserted to be called zero times, so a payout that consulted a rate would fail
  here rather than quietly become movable;
- a payout still succeeds when the rate is **unset** at payout time, which a
  convert-at-payout design could not do;
- the USD figure is carried but is demonstrably not what is sent.

Named that way deliberately. If it is ever failing, what is under pressure is not
a test — it is the guarantee that a business is paid what it was promised.

### 46.3 Entries with no settlement amount are excluded and counted

Never converted at today's rate. They are reported as
`entriesWithoutSettlement` on the run summary and left unstamped, so they are
visible and still there once someone works out what they should have been. A
zero would be a lie and a conversion would be a guess.

The negative carry-forward (§35.3) and the suspension pause (§42.4) both still
hold, now in settlement currency — both re-asserted rather than assumed.

### 46.4 A note on the test fixtures

The appointment factory now records a charged amount by default. That is not
test convenience: a real paid appointment always has one, and a fixture without
it produced ledger entries that were silently unpayable — which is exactly the
state §46.3 exists to surface. `providerCharge: null` opts into the pre-§45
shape for the one test that needs it.

One fixture bug surfaced while doing this: a discovery test built "today" from
`toISOString()` (UTC) while the service computes it in `Africa/Juba`. Near
midnight UTC those are different days and the exception filed against the wrong
one silently did nothing. It now derives the date the same way the service does.

---

## 47. Payout batch export (2026-09-02)

MoMo is collections-only (§34.1), so every payout is sent by hand. This turns one
run into one document instead of one browser tab per business.

`GET /admin/payouts/:id/export` — admin, CSV, with the role asserted in the
service as well as the guard (§41).

### 47.1 Addressed by a payout, scoped to its run

The route takes a **payout** id but exports the **whole run** that payout belongs
to, matched on `runAt`. A run is not an entity — there is no `PayoutRun` model,
only payouts that share a timestamp — and an admin has a payout in front of them
and wants the batch it arrived in. "Give me this payout's run" is the operation
that matches the job.

One row per business paid: business id and name, settlement currency and amount,
the USD figure for reference, status, provider reference and payout id.

**Totals are per currency, never one number across two.** A grand total spanning
SSP and USD would be a figure with no unit, which is worse than no total.

CSV quoting is nine lines rather than a dependency, and it is not decoration: a
business called `Nile Barbers, Juba` would otherwise split into two columns and
shift every following value along — in a document someone reads amounts of money
off. Tested.

### 47.2 There is no payout destination, and none was invented

**Nothing in the schema records where to send a business's money.**
`BusinessProfile.phone` exists, but it is a **contact** number: never verified,
never confirmed as a mobile-money account, quite possibly a landline or a
receptionist's mobile.

So the export carries two separate columns:

- `payoutDestination`, whose value is the literal string **`NOT RECORDED`**. Not
  a blank — a blank cell reads as "we forgot to fill this in", while `NOT
  RECORDED` reads as what it is: nobody has ever collected one.
- `contactPhoneNotAPayoutDestination`, so the operator has a lead to chase
  without the column name inviting them to send money to it.

**Collecting a real payout destination is a separate product decision, and it is
the one thing standing between this file and being directly usable.** It needs
more than a column: a destination has to be verified before money is sent to it,
which means a confirmation flow, a record of who confirmed it and when, and a
rule about what happens to pending payouts when it changes. That is a module, not
a field, and guessing at it here would produce a schema that the real
requirements then have to be bent around.

Until then the export is a worksheet: correct amounts, correct currencies,
correct references, and an explicit blank where the account number belongs.

---

## 48. Payout destinations (2026-09-03)

Until now the platform could not pay anyone. A run produced a CSV with `NOT
RECORDED` where the account number belongs (§47.2). This is the module §47.2 said
was needed, built rather than reduced to a column.

**Verification is the module, not a flag on it.** Sending money to an unverified
number is the only mistake in this system that an opposing ledger entry cannot
undo — every other error here is correctable by appending (§34.2).

### 48.1 An append-only history, and how it was verified

`PayoutDestination` is a history: a new submission **SUPERSEDES** the previous row
rather than editing it, and a `VERIFIED` row is **never mutated**. The record of
where money was actually sent has to survive the number changing, or a later
dispute has nothing to read. Tested field by field: after supersession only
`status` differs.

`verificationMethod` (`ADMIN` | `OTP`, null until verified) is recorded even
though only `ADMIN` is reachable today — the platform has no SMS channel, so
OTP-to-number is not buildable yet. Recording it now means an OTP path later
*adds* rows rather than forcing a reinterpretation of old ones: `OTP` will carry
`verifiedById = null`, because the number's holder is not a user in this system.
A row verified by an administrator and one verified by the SIM's holder are
different facts and must not look identical in the table.

`verificationNote` is required for `ADMIN`. "Verified" with no account of how is
not something anyone can audit after money has gone to the wrong place.

**At most one live row per business**, enforced by a partial unique index
exempting `SUPERSEDED` — the pattern from the single ACTIVE membership (§15.2),
hand-written for the same reason Prisma's DSL cannot express it. In the database
and not only in the service, because two simultaneous submissions would otherwise
race into two live destinations, and "which number does this business get paid
at?" must have exactly one answer. Tested by inserting behind the service's back.

### 48.2 MSISDN validation, and where the country lives

E.164 **shape** is checked in the DTO; the expected **country prefix** is checked
in the service, because it is configurable:

**`PAYOUT_MSISDN_COUNTRY_PREFIX`, default `+211`** (South Sudan), read via
`ConfigService` and documented in `.env.example`.

Same reasoning as `PLATFORM_TIMEZONE` (§12): a country baked into a constant is a
redeploy the first time the platform crosses a border, and it would be discovered
by a business unable to submit a perfectly valid number. Whitespace is stripped
before validation, so a number pasted as `+211 921 234 567` is accepted rather
than rejected on formatting.

### 48.3 Unverified BLOCKS payouts, through the existing pause

A run skips any business without a `VERIFIED` destination, using the **same
mechanism** as a suspension (§42.4) rather than a second, subtly different skip:
entries stay unstamped, nothing is written off, and the first run after
verification pays it.

The run result now carries `pausedForUnverifiedDestination` and a
**`pausedBusinesses` list with a reason for each**, de-duplicated by business —
so an admin gets a list to chase rather than a silently smaller batch. That was
the thing most likely to go unnoticed: a payout run that quietly pays fewer
people looks exactly like a quiet week.

### 48.4 Changing the number while a payout is PENDING is ALLOWED

Deliberately not a hard failure. Transfers are manual (§35.1), so `PENDING` can
persist for days, and **a business that has lost control of its SIM must be able
to change the number immediately** — that is precisely the emergency the block
exists for. Hard-failing would trap them behind the payout they most urgently
need to stop.

What happens instead: the old row is superseded, the business returns to
`UNVERIFIED`, and the pending payout is **flagged in the export** — `NOT
RECORDED` in the destination column and `DO NOT SEND` in a `payable` column — until
the new number is verified. The money is still owed and the payout still exists;
it simply must not be sent yet. Money already sent is untouched: a completed
transfer is a fact about the past.

### 48.5 Exposure, permissions and the export

**OWNER only may submit.** A MANAGER can change prices, hours and staff; only the
owner may redirect where the money goes. Any ACTIVE member may **read** the
status — they need to know why payouts are paused — but only the owner sees the
full number. Everyone else gets the last three digits: enough for the owner's
colleague to recognise it, not enough for anyone to dial it. The full number is
also masked in the admin *notification*, because an email sits in an inbox
forever; it belongs in the admin queue behind a login.

The export now writes the **verified msisdn** and provider, with a `payable`
column. §47.2's `NOT RECORDED` placeholder and the
`contactPhoneNotAPayoutDestination` column survive only for the paused case,
which is the one case they were ever honest for.

### 48.6 A note on the test fixtures

`createBusiness` now seeds a `VERIFIED` destination by default, with
`payoutDestination: 'NONE' | 'UNVERIFIED'` to opt out. A business that cannot be
paid is the special case, not the normal one — and without the default every
existing payout fixture would silently have become paused, which is exactly the
failure §48.3 exists to make visible.

---

## 49. Demo seed and manual walk-through (2026-09-03)

851 tests passed against fixtures the tests built themselves. The database had
never held realistic data and nobody had walked the customer journey. This adds
`prisma/seed-demo.ts` and `docs/MANUAL_WALKTHROUGH.md`, and — the actual output —
the list in §49.4 of everywhere reality differed from the plan.

### 49.1 The seed goes through the services

Almost everything is created through the real services, so the seed hits the
same validation a real caller does. A seed that writes rows Prisma-directly can
create data the API would have refused, and then the walk-through explores a
system that does not exist.

Three kinds of raw write remain, each marked `RAW WRITE` at the call site:
fabricating **the past** (`create` rightly refuses a slot behind the clock),
fabricating a **provider charge** (MoMo is not called), and planting a **known
verification code** (the real one is emailed and stored only as a bcrypt hash,
so nobody running the script could verify an arrival by hand).

**Guard:** it refuses unless *all three* hold — `NODE_ENV` is not `production`,
the host is local, and the database name is one of three allowed. Any single
condition is too easy to satisfy by accident: a staging box can be called
`booking_platform`, and `NODE_ENV` is unset far more often than it is set. The
script deletes rows; the cost of an over-strict guard is one environment
variable, the cost of a loose one is a wiped database. Idempotent by deleting
only what carries the `demo-` email prefix.

### 49.2 What is seeded

Eight businesses across the taxonomy at real Juba coordinates spread over ~3 km,
covering every state that behaves differently: two branches sharing one
catalogue; deposit exactly at the fee floor (zero business share); a business
cancellation with a refund; an `UNVERIFIED` payout destination; no destination
at all; `PENDING`; `SUSPENDED`; and an approved business with no services.
Thirteen appointments across every status, 28 ledger entries, six reviews (one
hidden, one answered), two tickets (one resolved with an executed adjustment).

### 49.3 Three things the seed itself got wrong first

Worth recording, because each is the system correctly refusing something:

1. **Sunday.** Every seeded location is closed Sunday, and `create` refuses a
   slot on a closed day — so "today + N days" failed roughly one run in seven
   depending on the weekday. The seed now skips Sundays. The API was right.
2. **Suspension ordering.** The seed suspended Munuki Fitness *before* booking
   it, and a suspended business cannot be booked (§42.1). Reordered so the
   booking exists first — which is also the realistic sequence, and is what
   makes the "existing appointments survive a suspension" case demonstrable.
3. **`submit()`'s return type.** See §49.4 finding 3.

---

### 49.4 Findings from the walk-through

Reported, not fixed. Ordered by how much they matter.

#### 1. An ADMIN cannot log in. At all.

`RequestOtpDto.role` accepts only `BUSINESS | CUSTOMER`, and `requestOtp`
refuses an email already registered under a different role
(`auth.service.ts:58`) — so an admin email is rejected either way. **There is no
API path by which an administrator obtains a token.**

Every admin surface built since §16 — approvals, payout runs, the export,
destination verification, moderation, settings — is unreachable through the API
by any legitimate flow. The walk-through only proceeded by signing a JWT by hand
with `JWT_ACCESS_SECRET`.

The inventory recorded "admins are not self-service", which reads as *cannot
sign up*. The truth is *cannot sign in*. This is the single biggest gap in the
system and it is invisible to the test suite, because every test mints its own
token.

#### 2. `/admin/ledger/held` reports a currency the platform does not hold

It groups by the **USD** `currency` column and reported `USD 900c`, while the
actual unsettled balance is **SSP 585,000** minor units. §46 moved payouts to
settlement currency; the reconciliation endpoint was not moved with them.

An operator comparing this figure against MTN's balance is comparing different
units. The endpoint exists specifically to be compared against a provider
statement, so this defeats its only purpose.

#### 3. `PayoutDestinationsService.submit()` returns a type with no usable fields

`forOwner()` spreads through a `Record<string, unknown>`, so TypeScript sees the
return as `{ msisdnLast3: string }`. A caller cannot reach `id` — the one field
needed to then verify the destination. The seed had to re-query the database for
an id it had just been handed. Any typed client hits the same wall.

#### 4. The MoMo sandbox and a realistic dataset are mutually exclusive

`providerCurrency` controls both what the customer is quoted and what is sent to
MTN. Set to `SSP` (correct for production), the sandbox rejects every payment
with `INVALID_CURRENCY`; set to `EUR` (what the sandbox needs), every customer is
quoted euros. There is no way to have a realistic local-currency dataset and a
working sandbox payment at once.

Related: the customer sees *"Provider rejected the request (HTTP 500)"*. The
actual cause — `INVALID_CURRENCY`, an **admin misconfiguration** — appears only
in the server log. A support agent cannot diagnose it from what the customer can
show them.

#### 5. A PENDING payout is invisible to the business

After a run, `GET /businesses/:id/balance` shows `availableNowCents: 0` (correct
— it is stamped) and `lifetimePaidCents: 0` (correct — not yet marked paid).
Money in flight appears in neither, and there is no field for it. From the
business's side the balance simply vanished. `GET /businesses/:id/payouts` shows
it, but nothing in the balance response points there.

#### 6. Nothing tells a customer an arrival code was emailed

The booking response carries no hint that a six-digit code was sent, nor that it
will be needed on arrival. A client would have to know from documentation. The
code is correctly absent from the response; a flag saying one was sent is not.

#### 7. `RunSummary.totalCents` is not cents

It sums `settlementAmountMinor`, so it is minor units of the settlement currency
— `1998750` SSP in the walk-through, not $19,987.50. The name survived §46.

#### 8. `role` must be resent on OTP verify

`/auth/otp/verify` requires `role` again even though the request step already
took it and the account already has one. A client must carry it across two
calls, and the wrong value fails with a validation error rather than being
inferred.

#### 9. `BusinessProfile.name` is nullable, and the approval queue shows it

The admin queue rendered a row with `name: null`. For a queue whose entire job is
"decide about this business", a nameless row is not actionable — and nothing at
signup requires a name before an approval decision is asked for.

#### 10. Smaller edges

- **No ledger read API.** A business cannot see the entries behind its balance,
  and an admin cannot see them per business; the walk-through used SQL.
- **No way to list billing adjustments.** The id must come from the resolving
  ticket's response or the database.
- **Analytics' 30-day default silently excludes backdated data.** The `range` is
  in the response, so it is discoverable — but the first read of a demo dataset
  looks emptier than it is.
- **No admin endpoint to simulate a payment confirmation.** With the sandbox
  unavailable there is no supported way to move an appointment to `BOOKED`,
  which is why the seed calls `applyPaymentResult` directly.

---

## 51. Money reporting says what it means (2026-09-03)

Walk-through findings 2, 7, 5 and 3 (§49.4). Nothing about the arithmetic
changed; what changed is that the numbers now say what they are.

### 51.1 `/admin/ledger/held` reports the currency the money is actually in

It grouped by the USD `currency` column and reported `USD 900c` while the
platform was holding `SSP 585,000`. Its **only** purpose is to be compared
against the provider's statement, so reporting a currency the platform holds
none of defeated it entirely.

Now grouped by `settlementCurrency`, reporting `amountMinor`, with
`reportingUsdCents` alongside and explicitly named as the internal unit of
account rather than the money.

Entries with **no** settlement figure (§45.1) are counted separately as
`entriesWithoutSettlement`, not folded into a currency they do not belong to.
They are money the platform holds and cannot pay out, which is a third thing,
not a rounding error.

### 51.2 `totalCents` was never cents

Renamed `totalMinor`, with `settlementCurrencies` beside it — the same reasoning
as the `gatewayChargeCents` → `gatewayChargeMinor` rename in 7cdc411. A name
ending in "Cents" reads as USD everywhere else in this codebase, and this figure
became a sum of `settlementAmountMinor` in §46.

The currency list is plural because a run can pay several: a single total across
two currencies is a number with no unit, so the units are named next to it.

### 51.3 Money in flight is visible to the business

`GET /businesses/:id/balance` had `availableNowCents` (zero once entries are
stamped) and `lifetimePaidCents` (zero until an admin marks it paid) — so
between a run and a transfer, **a payout appeared nowhere at all**. From the
business's side their balance simply vanished. A business that was told it would
be paid and can see nothing is a support ticket waiting to happen.

`pendingPayouts` now reports the count, the USD figure for reference, and the
amount by settlement currency. Tested through the whole cycle: it appears on a
run, clears on mark-paid, and returns to `availableNow` on mark-failed.

### 51.4 A return type a caller can use

`PayoutDestinationsService.submit()` spread through `Record<string, unknown>`,
so TypeScript inferred `{ msisdnLast3: string }` — the `id` needed to then
verify the row was unreachable, and the demo seed had to re-query the database
for an id it had just been handed.

Now an explicit `PayoutDestinationView`, with `msisdn` optional because it is
present only for the owner (§48.5) — the redaction is in the type, not only in
the runtime branch.

**Audit result: this was the only one.** `Record<string, unknown>` appears
nowhere else in `src/`.

### 51.5 Audit — names that still imply the wrong unit

Reported, not renamed: each is a schema column or a provider interface read by
several modules, and renaming them is a migration and a refactor rather than
part of this commit.

| Name | Actually holds | Where |
|---|---|---|
| `Appointment.providerCurrencyAmountCents` | **provider-currency minor units** | schema, §18 |
| `InitiatePaymentParams.amountCents` | **provider-currency minor units** | `payment-provider.interface.ts:36` |
| `providerAmountCents` (local) | **provider-currency minor units** | `appointments.service.ts:444` |

All three predate the settlement work and all three are the same mistake this
commit fixed twice. They are correct *within* the payment path, where everything
is provider currency by definition — but a reader arriving from the ledger, where
`amountCents` means USD, will read them wrong.

Correctly named and left alone: `gatewayUsdCents`, `usdAmountCents`,
`reportingUsdCents`, and every `*PriceCents` / `*AmountCents` on the appointment
money snapshot, which really are USD.

---

## 52. Sandbox currency, and telling the right person (2026-09-03)

Walk-through finding 4 (§49.4), in two halves.

### 52.1 The override applies to the request, and nothing else

`providerCurrency` decided both what the customer is quoted **and** what is sent
to MTN. Set to `SSP` (correct for production) the sandbox rejects every payment
with `INVALID_CURRENCY`; set to `EUR` (what the sandbox needs) every customer is
quoted euros. A realistic dataset and a working sandbox could not coexist.

`MOMO_SANDBOX_CURRENCY_OVERRIDE` rewrites the currency **in the outbound request
body and nowhere else**. What the customer is quoted, what is stored on the
appointment, and what the ledger settles in all remain the real
`providerCurrency`.

That asymmetry is the whole point, and it is also why it is dangerous: while it
is set, **the provider's records and the platform's deliberately disagree**. So:

- **The application refuses to start** if it is set and `NODE_ENV=production`.
  A misconfiguration caught at boot is an ops problem; the same one caught at
  charge time is a customer billed in a currency nobody chose.
- Boot logs a loud warning whenever it is active, saying in as many words that
  the two sets of records will disagree.
- `.env.example` documents it as a **sandbox testing aid, never a config knob**.

It is an environment variable rather than a `PlatformSetting` deliberately.
Settings are admin-editable at runtime and this must not be reachable from a UI
— an admin who could toggle it could silently decouple the platform's books from
the provider's.

### 52.2 A misconfiguration is not the customer's fault

Every failed initiation produced the same customer-facing string —
*"Provider rejected the request (HTTP 500)"* — whether MTN was briefly busy or
the platform was configured wrongly. The real cause lived only in a server log,
so a support agent could not diagnose it from what a customer could show them,
and **nobody was told at all**.

`InitiatePaymentResult` now carries a `failureKind`:

- **`CONFIGURATION`** — a 4xx by definition, or a body carrying one of MTN's
  configuration codes (`INVALID_CURRENCY`, `NOT_ALLOWED`,
  `NOT_ALLOWED_TARGET_ENVIRONMENT`, `RESOURCE_NOT_FOUND`,
  `SERVICE_UNAVAILABLE_FOR_SUBSCRIPTION`). The body is read because MTN returns
  **500** with `INVALID_CURRENCY` — status code alone would have classified the
  exact failure that prompted this as transient.
- **`TRANSIENT`** — everything else.

The customer gets a **503** and a plain sentence: payments are temporarily
unavailable, **they have not been charged**, their booking is still held. No
HTTP status, no provider code — those are platform details, and a customer
cannot act on them.

Admins get `PAYMENT_PROVIDER_MISCONFIGURED` with the real cause and the
appointment id. **Not debounced**, deliberately: a configuration failure means
*every* deposit is failing, and a duplicate email costs nothing against nobody
noticing. If it ever becomes noisy, the noise is the signal.

An **unclassified** failure is treated as transient. Defaulting to "wake the
admins" would make every provider blip an alarm, and the alarm would stop being
read — the failure mode §37 already avoided for the exchange rate.

---

## 53. Remaining walk-through gaps (2026-09-03)

Findings 9, 6 and 10 (§49.4).

### 53.1 A nameless business cannot be approved

`BusinessProfile.name` is nullable, and the approval queue rendered a row with
`name: null` during the walk-through. A queue whose entire job is "decide about
this business" cannot show a blank, and approving one puts a blank into public
search.

A name is now required to reach `APPROVED` — including via reinstatement, which
is the same transition and would put the same blank back. **The column stays
nullable**: a profile mid-onboarding legitimately has no name yet, and forcing
one at creation would block the step before it.

**Rejection is still possible without a name**, deliberately. Refusing an
incomplete application is exactly what an admin should be able to do, and
requiring a name first would trap a half-finished signup in the queue forever.

### 53.2 The arrival code is announced, never exposed

`Appointment.verificationCodeSentAt` — a timestamp, never the code. Nothing
previously told a client that a six-digit code had been sent or would be needed,
so it had to be known from documentation, and a customer who received no email
had no signal that one was owed to them.

Set **after** the send, so it means "an email went out" rather than "we intended
to send one". That ordering forced a small change: `create()`'s response is now
built from the row that carries the flag, because the row read inside the
transaction predates the send and would have reported `null` on the very
response that triggered it.

**Left as a decision, not built: there is no way to resend it.** A customer who
deletes the email, or whose address bounced, cannot get another code — and the
business cannot mark them arrived without one. Building a resend endpoint means
answering questions this commit has no mandate for: who may trigger it (the
customer, or the business standing in front of them?), how often, and whether a
resend invalidates the previous code. Worth deciding before it is built.

### 53.3 Admin reads for the ledger and adjustments

`GET /admin/ledger/entries` (filterable by business, appointment, payout and
type) and `GET /admin/billing-adjustments` (by business, appointment, ticket).
Both admin-only with the service-level assertion, both **read-only**: the ledger
is append-only and corrections are opposing entries (§34.2), so a read endpoint
has no business offering anything else.

They exist because there was no way to see any of this. Answering "why is this
business owed that?" meant opening a SQL client — which support cannot do, and
which nobody should have to do to explain money.

Two details: entry totals are computed over the **whole filter**, not the page,
because a total that changed when you turned the page would be worse than no
total. Adjustments are ordered **unsettled first** and carry an `outstanding`
count — recorded-but-not-executed is the one state where a decision has been
taken and no money has moved (§36.5), and it was previously invisible.

### 53.4 Confirming a deposit without the provider is a script

`npm run dev:confirm-deposit -- <appointmentId> [chargedMinor]`, guarded exactly
as the demo seed is: `NODE_ENV`, host and database name, all three.

**Deliberately not an endpoint.** An endpoint that marks money as received is
one misconfiguration away from being the worst bug in this system — a guard
mis-wired, an environment variable unset in the wrong place, and anyone can tell
the platform they have paid. No amount of convenience is worth that risk. A
script cannot be reached over the network at all, and it runs where someone
already holds the database credentials — a person who could have written the row
by hand anyway.

It fabricates only **the provider's answer**, which is the part the sandbox owns.
Everything downstream runs through the real `applyPaymentResult`: the status
change, `depositPaidAt`, the ledger pair and its settlement split, the
notifications. It refuses anything that is not `PENDING_PAYMENT`, so it cannot
write a second set of entries.

### 53.5 Things to decide rather than build

- ~~**Resending an arrival code** (§53.2). The gap is real; the answer is a
  product decision.~~ DECIDED and built — see §54.
- ~~**The three misnamed money fields** in §51.5. Renaming
  `providerCurrencyAmountCents` is a migration touching a column several modules
  read, for a clarity benefit — worth doing, worth deciding when.~~ DONE, and
  widened: §55 made the internal currency configurable, which turned every
  `...Cents` name into a potential lie rather than just those three. See §56.
- ~~**`test/support-tickets.spec.ts` "keeps reference unique under concurrent
  creation" flaked once** during this work and passed on every re-run since.
  Recorded rather than chased: a concurrency test that fails once in many runs is
  either a real race worth finding properly or a fixture artefact, and guessing
  between those in passing is how a real race gets papered over.~~ INVESTIGATED
  — see §54.5. The race it is named for cannot happen; the flake was not a
  uniqueness failure.

---

## 54. Arrival codes: resend, display, and verifying without one (2026-09-23)

Closes the first item in §53.5. Three changes to one feature, and each of them
leans on the same rule from §16.2 — that a business must not be able to complete
an appointment on its own say-so — so each is described below in terms of where
that rule still holds.

### 54.1 A resend replaces the previous code; it never joins it

The customer asks, on their own appointment. The business cannot: a code the
business can summon on demand is a code the business controls, and its only job
is to be the one thing the business does not have. `resendVerificationCode` is
scoped by `customerId`, so a business member asking for one gets the usual 404.

**The new code retires the old one**, which was the decided answer and is also
the only coherent one. Two live codes double the guessing surface, and — worse —
make "the code did not work" unanswerable, because nobody can tell whether the
customer read out a stale one. Replacement is structural rather than a policy:
`verificationCodeHash` is overwritten, so the previous code stops matching at
the instant the new one is stored.

`verificationAttempts` resets to zero on a resend. Those attempts were spent
against a code that no longer exists, and carrying them forward would let a
stranger's typos lock a customer out of every future code as well as the one
they got wrong.

Two independent limits, because either alone is insufficient:

- `RESEND_COOLDOWN_MS` (60s) — without a floor the endpoint is a mail-bomb
  aimed at whoever booked.
- `MAX_VERIFICATION_CODE_SENDS` (5, counting the booking email) — a cooldown
  alone only slows abuse down. Five is well past the point where a sixth code
  helps; a customer who has burned five needs §54.3, not another email.

The cooldown is measured from `verificationCodeSentAt`, which is still stamped
*after* the send (§53.2). A failed send therefore does not start the clock, and
the customer may retry immediately — which is the behaviour you want from a
limit whose whole purpose is to ration successful emails.

The database write happens *before* the send, though. The other order leaves a
window in which an email is in flight carrying a code the database has never
heard of, and that code would be refused through no fault of the customer.

### 54.2 The customer can see their own code, which means storing it readably

The code was bcrypt-hashed and nothing else, so **the app could not show it** —
only the emailed copy existed. Showing it in the customer's booking was decided,
so the appointment now stores the plaintext in `verificationCode` **alongside**
the hash, both written from the same generated value in the same statement, in
the only two places a code is ever issued.

Alongside, not instead of: `verify()` still compares against the hash, so the
verification path is untouched and keeps bcrypt's constant-time comparison. The
new column is for display and nothing else.

**This is a real reduction in secrecy and is worth naming.** Hashing an arrival
code only ever protected against a database leak — and the same code is emailed
in the clear, so it already exists in plaintext in the customer's mailbox and in
whatever handled that mail. Hashing it in the database while mailing it in the
open bought very little, and it cost the customer the ability to see a code they
are the rightful holder of. The trade is deliberate.

What protects it instead is narrow exposure:

- It is **not in `APPOINTMENT_SELECT`**. A separate `CUSTOMER_APPOINTMENT_SELECT`
  carries it, and only the customer branch of `findOne` names that constant. A
  business or admin read therefore cannot leak it by *omission* — the failure
  mode of a shared projection that each new read path must remember to strip.
  Here, showing it takes a deliberate act.
- **Detail only, never the list.** A list read exposes every booking's code at
  once, on a screen that gets screenshotted and scrolled past strangers, for no
  benefit: the code is used on the booking's own screen.
- **Null once spent.** A used code is not a secret, but it is not information
  either, and rendering it beside a completed appointment invites a customer to
  read out a number that will be refused. `codeIsLive()` is one predicate, used
  by both the read and the resend endpoint, so the code a customer can see is
  exactly the code they can ask to have resent.

Rows created before this have `verificationCode: null` and keep working through
the hash. No backfill — the plaintext is genuinely unrecoverable from bcrypt,
and §33.4's rule applies: null means "not recorded", never a fallback.

### 54.3 Manual verification is permitted, and impossible to do quietly

`POST /business/appointments/:id/verify-manually` moves `BOOKED -> IN_PROGRESS`
on the business's assertion, against details the customer recalls.

**This is a deliberate hole in §16.2.** The alternative is worse: a customer at
the counter with a flat phone and no email cannot be served, and the business
cannot be paid for work it is about to do. A rule that produces that outcome
gets worked around in ways nobody records, which is strictly worse than a
recorded exception.

What makes it acceptable is not that it is hard — it is not — but that it is
**impossible to do invisibly**:

- `verificationMethod` is set to `MANUAL`, and `verifiedById` names the
  individual. The same separation §33.2 drew between the party responsible and
  the person who acted.
- `manualVerificationNote` stores what the customer recalled, verbatim.
- **Every admin is notified as it happens**, undebounced, for §52's reason: the
  event is rare by design, and if it ever becomes noisy the noise is itself what
  an admin needs to know.

A business that does this once a month is unremarkable. One doing it for half
its bookings is visible in a single query, and that is the control.

Two supporting decisions:

**The note is not validated against the appointment.** Every fact a server could
check here — the service, the time, the price, the reference — is already on the
business's own screen, so checking them would confirm that the business can read
its own booking list, not that the customer is present. A validated challenge
would look like a second code while proving nothing, which is worse than an
honest attestation, because it invites the reader to trust it.

**OWNER and MANAGER only**, where `verify` is open to STAFF as well. Taking a
code a customer reads out is counter work. Deciding to proceed *without* one is
a judgement about whether a stranger is who they say they are, and it is
recorded against whoever makes it.

`verificationMethod` is also set to `CODE` on the normal path, rather than being
left null for it. If only manual verifications carried a method, `CODE` would be
encoded as "null" — and null already means "verified before §54 existed". Those
are different facts and a reader has to be able to tell them apart.

### 54.4 Verified

`test/arrival-code.spec.ts`, 28 tests. The ones that matter most are the
negatives: a business cannot resend, a business read has no `verificationCode`
property at all (absent, not null), a list read has none either, and the
superseded code is refused while the new one works.

Full suite: **922 passing across 22 suites**, `prisma migrate diff` reporting no
drift.

### 54.5 The ticket-reference flake, settled

§53.5 recorded a one-off failure of `support-tickets.spec.ts` "keeps reference
unique under concurrent creation" and deliberately did not chase it. Chased now,
because the answer turned out to be cheap.

**The race the test is named for does not exist.** References come from a
Postgres sequence:

```sql
SELECT 'TKT-' || LPAD(nextval('ticket_reference_seq')::text, 6, '0')
```

`nextval()` is explicitly non-transactional: two concurrent callers cannot
receive the same value, in the same transaction or different ones, and a
rollback does not return a value to the pool. The assertion — twenty concurrent
creates producing twenty distinct references — therefore cannot fail for the
reason the test's name suggests.

Which means the observed failure was a **rejection**, not a mismatch: one of the
twenty `Promise.all` calls threw, and the test failed before reaching the
assertion. The likely cause is connection-pool pressure — twenty simultaneous
transactions, each running a raw query, an insert and admin notifications,
against a pool sized for a single-worker run.

Re-run in isolation **40 times: 40 passes**. Not reproduced, so nothing is
changed. The entry is downgraded from "possible race in reference generation" to
what it is: occasional pool pressure under `Promise.all(20)`, in a test whose
stated invariant is guaranteed by the database. Recorded so the next person to
see it red does not go looking for a race that Postgres has already ruled out.

The test is kept as it stands. It is cheap, and it would still catch the real
regression available here — someone replacing the sequence with a count, a
timestamp or a random suffix.

---

## 55. The unit of account becomes configurable, and knows its own decimals (2026-09-23)

Groundwork for running in Rwanda. Nothing about this commit is Rwanda-specific;
it removes two assumptions that were only ever true by coincidence.

### 55.1 `INTERNAL_CURRENCY` is a deployment constant, not a literal

USD was hardcoded, and §18.1's reasoning for it is sound but narrow: SSP has run
at roughly 97% annual inflation, so pricing a catalogue in it would mean
repricing every few weeks. That argues against **SSP**, not for **USD**.

Where the local currency is stable the argument inverts. A customer in Kigali
should see an exact RWF price, not a USD price with an approximate RWF figure
beside it (§39) — the approximation exists precisely because the platform cannot
promise a rate it does not control, and a platform pricing natively in RWF has
no rate to promise.

So the unit of account is now `INTERNAL_CURRENCY`, read from the environment,
defaulting to USD so nothing about the current deployment changes.

**It is an environment variable rather than a `PlatformSetting`, deliberately.**
Every stored amount is denominated in it and *nothing records the unit beside
the number* — a ledger entry's `amountCents` is a bare integer. Changing it
therefore migrates nothing; it silently reinterprets the entire history. An
admin-editable field would put that one form submission away.

`CurrencyGuard` makes it impossible to do by accident: at boot it checks the
ledger for any entry in another currency and **refuses to start** if it finds
one, naming both currencies. Same posture as §52's production assertion — when
the cost of being wrong is this high, failing to start is the kind behaviour.

### 55.2 Currencies carry their own minor-unit exponent

`currency.ts` previously stated the gap in a comment:

> *"ASSUMPTION worth stating: both currencies use two decimal places. True for
> USD, EUR and SSP. A zero-decimal currency (JPY, KRW) or a three-decimal one
> (KWD, BHD) would need the minor-unit exponent taken into account, and that is
> not modelled — there is nowhere to record an exponent per currency yet."*

**RWF is a zero-decimal currency**, so Rwanda walks straight into it. The old
conversion multiplied minor units by the rate directly, which is correct only
when both exponents match. Converting a 9.00 USD deposit at 1300 RWF/USD gave
**1,170,000** instead of 11,700 — a bill a hundred times the price.

`MINOR_UNIT_EXPONENT` now records the exponent per ISO code, and
`convertMinorUnits(amount, from, to, rate)` applies both sides' exponents on the
way through. An **unrecognised currency is refused, never defaulted to 2**: a
default would look like it worked while misstating every amount by 100x or
1000x, quietly, in the one part of the system where quiet wrongness is most
expensive. Adding a currency is one line.

The assumption had leaked into four places, all now going through the shared
helpers:

- `momo-payment.provider.ts` — `(amountCents / 100).toFixed(2)` on the outbound
  request. This one had a second bug the exponent work surfaced: the outbound
  currency may be rewritten by §52's sandbox override, so the amount was
  formatted against the *configured* currency while being labelled with the
  *overridden* one. Both now resolve from a single `outboundCurrency`.
- `approx-settlement.ts` — `/100` and `*100` when rounding to whole local units.
  In a currency with no minor unit, "round to whole units" is already what
  conversion produces, and this step correctly becomes a no-op.
- `notification-templates.ts` — the `money()` helper, which rendered "RWF
  117.00" for 11,700 francs.
- `ledger.service.ts` — `.mul(100)` converting a BillingAdjustment's major-unit
  amount into ledger units.

### 55.3 A provider charging in our own currency needs no rate

When `providerCurrency === INTERNAL_CURRENCY` there is nothing to convert: the
amount charged **is** the amount recorded. The machinery stays — a second
country will need it again, and deleting it now only to rebuild it later is the
worst of both — but it idles, with the rate at 1 and conversion the identity.

`setExchangeRate` now refuses any rate other than 1 in that case. A typo there
would multiply every charge, and because no conversion is visible in such a
deployment, nobody would notice until a customer was billed. It also refuses a
provider currency whose exponent is unknown, so the failure lands on the admin
who typed it rather than on the next customer who tries to pay.

### 55.4 Verified

`test/internal-currency.spec.ts` (9) and a new block in
`test/money-invariant.spec.ts` (8), including the case the whole commit exists
for: 900 USD minor units at 1300 RWF/USD is 11,700 RWF, not 1,170,000.

Full suite: **938 passing across 23 suites**, no schema change and therefore no
migration.

---

## 56. Money columns say "minor units", because that is what they hold (2026-09-23)

Closes the second item in §53.5, and widens it. §51.5 flagged three fields whose
names claimed cents while holding provider-currency minor units. §55 made the
internal unit of account configurable, which turned the same problem loose on
**every** money name in the codebase: in a deployment priced in Rwandan francs,
`depositAmountCents: 11700` reads to every human as 117.00.

### 56.1 Why a name is worth a migration

This is the only class of bug in the money code that nothing can catch.

An amount in the wrong unit compiles. It passes every test, because every test
compares amounts to other amounts in the same wrong unit. It satisfies the
invariant — `platformFeeAmountMinor + businessAmountMinor == depositAmountMinor`
holds just as well in francs as in cents. It reconciles against the ledger,
because the ledger is wrong the same way. There is no runtime check that could
find it, because **the unit exists nowhere except in the name**.

So the name is the only place the unit can be enforced, and a name that lies is
not a cosmetic problem.

### 56.2 The rename

`...Cents` becomes `...Minor` throughout — the convention §45 and §51 already
established with `settlementAmountMinor` and `totalMinor`, now applied
consistently rather than only where it was noticed.

| Was | Is | Denominated in |
|---|---|---|
| `Appointment.depositAmountCents` | `depositAmountMinor` | internal currency |
| `Appointment.platformFeeAmountCents` | `platformFeeAmountMinor` | internal currency |
| `Appointment.businessAmountCents` | `businessAmountMinor` | internal currency |
| `Appointment.servicePriceCents` | `servicePriceMinor` | internal currency |
| `Service.priceCents` | `priceMinor` | internal currency |
| `Location.fromPriceCents` | `fromPriceMinor` | internal currency |
| `LedgerEntry.amountCents` | `amountMinor` | internal currency |
| `Payout.amountCents` | `amountMinor` | internal currency |
| `Appointment.providerCurrencyAmountCents` | `providerAmountMinor` | **provider** currency |
| `InitiatePaymentParams.amountCents` | `amountMinor` | **provider** currency |
| `reportingUsdCents` | `reportingInternalMinor` | internal currency |
| `depositsCents`, `availableNowCents`, `lifetimePaidCents`, … | `...Minor` | as documented per field |

Each renamed column sits beside a currency column — `currency`,
`settlementCurrency`, `providerCurrency` — which is what now says *which*
minor units. The name says the scale; the neighbouring column says the
currency. Neither is guessed.

`reportingUsdCents` deserves its own mention: it hardcoded **USD** into a field
whose whole purpose is to report in the internal unit of account. It was
introduced by §51, the commit that existed to stop money fields misstating their
units, which is a fair measure of how easily this slips through.

### 56.3 The migration is hand-written, and had to be

`prisma migrate dev` cannot see a rename. It compares two schemas and generates
`DROP COLUMN` + `ADD COLUMN`, which for these eleven columns means **deleting
every amount in the database** and replacing them with nulls. The migration is
therefore written by hand as `ALTER TABLE ... RENAME COLUMN`, which preserves
the data, the type and the constraints.

Two things the compiler could not have caught, and which a careless rename would
have shipped:

1. **The immutability trigger names its columns.** `ledger_entries_reject_mutation`
   compares `NEW."amountCents"` to `OLD."amountCents"`. Renaming the column
   without rebuilding the function leaves a trigger referring to a column that
   no longer exists — and since it fires on every write, the append-only
   guarantee would have taken the whole ledger down with it. The migration
   recreates it.
2. **Raw SQL is invisible to TypeScript.** `from-price.ts` updates
   `"fromPriceCents"` from `MIN(s."priceCents")` inside a `$executeRaw`. A
   string is a string; nothing would have failed to compile.

`prisma migrate diff` reports no drift, which is what confirms the hand-written
SQL and the schema actually agree.

### 56.4 A source-scanning test, so it cannot come back

`money-invariant.spec.ts` now reads `src/` and fails if any camelCase identifier
ends in `Cents`. Same device as §36's cancellation scan, and for the same
reason: the property is about the shape of the source, so the source is what
gets asserted.

It is deliberately strict. "It is only cents when the currency happens to have
two decimal places, and since §55 that is a deployment setting rather than a
fact" — which means there is no correct use of the suffix left, and an exception
list would just be the bug with extra steps.

### 56.5 What was deliberately NOT renamed

**This file.** §16.3, §30, §34 and the rest still say `depositAmountCents`,
because that is what those sections decided at the time and rewriting them would
falsify the record. The convention here is to append and strike through, not to
edit history. This section is the mapping.

`docs/IMPLEMENTATION_INVENTORY.md` is likewise left alone: it is a dated audit of
what the code looked like on the day it was taken, and silently updating it would
make it a worse record, not a better one. `docs/MANUAL_WALKTHROUGH.md` **is**
updated, because it is a set of commands someone runs today.

### 56.6 Verified

Full suite: **939 passing across 23 suites**, `prisma migrate diff` reporting no
drift. One test needed a human decision rather than a mechanical fix: a §51
assertion reading `expect(summary).not.toHaveProperty('totalCents')` was
rewritten by the rename into an assertion that the field it had just checked for
was absent. It now names the superseded field deliberately, and guards that the
old name stays gone.

---

## 57. One operator per payment, not one per deployment (2026-09-23)

Rwanda has two mobile money operators that matter, MTN and Airtel, and a
customer pays with whichever one their SIM belongs to. This commit is the
infrastructure for that. The Airtel client itself is §58.

### 57.1 The provider is chosen per payment, not at boot

`PaymentsModule` read `PAYMENT_PROVIDER` from the environment and returned a
single instance, so every payment on the platform went to whichever operator was
named at startup. That is coherent for one operator per country and incoherent
for two: the choice belongs to the customer's phone number, and it is made after
the process has started.

`PaymentProviderRegistry` replaces the single `PAYMENT_PROVIDER` token. It holds
every provider whose credentials are configured and hands out a named one.

`PAYMENT_PROVIDER` is gone rather than retained: an operator is available when
its own keys are set, which is a fact, and one fewer setting to keep consistent
with another. A provider that is not configured is **absent from the registry**
rather than present and failing — so a payment routed to it gets a 503 naming
what *is* accepted, instead of a generic provider error.

### 57.2 Recording the operator is not bookkeeping — the poller needs it

This is the part that made the commit urgent rather than tidy.

A payment reference is meaningful **only to the operator that issued it**. Three
places call `checkPaymentStatus(reference)`: the on-demand status read, the
20-second poll, and the expiry sweep's final check. All three asked "the"
provider, because there was only ever one.

Ask the wrong operator and the answer is *"no such transaction"* — which is
indistinguishable from a genuine failure. `applyPaymentResult` would then treat
a perfectly good payment as FAILED, and the expiry sweep would cancel the
booking. **Adding a second operator without this column would cancel paid
appointments**, and the one it would cancel is the one whose customer had
already been charged.

So `Appointment.paymentProvider` is written **in the same statement** as the
reference, and every caller resolves the provider from the row rather than from
configuration.

**Backfilled, unlike §33.** §33 refused to backfill `cancelledBy` because the
information was genuinely gone — several parties could have cancelled and
nothing recorded which. Here there is exactly one possible answer: one
`PaymentProvider` implementation has ever existed, so every reference in the
table was issued by MTN. Writing that down records a fact rather than inventing
one, and the distinction is worth keeping straight: the rule is not "never
backfill", it is "never fabricate".

### 57.3 With two operators available, there is no default

`requireOnlyOne()` resolves while exactly one operator is configured and
**throws once two are**. That looks unhelpful and is deliberate: "the default
provider" with two operators live is a coin toss that charges the wrong network
about half the time, silently, and the failure surfaces to the customer as a
payment that never arrives. Refusing forces the choice to be made from the
customer's number — which is §58's job, and which this makes impossible to skip.

### 57.4 `PayoutProvider` became `MobileMoneyProvider`

One enum for "which operator", in both directions. The old name described the
direction rather than the thing, and it was only about payouts because payouts
were the only place the operator was recorded. Two parallel enums would drift
the first time an operator was added to one and not the other.

`AIRTEL_MONEY` is added now. It is immediately meaningful on the payout side —
transfers are manual (§36.7), so a business can nominate an Airtel number today
and be paid by hand — and it is what §58 registers a collections client against.

The migration is hand-written: Prisma treats an enum rename as
drop-and-recreate, which would take every payout destination's provider with it.

### 57.5 Verified

`test/payment-providers.spec.ts` (11). The four that matter are the routing
ones: with both operators registered, an Airtel reference is polled against
Airtel and MTN is **never called**, and vice versa; a mixed sweep routes each
appointment to its own operator; and one operator throwing does not stop the
other being polled.

Test fixtures use a **real registry over stubbed providers** rather than a
stubbed registry — the resolution logic is exactly what this commit adds, so
stubbing it would test nothing.

Full suite: **950 passing across 24 suites**, no drift.

### 57.6 A deployment constraint, discovered while registering with Airtel

Airtel's developer portal makes **IP whitelisting mandatory for all products in
all countries**: API calls are accepted only from addresses on an allow-list,
maintained per mode (TEST and production have separate lists).

This is a hosting requirement, not a coding one, and it is stricter than MTN's —
whose sandbox has no such rule. Since the platform will talk to both, **Airtel's
constraint is the platform's constraint**: the backend must call out from a
fixed, known address. Hosting with rotating egress IPs — most serverless
platforms, several PaaS options — needs a NAT gateway or a dedicated egress IP
on top. A VPS or container host with a static IP does not.

Recorded here so the hosting decision is not made without it.

### 57.7 Not yet done

The Airtel credentials are **pending approval** — the portal generates them only
after a human approves the application, so there is nothing to configure yet.
§58 builds the client; verifying it against the real sandbox by hand, as §17.6
did for MTN, waits on those keys and is not claimed until it happens.

---

## 58. Routing a payment to the customer's own network (2026-09-23)

§57 made the platform able to hold several operators and refuse to pick one by
default. This decides which one a given payment goes to. The Airtel collections
client itself is §59 — see §58.5.

### 58.1 Infer from the number, and always let the customer overrule it

Prefixes were assigned to operators and still broadly follow them, so a number
beginning `+25078` is almost certainly MTN and `+25072` almost certainly Airtel.
**Almost.** Mobile number portability means a subscriber keeps their number and
changes network, and a ported customer routed by prefix has their payment sent
to an operator that has never heard of them.

So the order of authority is:

1. **What the customer explicitly chose.** They know their own network, and for
   a ported number they are the only reliable source.
2. **What the prefix implies.** Right for most numbers, and it makes the common
   case require no interaction at all.
3. **The single configured operator**, when neither applies.

`InitiateDepositPaymentDto.provider` is optional and wins when present. The
inference is a default, never a verdict.

**An unknown number returns null rather than a guess.** Only prefixes actually
known are in the table — Rwanda's four, and nothing else. South Sudan is
deliberately absent: MTN is the only operator ever collected through there, so
every number falls back to it, and the difference matters. A fallback gets
revisited when a second operator appears; a mapping written from memory looks
like a rule and never gets revisited at all.

If the chosen operator is not available on this platform, `require` throws a 503
naming what *is* accepted. That is the whole point of routing: without it, an
Airtel customer would be collected on MTN, which charges a SIM that is not
theirs and fails in a way nobody can explain.

### 58.2 `GET /payments/providers`

Serves the available operators, the suggested one for a given number, and
whether a choice is needed. Unauthenticated, like discovery: which networks a
platform accepts is product information a customer needs before they have any
reason to have an account.

It exists so the prefix table lives in one place. The alternative is every
client shipping its own copy, and then a prefix range moving means updating
several apps and hoping they all ship.

`suggested` is only ever an operator that is actually available — pre-selecting
one that is not would put the customer one tap from a 503.

### 58.3 Airtel payout destinations needed no work

§57's rename to `MobileMoneyProvider` and the added `AIRTEL_MONEY` value were
enough: `CreatePayoutDestinationDto` validates with `@IsEnum(MobileMoneyProvider)`
and the service stores whatever it is given. A business can nominate an Airtel
number today and be paid to it, because transfers are manual anyway (§36.7).

### 58.4 A gap this commit fell into: the test suite is not typechecked

Two tests passed `{ phoneNumber: '…' }` to a parameter declared `phoneNumber:
string`. Nothing caught it, for two compounding reasons: `tsconfig.json` has
`include: ["src/**/*"]`, so `tsc --noEmit` never sees `test/`; and the payment
provider was a stub that ignored the argument entirely, so the wrong type had no
effect at runtime.

It surfaced only because this commit is the first code to actually *read* that
argument — `inferOperator` called `.replace` on an object and threw a
`TypeError` where the test expected a `ServiceUnavailableException`.

Both call sites are fixed. **The underlying gap is not**, and should not be
folded into this commit: typechecking `test/` alongside `src/` surfaces **22
errors**, including a duplicate import, an unreachable enum comparison and
several possibly-undefined reads. That is its own commit, with a `typecheck`
script that covers both trees so it cannot regress.

Worth noting what kind of bug this is: the same shape as §50's, where every test
minted its own token and so nothing noticed that no admin could log in. A test
suite that is not held to the same standard as the code quietly stops testing
what it appears to.

### 58.5 What is NOT done, and is not claimed

**There is no Airtel client yet.** An Airtel number therefore resolves to
`AIRTEL_MONEY`, finds no provider registered, and returns a 503 saying Airtel is
not accepted here — which is the correct behaviour for today and the reason
routing was worth shipping before the client: the alternative was collecting an
Airtel customer's deposit on MTN.

The client is §59, and it is blocked on two things, both outside the codebase:

1. **Credentials.** The application is registered (Rwanda, TEST mode) but the
   portal shows *"Credentials are not generated yet. Please get your application
   approved."* Approval is a human review with no published SLA.
2. **The API specification.** Airtel's documentation sits behind the portal
   login, so the endpoint paths, header names, request shape and status codes
   cannot be read from here. Writing an HTTP client from memory would produce
   something that compiles, passes its own stubs, and cannot be trusted —
   exactly the kind of work that looks finished and is not.

§17.6 verified MTN against the real sandbox by hand before it was called done.
Airtel gets the same bar or it does not get the claim.

### 58.6 Verified

`test/operator-routing.spec.ts` (11): the four Rwandan prefixes, an unrecorded
Rwandan range returning null, South Sudan returning null rather than assuming
MTN, longest-country-code-wins, and junk input returning null instead of
throwing.

Full suite: **961 passing across 25 suites**, no schema change and no drift.

---

## 59. The test suite is typechecked, and cannot stop being (2026-09-23)

Closes the gap §58.4 found: `test/` was never type-checked, and had accumulated
20 errors nobody could see.

### 59.1 Why nothing caught it

Two things had to be true at once, and both were.

`tsconfig.json` has `include: ["src/**/*"]`, so `tsc --noEmit -p tsconfig.json`
— the only typecheck anyone ran — never looked at a test file.

`tsconfig.test.json` *does* include both trees, and ts-jest is pointed at it
with no `diagnostics: false`. It looked as though tests were checked at
transform time. They were not: running `tsc` against that very config reports 20
errors while `npm test` passes them all. ts-jest (29.4, ESM mode) was
transpiling without type information.

That second part is the lesson worth keeping. **A type check that happens as a
side effect of something else is not a type check you have.** The fix is not to
coax ts-jest into checking, which would leave the guarantee resting on a
transform's internals again, but to run `tsc` explicitly and make it a gate.

### 59.2 The gate

```json
"typecheck": "tsc --noEmit -p tsconfig.test.json",
"pretest":   "npm run typecheck"
```

`npm test` now refuses to start Jest if either tree fails to compile. Verified
the way §26.4 verified the boot test — by breaking it on purpose: a deliberate
`const x: number = "..."` in a spec makes `npm test` exit non-zero *without
running a single test*, and removing it restores a clean run.

1.4 seconds, so it costs nothing worth mentioning against the feedback it buys.

### 59.3 What the 20 errors actually were

Only one was cosmetic. In order of how much they mattered:

- **Stubs typed as `jest.fn()` with no signature.** `jest.fn()` from
  `@jest/globals` infers an untyped function, which makes `mockResolvedValue`
  take `never` — so *every* override in the suite was a type error. Worse, an
  untyped stub cannot drift from the interface it stands in for, because there
  is nothing to drift from. Each stub now carries a real signature, so a stub
  that stops matching its interface fails to compile.
- **`withByline` in `reviews.service.ts` returned an inferred union**, one arm
  of which has no `customer`. Reading `.customer` was therefore a compile error
  even for the viewer entitled to it. **The tests were right and the source type
  was wrong** — the return type is now explicit, with `customer` optional. This
  is the one `src` change here, and it is the point of the exercise: typechecking
  tests found a defect in the code, not in the tests.
- **`Array.prototype.at`** used against an ES2021 target. It runs fine on Node
  24, so it worked; it would have failed a build that honoured the target.
- **`.find()` result read without a null check**, which would have produced a
  `TypeError` saying nothing useful had the row ever been absent.
- **A duplicate import** of `PlatformSettingsService` in `ledger.spec.ts`.
- **A helper whose parameter was narrowed to `BusinessStatus.PENDING`** by its
  own default value, so passing `SUSPENDED` was an error.

### 59.4 The pattern this is the third instance of

§50: every test minted its own token, so nothing noticed that no admin could log
in. §58.4: a test passed an object where a string was declared, and it surfaced
only when production code finally read the argument. Now this.

Each time, the suite was measuring something narrower than it appeared to, and
the gap was invisible *because* everything was green. A test suite held to a
lower standard than the code it guards quietly stops testing what it looks like
it tests — and the failure mode is always silence, never a red build.

### 59.5 Verified

`npm run typecheck`: **0 errors** across `src/` and `test/`. Full suite: **961
passing across 25 suites**, unchanged, with the gate in front of it.

---

## 60. A generated API contract, before three clients are built against it (2026-09-23)

Frontend work starts now: an Admin dashboard, then a Business app, then a
Customer app in React Native (§61). All three talk to this backend, and until
this commit the only description of its shape was a hand-written table in
`docs/IMPLEMENTATION_INVENTORY.md`.

That table is a dated snapshot, and §56.5 deliberately left it holding the OLD
money field names — `depositAmountCents`, not `depositAmountMinor`. **A client
written from it would have been wrong on its first request**, in the money
fields, which is the worst place to be wrong.

### 60.1 Generated, never written

`@nestjs/swagger` with the CLI plugin, reading the DTOs' own TypeScript types.
The contract therefore cannot disagree with what the validation pipe accepts,
because they are derived from the same declarations.

This matters more than it usually would. `whitelist` + `forbidNonWhitelisted`
are doing security work here (inventory risk #5): the DTO is the boundary. A
separately maintained contract would drift from that boundary silently, and the
drift would be discovered by whoever was building a client, days later.

`introspectComments` is on, so the doc comments already on the DTOs become the
API descriptions. The explanation of MSISDN format that was written for the next
developer is now also what a client author reads.

### 60.2 Two failures that generate cleanly and describe nothing

Both were hit, both silent, and both would have shipped:

**The plugin only runs at compile time.** Generating through `ts-node` — the way
every other script in this repo runs — produced **43 schemas with no
properties**. It exits zero. It writes a well-formed file. A client generated
from it cannot send a single field. So the generator lives under `src/`, is
compiled by `nest build`, and runs from `dist/`.

**`PartialType` from the wrong package.** `UpdateLocationDto` and
`UpdateServiceDto` extend `PartialType(...)` from `@nestjs/mapped-types`, which
produces identical runtime validation and carries **no property metadata**. They
appeared as empty objects. Swapped for `@nestjs/swagger`'s, which behaves the
same and keeps the metadata.

The generator now **refuses to write a contract containing any property-less
schema**, naming them and both likely causes. A contract that looks finished and
describes nothing is worse than no contract, because nobody goes looking for it.

### 60.3 Where it lives

- `docs/openapi.json` — committed, so the contract a client was built against is
  visible in a diff rather than reconstructed from a server that has since moved
  on. **90 paths, 45 schemas, none empty.**
- `GET /docs` — the interactive page, served only outside production, or with
  `OPENAPI_PUBLIC=true`. The spec is a complete map of the attack surface and
  the clients are generated from the file, so there is no reason to publish it.
- `setupOpenApi` is called from `configureApp`, not `main.ts`, so the §26 boot
  test exercises it. Document generation throws on types it cannot resolve,
  which makes that test a check on the contract as well as the wiring.

### 60.4 What is NOT done

`docs/IMPLEMENTATION_INVENTORY.md` still carries the old field names. It stays
as it is — §56.5's reasoning holds, it is a dated audit and quietly editing it
would make it a worse record. `docs/openapi.json` is now the live contract, and
the inventory is history.

Full suite: **961 passing across 25 suites**.

---

## 61. The admin console (2026-09-23)

The first frontend. React + Vite + TypeScript in `apps/admin-web`, built to
static files.

### 61.1 Why admin first, and why not all three at once

§4 planned three apps: Business, Customer, Admin. The order is not a preference,
it is a dependency.

**Nothing works until an admin exists.** A business cannot go live without
approval (§42); no payout can flow until an admin verifies the destination
(§48); a manual arrival verification (§54.3) is only a control if somebody reads
it. All of that was curl-only — which is why §49's walk-through needed a
hand-signed JWT to get past step 8.

The Business app is next, and it matters more than it sounds: with only Customer
and Admin, a customer can book and pay a deposit and then **nothing further can
happen** — nobody can enter the arrival code, so no appointment reaches
COMPLETED, so no ledger entry becomes payable, so no payout ever runs. The
platform could take money and never finish a transaction.

### 61.2 React + Vite, not a framework with a server

An internal tool behind a login has nothing for SSR or SEO to buy, and a
framework with a server is a second thing to deploy and a second place for
secrets to live. This compiles to files.

Vite proxies `/api/*` to the backend in development, so the browser sees one
origin and **CORS does not apply locally**. That is deliberate: it keeps the
current `enableCors()`-allows-everything state from being papered over. The
first production deploy is the moment it has to be narrowed, and the README says
so rather than leaving it to be discovered.

### 61.3 The client is the only place that talks to the backend

Three things are easy to get subtly wrong at every call site, so they are done
once:

- **Attaching the token.**
- **Refreshing it.** A single in-flight refresh promise, shared. Without that, a
  page firing five queries on a stale access token starts five refreshes; four
  present a token the first has already rotated, and the person is signed out in
  the middle of a working session.
- **Giving up.** Exactly ONE retry after a refresh. A second 401 means the token
  is fine and the account genuinely may not do this, so retrying again would
  loop forever against a server answering correctly.

Tokens live in `localStorage`: an admin who reloads mid-task should not have to
sign in again, and this is an internal tool on a trusted device. The honest cost
is that an XSS bug could read them — which is why the app renders no
user-supplied HTML anywhere, and why the access token stays 15 minutes.

`RequireAuth` and the role check on the login screen are **presentation**. Every
admin route is guarded on the server and asserts the role again in the service
(§27.1). Deleting them would make the app ugly, not insecure.

### 61.4 Hand-written endpoint signatures over a generated client

`docs/openapi.json` owns the shapes; `src/api/admin.ts` records which of the
backend's ninety endpoints this app actually touches. A fully generated client
would hide that, and an endpoint disappearing would surface as errors scattered
across components rather than in one file.

### 61.5 A bug that only running it could find

The client defaulted its base URL to `''`, so it called `/auth/otp/request` on
the dev server's own origin — where nothing listens, because the proxy only
forwards `/api/*`. **Every request in development would have 404'd**, and the
build, the typecheck and the unit-level reasoning all pass regardless.

Found by starting both servers and calling through the proxy by hand. It
defaults to `/api` now. This is the §49 lesson again, at a smaller scale: tests
and types inherit your assumptions, and running the thing does not.

### 61.6 Verified by hand

Against a real backend on current code, with `seed:demo` data:

- `/docs` serves the generated contract (200).
- The **real OTP flow**: request a code for `demo-admin@example.com`, read it
  from the backend log, verify it, receive an access and refresh token pair.
- `GET /admin/businesses?status=PENDING` through the **vite proxy**, with that
  token: 200, two businesses, one of them nameless — which is exactly the
  "needs a name first" case the queue disables the Approve button for.
- `npm run build`: typecheck clean, 216 kB of JS (69 kB gzipped).

~~**Not verified: the rendered UI.** Nothing here has been clicked in a browser.~~
**Closed the same day**: the login screen and the approval queue were driven by
hand in a browser and behave — two pending businesses, the nameless one with
Approve disabled and "Needs a name first" beside it.

---

## 62. Admin console: payout destinations (2026-09-23)

The second screen, and the one that unblocks money.

### 62.1 Why this screen before any other

An unverified payout destination **pauses** that business's payouts rather than
skipping them quietly (§48.3). So a business sitting in this queue is a business
not being paid, and until now the only way to clear it was a hand-written PATCH.
Of everything still missing from the console, this was the one whose absence
actively costs someone money.

The page says so, above the queue, rather than leaving an admin to infer that an
untouched list is an unpaid business.

### 62.2 The admin sees the full number, and should

Every other reader gets `msisdnLast3` — including the business's own staff, so
that a manager cannot read off where the money goes (§48.4). The admin list
returns the whole number.

That is not an inconsistency to fix. Verification means contacting the holder
and confirming the number is theirs, and that cannot be done against three
digits. The asymmetry is the design: the one person who must see it does, and
nobody else does.

Worth recording because it is easy to "tidy up" later. `PayoutDestinationsService.list`
returns rows straight from Prisma rather than through `publicFields`, and a
future refactor routing it through the view mapper for consistency would quietly
remove the admin's ability to do the job.

### 62.3 The verification note is the whole control

`verificationNote` is required, 3–500 characters, and the prompt asks *how* the
number was confirmed rather than for a comment. Money sent to a payout
destination does not come back, and "VERIFIED" with no account of how is not
something anyone can audit afterwards. The note, the admin's id, and
`verificationMethod: ADMIN` are all recorded — §48.1's point that an
admin-verified row and an OTP-verified row are different facts.

Both prompts validate the minimum length in the browser before sending. The
server enforces it regardless; doing it here means an admin who types "ok" is
told immediately instead of after a round trip.

### 62.4 Verified by hand

Against the live backend, with the token from a real OTP login:

- `GET /admin/payout-destinations` — 4 destinations, 1 UNVERIFIED (Juba Auto
  Care), full msisdn present as expected.
- A note of 2 characters → **400**, and the message arrives as an ARRAY —
  which the client's error handling already joins, so it renders as a sentence
  rather than `[object Object]`.
- Verifying an already-VERIFIED destination → **400**, *"Only an UNVERIFIED
  destination can be verified. This one is VERIFIED."*

The happy path was deliberately **not** exercised by curl: there is exactly one
unverified destination in the demo data, and consuming it would have left the
queue empty for whoever opens the screen next.

---

## 63. Admin console: payouts (2026-09-23)

The screen that lets money actually leave. Third of the console.

### 63.1 Nothing here moves money

Every transfer is made by hand against the provider (§36.7). This screen creates
the list and records what a human did afterwards — which is why "Mark sent"
demands the provider's reference rather than being a button that just flips a
status. A PAID payout with nothing to look it up by is a claim that money moved
which nothing can corroborate.

"Failed" returns the money to the pool for the next run, so it demands a reason
for the same reason every other moderation action here does: somebody will ask
later why it did not go out.

### 63.2 Held-back businesses are listed, never summarised

A run returns counts *and* `pausedBusinesses`, and the page prints the list. A
smaller batch with no explanation is precisely how a business quietly stops
being paid (§48.3) — the count tells an admin something is wrong, the list tells
them who to chase.

`skippedNonPositive` is shown separately and worded as carry-forward rather than
as an error, because a negative balance is not a failure: §35 deliberately
leaves those entries unstamped rather than forgiving the debt.

### 63.3 Money is shown in minor units, undivided

`SSP 2,583,750 minor`, not `SSP 25,837.50`.

A currency's decimal places are a property of the currency (§55.2), and this app
does not carry that table — only the backend does. Dividing by 100 here would be
the exact mistake §55 and §56 exist to prevent, and it would be invisible: the
number would look like money and be wrong by a factor of a hundred in any
zero-decimal currency.

Both figures are shown per payout, labelled: the settlement amount is what is
actually sent, and the internal amount is marked "reporting" so nobody
reconciles a transfer against it (§51.2).

### 63.4 The CSV export could not be a link

`<a href>` sends no Authorization header, so the export came back **401** —
confirmed by hand. It goes through a `download()` helper that fetches with the
token and hands the browser a blob.

Worth recording because "make it a link" is the obvious simplification, and it
fails in a way that looks like a permissions bug rather than a missing header.

### 63.5 Verified by hand, end to end

Against the live backend:

- `POST /admin/payouts/run` — **3 payouts created** from 4 businesses considered,
  1,998,750 SSP minor, 1 skipped for a non-positive balance.
- `GET /admin/payouts/:id/export` — 200, `text/csv`, a
  `Content-Disposition` filename, three rows and a TOTAL row carrying each
  business's verified destination, provider and `payable` flag.
- The same export **without** a token — 401, which is what §63.4 is about.
- `mark-paid` with a two-character reference — 400.

**The payout destinations screen (§62) is confirmed working by use, not by
assertion.** Juba Auto Care's destination was UNVERIFIED when §62 shipped and was
VERIFIED through the console before this run, recorded as
`verificationMethod: ADMIN` with the operator's own note. That is why its payout
appears in the CSV — and it is a better test than anything written here, because
it went through the browser.

---

## 64. Sending a payout through the operator (2026-09-23)

Until now MoMo was collections-only, so §36.7 recorded that every payout was
wired by hand. This is the other direction.

### 64.1 A separate interface, not more methods on `PaymentProvider`

Collections and disbursements are different MTN products with different
subscription keys, different API users and different token paths. A deployment
can easily collect while being unable to pay out — during onboarding that is the
**normal** state, because disbursement needs a merchant agreement that
collections does not.

So `DisbursementProvider` is its own interface and `MomoDisbursementProvider`
its own class. Folding them together would mean one object holding two sets of
credentials, where using the wrong pair fails with "subscription not found" —
an error that reads like broken code rather than a crossed wire.

`ProviderRegistry` is now a shared generic base behind both registries. The
rules are identical in both directions and expensive to get wrong in both: an
unconfigured operator must be **absent** rather than present-and-failing, and
with two operators live there must be **no default**. Two copies of "refuse to
guess which network" would drift, and the copy that drifts is the one used less.

### 64.2 Being unable to pay out is not a boot failure

`MomoDisbursementProvider` warns and carries on when unconfigured, exactly as
the collections provider does. A platform that cannot pay out should still take
bookings; payouts then fail with a message naming the three variables and the
provisioning command.

The empty `DisbursementProviderRegistry` supplied to every test suite says the
same thing honestly: a test database has no operator credentials, so "cannot pay
out" is simply true there.

### 64.3 The order of writes is the whole safety property

`providerReferenceId` and `PROCESSING` are written **before** the operator is
called.

The other order loses money. If the call succeeds and the process dies before
recording anything, the payout still reads PENDING — and the next person to
press send pays the business twice. Written first, a crash leaves a PROCESSING
row whose outcome the poller can ask for.

MTN keys a transfer on `X-Reference-Id`, which **we** choose. Presenting the
same one again is rejected as a duplicate rather than paid twice, so the whole
operation is safe to repeat. A payment system needs that far more than it needs
speed.

`PROCESSING` exists for the same reason. Without it, PENDING would mean both
"nobody has sent this" and "it is with the operator and we do not know" — and
the difference between those is whether pressing send again pays twice. §33.3's
rule: a status that cannot tell two situations apart is a status that forgets.

**A refusal returns the payout to PENDING, not FAILED.** The operator never took
the request, so nothing is in flight and the money should stay stamped to this
payout, ready for another attempt. FAILED is reserved for a transfer that was
accepted and then did not arrive — and that is what releases the entries.

### 64.4 One payout at a time, deliberately

`POST /admin/payouts/:id/send` sends one. There is no batch route.

A bug in a batch pays every business wrongly before anyone notices; a bug here
pays one business wrongly and stops. Money out is the direction that cannot be
undone, and this codebase has taken that position before — §53.4 made deposit
confirmation a guarded script rather than an endpoint for exactly this reason.
A "send all" can be added once this has been watched for a while.

The poller runs every minute rather than every second: a mobile-money transfer
settles in seconds to minutes, a payout sitting PROCESSING one minute longer
costs nothing, and hammering a status endpoint is how an integration gets
rate-limited. It is separate from the daily run, because a payout created today
and sent tomorrow still needs its outcome recorded.

### 64.5 `INSUFFICIENT_FUNDS` is its own failure kind

§52.2 split provider failures into CONFIGURATION and TRANSIENT. Disbursement
adds a third, because `NOT_ENOUGH_FUNDS` has a specific and actionable answer —
top up the disbursement account — and reporting it as "temporary, try again
later" would have an admin waiting a day for something that will never resolve
on its own.

### 64.6 Verified

`test/disbursement.spec.ts` (17). Nearly all of them are failure modes, because
that is where the money is:

- The operator sees the row **already PROCESSING with a reference** — the §64.3
  property, asserted from inside the provider call itself.
- The reference handed over is the one recorded, and the amount sent is the
  **settlement** figure, never the internal one.
- A refusal returns it to PENDING with the entries still stamped, and it can be
  sent again with a new reference.
- A success becomes PAID carrying the **operator's** reference — the one that
  reconciles against a statement.
- A failure releases its entries, and the **next run picks that money up**.
- An operator that throws does not stop the sweep.

Full suite: **978 passing across 26 suites**, no drift.

### 64.7 Not yet done

Nothing has touched MTN's sandbox. The credentials are provisioned and the code
is tested against a fake, which is not the same claim — §17.6 verified
collections against the real sandbox by hand before it was called done, and
disbursement gets the same bar. The admin console still has no Send button;
that is §65.


---

## 65. Sending from the console, and what the CSV is actually for (2026-09-23)

§64 built the capability. This connects it to a button, and corrects a claim
made earlier in the same breath.

### 65.1 The export existed because the screen was incomplete

Challenged on why the CSV was needed at all, the honest answer turned out to be:
**it mostly was not.**

Compare what each showed. The console: a truncated business id, an amount, a
date, a status. The export: the business NAME and the payout NUMBER — the two
things you actually need in order to pay somebody.

So an admin exported a spreadsheet to read two fields the screen could have
shown. That is a gap in the screen dressed up as a feature of the file. The
payout list now carries `businessName`, `destinationMsisdn` and
`destinationProvider`, and the daily job needs no download at all.

**What the export is still for** is the one thing a web page is genuinely bad
at: checking a batch against an operator's statement. Forty transfers on a
statement against forty payouts in a system is a job for two spreadsheets side
by side. The button now says "Export for checking" rather than "Export run",
because the old name described its old purpose.

It also remains the fallback for what automation does not cover — an operator
with no disbursement client (Airtel today), a deployment without disbursement
credentials, and the day the API is down and somebody pays by hand anyway.

### 65.2 Excel ate the one column that mattered

`+211921000004` opened as `2.11921E+11`. A leading `+` makes Excel decide the
cell is a number, and quoting does not help — Excel converts quoted
numeric-looking cells too.

`csvTextCell` wraps such values in the `="..."` formula form, which Excel,
Google Sheets and Numbers all render verbatim. After RFC-4180 escaping the cell
on disk carries a doubled-quote form, and a test asserts those exact bytes —
because the obvious "simplification" back to a bare value silently restores the
bug.

Ugly in a text editor, and correct for the only reader this file has: a person
with a statement open beside it.

### 65.3 Send is the main action; Mark sent is the fallback

`Send` is the primary button. `Sent by hand` and `Mark failed` are demoted to
plain links.

They cannot be removed. The platform can only ask an operator about a transfer
**it** created, because the status lookup is keyed on the reference the platform
chose. A transfer made in the operator's own dashboard carries a reference the
platform never sees, so there is nothing to look it up with — and matching on
amount and number would guess wrong the first time a business is paid the same
figure twice in a month. While a human can send money outside the system, the
system can only learn what happened by being told.

Send is disabled, with the reason printed on the row, when a business has no
verified destination — rather than offering a button that returns an error.

### 65.4 Verified against MTN's real sandbox

Not against a stub. The whole loop, by hand, on the live sandbox:

1. `POST /admin/payouts/:id/send` returned **HTTP 200** with status `PROCESSING`
   and our own reference recorded.
2. MTN accepted the transfer: *"MoMo transfer accepted ... amount=650.00 EUR"*.
3. A minute later the scheduled poll asked MTN and got SUCCESSFUL:
   *"Payout 34ef5d3a... confirmed PAID by the operator."*
4. The payout now carries MTN's **own** transaction id, `772164286` — the number
   that reconciles against a statement — and a `paidAt`.
5. Its six ledger entries stayed stamped to it, as they must for a payout that
   actually went out.

No "Mark sent". No opening the operator's dashboard. No copied reference.

**The EUR override was required** (§52.1): MTN's sandbox accepts only EUR while
the demo data is priced in SSP, so the outbound request said 650.00 EUR for a
payout the ledger records as 65,000 SSP minor. The two deliberately disagree,
which is precisely why boot refuses that flag in production.

### 65.5 Still not done

Production. The sandbox proves the integration works; it does not prove MTN will
let this account move real money, which needs the merchant agreement and an
answer on the disbursement float. Airtel has no disbursement client at all, so
an Airtel destination still returns a 503 — correctly, and under test.

---

## 66. The platform moves to Rwanda (2026-09-23)

§55 through §58 were all Rwanda groundwork — the currency exponent, the rename,
multi-operator support, the `+250` prefix routing. The deployment itself was
never switched, and stayed entirely South Sudan while that work piled up behind
it. This is the switch.

### 66.1 What actually changed

| | Was | Is |
|---|---|---|
| `INTERNAL_CURRENCY` | unset → USD | **RWF** |
| Provider currency | SSP at 650 | **RWF at 1** |
| `PLATFORM_TIMEZONE` | Africa/Juba | **Africa/Kigali** |
| Payout prefix | +211 | **+250** |
| Demo world | Juba | **Kigali** — real coordinates, `+250` numbers, franc prices |

The rate is **exactly 1**, and it has to be: the platform now prices, charges
and settles in the same currency, so there is nothing to convert. §55.3 already
refused any other value for the unit of account, which is the check doing its
job rather than a coincidence.

### 66.2 The approximate figure now suppresses itself

§39 built an indicative local-currency figure beside every price, because a
customer quoted in USD cannot tell what they will actually pay. In Rwanda the
price IS in francs and the charge IS in francs, so "approximately RWF 20,000"
beside "RWF 20,000" is noise — and worse, it invites the reader to wonder which
of the two numbers is real.

`getExchangeRateForDisplay` now returns null when the provider currency is the
unit of account, so the figure is omitted everywhere at once. §55.3 predicted
this machinery would idle; this is where it does. Verified on a live read: no
`approxSettlement` key on any discovery response.

### 66.3 A default of "USD" in the schema, caught by the guard

Four tables — `services`, `appointments`, `ledger_entries`, `payouts` — declared
`currency String @default("USD")`. Correct for a dollar deployment, and silently
wrong for any other: the **database** stamps "USD" on a row holding francs, and
nothing downstream can tell, because the number and the label are equally
confident.

`CurrencyGuard` refused to boot after the switch, naming both currencies. That
is precisely the failure §55.1 was written to produce, and it produced it on the
first run rather than after a month of mislabelled money.

**The defaults are removed rather than changed.** A default cannot be right for
every deployment, and one that is silently applied is worse than none. With the
column still NOT NULL and no default, every write must state the unit — and the
compiler then listed all six sites that did not.

### 66.4 The test suite pins its currency

`test/setup/env.ts` sets `INTERNAL_CURRENCY=RWF` explicitly, alongside where it
already pins the database URL and `NODE_ENV`.

Without that, assertions about converted figures would pass or fail depending on
which country a developer happened to have configured — a suite reporting on the
environment rather than on the code. RWF specifically because it has **no minor
unit**, which is the case most expensive to get wrong: a two-decimal assumption
misstates it by a factor of a hundred (§55.2). Worth running every integration
test against, not only the unit tests.

Updating the suite for it surfaced the assumptions that had been hiding in test
data rather than in code:

- Converted figures are now **100× larger**, because the internal currency has
  no minor unit and SSP has two. That is the arithmetic being asserted, not an
  accident, and the helper now says so.
- A billing adjustment of "1" is one franc, not one dollar, so the balance moves
  by 1 rather than 100. The assertion derives it from the currency now, because
  a literal `100` there was the §55.2 assumption in test form.
- The zero-decimal case in `internal-currency.spec.ts` had to move from RWF to
  UGX, since RWF is no longer "some other currency".

### 66.5 Verified, and one thing deliberately not claimed

- Boots clean: *"Internal unit of account: RWF (0 decimal places)."*
- `prisma migrate reset` + taxonomy + demo seed: 8 businesses, 9 locations, 13
  services, 13 appointments, 28 ledger entries — all denominated in francs.
- A public discovery read returns 7 locations with `fromPriceMinor` in whole
  francs and **no** `approxSettlement`.
- Full suite: **978 passing across 26 suites**, no drift.

**`docs/MANUAL_WALKTHROUGH.md` has NOT been re-walked.** Its names, coordinates
and currency are updated and its response shapes are unchanged, but the specific
figures and distances were measured against the Juba dataset. §49's standard is
that a walk-through is worth trusting only when it has actually been run, so the
document now says at the top that it currently is not.

---

## 67. Re-walking the guide in Rwanda (2026-10-01)

§66 re-pointed the platform and explicitly did **not** re-walk the manual guide.
This is the walk, run end to end against a freshly reseeded Kigali database.

Per §49, the findings are the output. Nothing below was fixed on the way.

### 67.1 `openNow` returns fewer rows than its own `total`

`GET /discover/locations?openNow=true` returns **6** locations and reports
`total: 7`. Without the filter, 7 and 7.

Nyamirambo Salon is closed all day today by design, and it is correctly absent
from the rows — but `total` is counted before `openNow` is applied, so a client
paginating on `total` asks for a page that does not exist and reports a count
that is wrong by one. Every other filter is applied in the query; this one is
not.

### 67.2 The guide described an `approxSettlement` that no longer exists

Doc-only, and now corrected. §66.2 suppresses the indicative figure when the
provider currency IS the unit of account, which is the whole point of pricing in
francs — but the guide still told the reader to look for it on four different
responses.

### 67.3 The collections log prints the amount against the wrong currency

```
MoMo requesttopay accepted: ... amount=10.00 RWF ...
```

`amount` is formatted against the **outbound** currency — EUR under the sandbox
override, hence two decimals — while the code beside it is `params.currency`,
the real one. MTN was sent `10.00 EUR`; the log claims `10.00 RWF`, which in a
zero-decimal currency is not even a well-formed figure.

The §55.2 fix corrected the request **body** to resolve both from one
`outboundCurrency` and missed this line. The disbursement provider, written
later, prints `amount=46.00 EUR` correctly — so the two sit side by side in the
same log, one right and one wrong.

A logging bug, not a charging bug: the body is correct and the customer is
charged the right amount.

### 67.4 Analytics still hardcodes USD

`analytics.service.ts:236` returns `currency: 'USD'` — the only hardcoded USD
left in `src/` after §66. The same business's `/balance` correctly reports RWF.

So a business reading its own analytics is shown franc amounts labelled as
dollars, in the one screen built to tell it what it has earned. This is exactly
the class §51 and §56 exist to prevent, surviving in the one place neither
touched.

### 67.5 Billing adjustments are now unpayable — a regression from §66.2

The serious one.

`executeAdjustment` derives the entry's settlement figure from
`getExchangeRateForDisplay()`. §66.2 taught that helper to return **null** when
the provider currency is the unit of account — correct for suppressing a display
figure, and fatal here: the adjustment entry is written with
`settlementCurrency: NULL` and `settlementAmountMinor: NULL`.

A payout run excludes entries with no settlement figure, because there is no
amount to send (§46.3). So **in a single-currency deployment every billing
adjustment becomes money that can never reach a business.** Confirmed in the
database: one `ADJUSTMENT` entry, 2 minor units, both settlement columns null,
and the run reporting `entriesWithoutSettlement: 1`.

Two faults compounded:

1. A **money** path read a helper named `...ForDisplay`. That was a smell before
   today — the name says what it is for, and settlement is not display.
2. §66.2 changed a shared helper for a presentation reason without checking who
   else depended on it.

**978 tests did not catch this.** The refunds suite asserts the adjustment
entry's amount and sign, never its payability; the payout suites build entries
with settlement columns set explicitly. Nothing asserted that an adjustment is
something a payout run can actually pay — which is the only reason an adjustment
exists.

### 67.6 What the walk CONFIRMED

Not everything was a finding. Verified live, in Rwanda configuration:

- Money is exact in whole francs: a 5,000 RWF haircut gives a 1,000 deposit =
  500 fee + 500 business, and the ledger pair is +1000 / −500 with settlement
  equal to reporting, matured, `payoutHoldDaysApplied: 2`.
- §54.2's arrival-code rule: the customer's own read carried
  `verificationCode: 399645`; the business's read of the same appointment had no
  such key at all.
- The deposit **succeeds** now, where the guide said it failed. MTN's sandbox
  auto-approves, so the appointment reached `BOOKED` without any manual
  confirmation — and `dev:confirm-deposit` correctly refused to write a second
  set of entries.
- Approval moved discovery from 7 public locations to 8.
- A review posted, appeared with a display name and no identity, and moved
  `ratingAvg` 3.5 → 3.8 across 5.
- The whole payout loop: destination verified, run created 2 payouts, one sent →
  `PROCESSING` → `PAID` with MTN's own reference, in about 35 seconds.
- The CSV carries `="+250788100001"` text-forced (§65.2), settlement equal to
  reporting, and the paid row's operator reference.

### 67.7 The guide is now accurate

Every figure in `docs/MANUAL_WALKTHROUGH.md` was replaced with what this walk
actually produced, the §66.5 "not re-walked" banner is removed, and the two
findings a reader will hit in passing — §67.1's count mismatch and §67.5's null
settlement columns — are called out where they appear, so nobody wastes an hour
deciding whether they have misread it.

---

## 68. Adjustments become payable again (2026-10-01)

Fixes §67.5, the regression this walk-through found. Two of the three things
§67 recommended; the third is below.

### 68.1 Settlement gets its own source

`executeAdjustment` read `getExchangeRateForDisplay()` to decide what a ledger
entry settles in. That function answers a presentation question — "is there an
indicative figure worth showing?" — and §66.2 correctly taught it to return null
when the provider charges in our own currency, because there is nothing to
approximate.

The ledger then wrote entries with no settlement figure, and a payout run skips
entries it cannot send. Every billing adjustment became money stranded in the
ledger: visible in a balance, counted in a total, unpayable forever.

`getSettlementContext()` now answers the money question separately. It returns
null **only** when settlement is genuinely impossible — a foreign provider
currency with no rate configured to reach it. When the provider charges in the
unit of account there is nothing to convert, so the rate is 1 and it always
succeeds, with no configuration at all.

The lesson is the naming one: a function called `...ForDisplay` should never
decide what gets sent, and the fact that it did was visible in the name before
it was visible in the money.

### 68.2 An unsettleable adjustment is refused, not written

If settlement genuinely cannot be determined, `executeAdjustment` now throws
rather than writing a null-settlement row.

This is the §67 recommendation about failing at write time, applied where it
costs nothing. Refusing is loud, lands in the code that caused it, and leaves
the adjustment unexecuted so it can be retried once a rate is set. The
alternative — what happened — is money that looks settled and silently never
moves.

### 68.3 `providerCurrency` stopped defaulting to EUR

The direct cause, found while fixing it. `platform_settings.providerCurrency`
defaulted to `"EUR"` — a sandbox leftover, since MTN's sandbox accepts only EUR.

So a settings row created by an unrelated write, such as setting the payout
hold, silently declared that the platform collects in euros. With no rate to
EUR, nothing could state a settlement amount.

Removed, exactly as §66.3 removed the USD defaults and for the same reason: a
currency default cannot be right for every deployment, and one the database
applies silently is worse than none. The service now states the unit of account
on every create, and the compiler listed the four sites.

### 68.4 The test that was missing

§67.5's real finding was not the null column — it was that **981 tests never
asserted an adjustment is payable**, which is the only reason an adjustment
exists. The refunds suite checked the entry's sign, amount, type and
idempotence; nothing checked that a payout run would pick it up.

Three tests now do, under a heading that says not to delete them: the settlement
columns are non-null, the next run reports `entriesWithoutSettlement: 0` and
creates a payout, and the entry ends up stamped with the payout that paid it.

Fixing this also exposed that `held total` had been asserting across currencies
— summing every entry into the SSP bucket and comparing. That passed only
because null-settlement entries fell out of both sides. Scoped per currency now,
and the reporting assertion strengthened from a bound to an equality, which is
what it should have been.

### 68.5 Verified

- **981 passing across 26 suites**, no drift.
- Dev database reset and reseeded: the adjustment entry carries `RWF / 2`, and
  **zero** entries have no settlement figure. It was 1 before this.

### 68.6 Not done

§67's third recommendation — making the settlement columns `NOT NULL` so the
database refuses an unpayable entry — is deliberately left. It is the strongest
version of this fix, and it needs a decision about rows that legitimately
predate settlement tracking (§45 added those columns to an existing ledger and
backfilled only what it could). That is its own commit, not a footnote to this
one.

---

## 68.7 Two more EUR fallbacks (2026-10-01)

Found by the question "is EUR a default that can't be changed?", which is the
right question to ask about a currency literal.

§68.3 removed the schema default. Two more survived in code:

**`getExchangeRate()` reported `providerCurrency: 'EUR'` when the settings row
is missing.** Harmless to money — the rate is null, so the charge path refuses —
but it tells an operator the platform collects in euros when nothing has been
configured at all. The honest reading of "no settings row" is "we collect in
what we price in".

**`setExchangeRate` wrote `providerCurrency ?? 'EUR'` on create.** This one
mattered: §55.3's checks run against `targetCurrency`, which falls back to the
unit of account — so the validation and the write disagreed. An admin setting a
rate without naming a currency, on a fresh database, would be validated as RWF
and stored as EUR. The write now uses the value that was actually checked.

Both are the same shape as §66.3 and §68.3: a currency literal left behind by
whatever the sandbox needed at the time, surviving in a place nobody re-read.
The remaining "EUR" strings in `src/` are documentation examples, which is where
a sandbox currency belongs.

**981 tests, unchanged.**

---

## 69. Admin console: settings (2026-10-01)

Fourth screen, and the one with a live-deployment risk behind it: the exchange
rate has no feed, goes stale loudly (§37), and until now could only be corrected
with curl.

### 69.1 A rate that cannot be wrong cannot go stale

Found while building the screen, which is the useful thing about building a
screen for something.

`getExchangeRateStaleness` compared the rate's age against a threshold and
nothing else. In a deployment that collects in its own unit of account the rate
is pinned at **1** by §55.3 — it has exactly one legal value — so its age says
nothing about whether it is correct.

The hourly sweep would therefore have declared it stale and emailed every admin,
every day, forever, about a number nobody can change. **An alarm that cries wolf
is worse than no alarm**: it trains people to ignore the one case where
staleness really is money leaving at the wrong price.

Staleness now reports `conversionInUse: false` and `stale: false` when the
provider charges in the unit of account, and the admin view exposes that flag
rather than leaving a client to infer it by comparing two currency codes. A
client that infers it wrongly shows a red STALE badge on a fixed number.

Three tests pin it: never stale however old, the sweep notifies nobody, and a
genuinely converted currency still goes stale as before.

### 69.2 One save per setting

Four numbers, four forms, four buttons. A single "Save settings" would let
someone adjust the payout hold and ship a fee change they had typed earlier and
forgotten — and three of these four move money.

The rate section does not render an editable field at all when nothing is being
converted. An input that accepts exactly one value is worse than a sentence
explaining why.

### 69.3 The server's refusals are shown verbatim

The backend's messages here are written for a person, and rewriting them in the
client would lose the part that matters. Confirmed live:

- Raising the fee to 30%: *"12 active service(s) have a deposit percentage below
  that, and would price bookings with a negative business share... No pricing
  was changed."* (§40)
- Setting the rate to 650: *"RWF is this platform's internal unit of account, so
  the exchange rate must be exactly 1... There is nothing to convert."* (§55.3)

Both arrive as sentences an operator can act on. The screen prints them as they
are.

### 69.4 Verified

**984 passing across 26 suites.** Each endpoint exercised against the live
backend: `conversionInUse: false` with its explanatory note, both refusals
above, and the payout hold saved and restored.

### 69.5 Where the console stands

Four areas built — businesses, payout destinations, payouts, settings — and four
not: **tickets** (no support inbox at all), **ledger and adjustments** (including
executing one, which §68 just made payable), **reviews** (no moderation), and
**appointments** (no dispute reclassification).

The console is operationally usable: a business can be onboarded, checked and
paid. It is not complete.

---

## 70. The business app, first slice (2026-10-01)

The third app, and the one whose absence meant nothing could finish. A customer
could book and pay; an admin could approve and pay out; **nobody could verify an
arrival or complete an appointment except with curl** — so no appointment
reached COMPLETED, no ledger entry matured, and the payout screens built in §63
had nothing to pay.

Scaffolded from the admin console: same stack, same API client, same auth
context, port 5174 so both run at once. The token keys are namespaced per app,
because in development both are served from localhost and would otherwise share
one origin's `localStorage`.

### 70.1 `GET /payments/currency`, so no client divides by 100

Built because this app has to print money to a non-technical person every day,
and the admin console's honest-but-ugly "RWF 5000 minor" does not survive that.

The temptation is to divide by 100 in the client. That is correct in a
two-decimal currency and wrong by a factor of a hundred in one with no minor
unit — the §55.2 mistake, moved to the front end where it is harder to see and
appears in three apps instead of one.

So the server reports the exponent, unauthenticated, as a fact about the
platform: `{ code, exponent, minorUnitsPerMajor, note }`. Clients format from
it. While it is still loading the raw integer is shown with its code — ugly, and
never wrong.

### 70.2 The screen is the day's work, not the data model

It opens on **Expected**: booked customers who have not arrived. Everything else
is a tab. A business opens this app to deal with someone standing in front of
them, not to browse records.

Three decisions follow from that:

- The code input sits **in the row**, not behind a dialog. Verifying is the
  single most frequent action in the app and it should cost one keystroke
  sequence, not a click-then-type.
- **"You earn"** shows the business's share of the deposit, with the service
  price beneath it and the words "rest paid to you directly". Showing one number
  would invite reading it as the price (§29.2).
- Manual verification is a quiet link labelled **"No code?"**, shown only to an
  OWNER or MANAGER. It is the exception, and it should look like one.

### 70.3 A non-approved business is told why its list is empty

The sidebar says so when the profile is not APPROVED. A PENDING business is
invisible to customers and unbookable (§10.8), so its appointment list is empty
and correct — and indistinguishable from a bug unless something says otherwise.

### 70.4 Verified against the live backend

The whole loop, by hand, in Rwanda configuration:

- `/users/me` carries the membership role, which is what decides whether "No
  code?" is rendered at all.
- `/payments/currency` returns `RWF, exponent 0` — so the app prints
  `RWF 5,000`, undivided.
- A wrong code: *"Incorrect verification code. 4 attempt(s) remaining."*
- The right code: `BOOKED -> IN_PROGRESS`, `verifiedAt` stamped.
- Complete: `IN_PROGRESS -> COMPLETED`, `completedAt` stamped.
- Manual verification on a COMPLETED appointment: refused by the state machine.
  A two-character note: refused by the DTO.

**984 tests unchanged** — this slice adds one backend endpoint and no behaviour
to existing paths.

### 70.5 What is not built

Profile, locations, services, opening hours, staff, review responses, payout
destination, balance and analytics all have endpoints and no screens. This is
the daily loop only, which is the part that unblocks the rest of the system.

---

## 71. Business app: services, branches and hours (2026-10-01)

Slice two. After this a business can define what it sells and when it is open,
which was the last thing requiring someone to edit the database to onboard one.

### 71.1 A shared money formatter, fetched not assumed

`src/money.ts` wraps `GET /payments/currency` (§70.1) once and gives every
screen `format`, `toMinor` and `toMajor`.

`toMinor` matters as much as `format`: a person types **5000** meaning five
thousand francs, and the API wants an integer in minor units. In a two-decimal
currency that is 500000; here it is 5000. Doing that arithmetic per screen is
how one of them ends up off by a hundred, so it is done once, from the server's
exponent, and the input's `step` follows it too.

### 71.2 Services belong to the business; hours belong to the branch

That asymmetry (§10.2) is invisible in the API and surprising to an owner with
two branches, so both pages say it outright: a price change applies everywhere,
a week of hours does not.

Confirmed live, in both directions: adding a cheaper service moved
`fromPriceMinor` from 5000 to 3500 on **both** branches at once, and retiring it
moved both back. That is §44's denormalised aggregate doing its job, visible on
screen rather than only in a test.

### 71.3 The whole week is submitted at once

`POST /business/locations/:id/hours` **replaces** the week (§12.7). Sending only
the day someone edited would silently clear the other six.

So the form holds all seven days and saves them together, seeded from the server
and re-seeded whenever it changes — a successful save shows what was stored, not
what was typed.

### 71.4 Retiring, not deleting

A retired service is kept and shown in its own section, because past
appointments still resolve to what was booked (§10.5). The confirmation says so,
and the list offers "Bring back" rather than making an owner recreate it — which
would produce a second service with the same name and a different id.

### 71.5 Verified against the live backend

- Service created at RWF 3000, edited to 3500, retired, restored.
- §40 refusal, verbatim: *"Deposit percentage must be at least 10.00% — the
  platform fee is 10.00% of the service price and is taken out of the deposit.
  A smaller deposit would leave you owing money on every booking."*
- Seven days of hours saved in one call; `"8am"` refused by the HH:mm matcher.
- Capacity set to 2 and back to 1.
- Demo data left as the walk-through describes it.

### 71.6 Still missing from this app

Payout destination and balance — a business still cannot tell the platform where
to send its money, or see what it is owed. That is the next slice, and it is the
last one before a business can genuinely run on this without help.

Then: profile, staff, review responses, analytics, gallery, schedule exceptions.

---

## 72. A service is offered at chosen branches, at each branch's price (2026-10-01)

**Reverses §10.2.** Services belonged to the business and were shared by every
location at one price. A chain whose city-centre shop charges more than its
suburban one had to invent two services with the same name, and every branch
offered everything whether it did that work or not.

### 72.1 The price moves onto the link

`ServiceLocation(serviceId, locationId, priceMinor)`, unique on the pair.
`Service.priceMinor` is **gone** — a service has no price until it is offered
somewhere, which makes "offered nowhere" an honest, visible state rather than a
bookable service no customer can reach.

The row's **existence** is the offer. No `isActive` on the link, because the
service already has one for "we have stopped doing this at all", and two
overlapping ways to switch something off is how one of them gets forgotten.

Duration and deposit percentage stay on the service: how long the work takes and
what share is paid up front are policies, not prices.

### 72.2 What it touched

- **Booking** — the pairing check was `service.businessId === location.businessId`.
  That stays as the outer guard, and the offer row now decides whether this
  branch sells it. The price snapshotted onto the appointment (§30) comes from
  the offer, so a booking records what that branch charged that day.
- **`fromPriceMinor`** (§44) changes meaning: the cheapest service **at that
  branch**, joined through `service_locations`. Two branches of one chain now
  advertise different headline prices, which is the point.
- **Discovery** — a location lists its own services at its own prices, flattened
  so a client still sees one service object with a price on it. The join is how
  the price is stored, not a shape a customer should have to understand.
- **Admin business detail** — each service now shows where it is offered and for
  how much, which is more of the picture than one number ever was.
- **Offers are replaced wholesale** on update, like the week of opening hours
  (§12.7). Merging would make "stop offering this here" impossible to express.

Branch ownership is asserted on every write: without it an owner could price
their service at a competitor's shop, since the ids are opaque and nothing else
in the write path compares them to the caller (§10.7).

### 72.3 The migration backfills before it drops

Every existing service is linked to every location of its business at the price
it already had — today's behaviour expressed in the new shape. Nothing in flight
changes: the same services are bookable at the same branches for the same money,
and a business narrows the list when it chooses to rather than being made to
re-enter its catalogue.

Only then is `services.priceMinor` dropped. Past appointments are unaffected
because each snapshots `servicePriceMinor` at booking (§30) and never reads the
price back off the service — which is exactly the property §32 was written to
protect, paying for itself in a migration written months later.

### 72.4 Tests that encoded the old rule

Four failed, and all four were asserting §10.2 rather than anything still true:

- *"a new location inherits the existing catalogue"* — it no longer does. A new
  branch offers nothing until told, so `fromPriceMinor` is null. **Null is the
  honest answer**: showing the chain's cheapest price on a branch that cannot
  take a booking for it is a listing advertising a price nobody can book at,
  which is the thing §44 exists to prevent.
- *"fromPriceMinor is shared across two branches"* — rewritten as **not** shared,
  plus a new test that two branches show different prices.
- Two more were fixtures passing a flat price.

New tests pin the new rule in both directions: each branch shows its own
cheapest price, and a service offered at one branch leaves the other alone.

### 72.5 Verified end to end

- Migration backfilled **21 links** across the demo world; no drift.
- The seed now prices a haircut at **7,000 in Nyarugenge and 5,000 in
  Kimironko** — one service, two branches, two prices.
- Public discovery shows those two headline prices.
- The **same service booked at each branch**: Nyarugenge priced 7,000 with a
  1,400 deposit and 700 to the business; Kimironko 5,000 / 1,000 / 500.
- Booking a service at a branch that does not offer it: *"That service is not
  offered at this location."*

**988 passing across 26 suites.**

### 72.6 The business app says it plainly

Price and branch are the same decision now, so the form is one control: a price
box per branch, blank meaning not offered there. A checkbox that then reveals a
field would imply they can be set independently.

A service offered nowhere is labelled **"Offered nowhere"** in red rather than
showing an empty price column, because in the catalogue and bookable by nobody
is a state worth noticing.

---

## 73. Withdrawing a service from one branch (2026-10-01)

§72 made a service offered at chosen branches at each branch's price, but
retiring it was still all-or-nothing. A chain that stops doing beard trims at
one shop had to retire the service everywhere and recreate it — which produces a
second service with the same name and a different id, and detaches the history.

`DELETE /business/services/:id/locations/:locationId` is the branch-scoped
counterpart to `DELETE /business/services/:id`. Two routes, because they are two
decisions: **"not at that shop"** and **"we have stopped doing this at all"**.

### 73.1 ~~Deleting the offer, not flagging it~~ SUPERSEDED by §74

~~The withdrawal deletes the `ServiceLocation` row rather than disabling it, for
the reason §72.1 gave: the service already has `isActive` for retirement, and a
second disabled-but-present state would be a second way to express the same
thing — the arrangement where one of them eventually gets forgotten.~~

**Wrong on both counts.** Deleting discarded the branch's price, so resuming
meant retyping what the work costs — data loss presented as a clean model. And
"paused here" is not the same fact as "retired everywhere", so keeping both is
not two ways of saying one thing. §74 replaces this with a toggle.

History is safe regardless. An appointment snapshots its price at booking (§30),
so a past booking at a branch that no longer offers the service still resolves
to what was actually agreed.

### 73.2 ~~Withdrawing from the last branch retires the service~~ SUPERSEDED by §74

A service that is active but sold nowhere is bookable by nobody while still
claiming to be on offer. Leaving that state reachable from the obvious action
would make `isActive` mean two different things.

So the last withdrawal flips `isActive` too, and the response says which
happened — `retired: true` with a sentence explaining it, rather than leaving a
client to infer it from an empty array. The business app repeats the server's
own sentence instead of composing its own, which would be half right.

The "offered nowhere" state still exists and the UI still labels it: deleting a
LOCATION cascades its offers away, so a service can be orphaned by a branch
closing rather than by this action.

### 73.3 Where the control lives

In the business app the **remove** link sits beside each branch's price, not in
the row's shared actions. Withdrawing is a decision about one shop, and a single
button in a row of actions could only plausibly mean all of them. The row's
shared action is now labelled **"Retire everywhere"** for the same reason.

### 73.4 Verified

Five new tests, and live against the backend:

- Withdrawing Haircut from Nyarugenge left it on sale at Kimironko, and moved
  Nyarugenge's headline price from 7,000 to **8,000** — the next cheapest thing
  that branch sells.
- `retired: false`, with the service unchanged elsewhere.
- Withdrawing the only branch returns `retired: true` and `isActive: false`.
- A branch that was not offering it: *"That service is not offered at that
  branch."*
- Another business's service is refused.

**993 passing across 26 suites.** Demo data restored to 7,000 / 5,000.

---

## 74. Pausing a service at a branch, not deleting it (2026-10-01)

Corrects §73, on the seller's point: withdrawing should be a switch they can
flip back, not a deletion.

### 74.1 Why §73 was wrong

Two reasons, and the first is the one that matters.

**Deleting discarded the price.** A branch pausing a service for a month — a
barber on leave, a machine out of action, a seasonal treatment — had to retype
what the work costs to resume. The model called that clean; it was data loss.

**And the states are genuinely different.** §73.1 argued that a second
off-switch duplicated `Service.isActive`. It does not: that one means *"we have
stopped doing this at all, everywhere"*, and this means *"not here, for now"*.
Conflating them is what cost the price.

`ServiceLocation.isOffered` is the toggle. The row, and its price, survive.

### 74.2 Pausing every branch no longer retires the service

§73.2 auto-retired on the last withdrawal, because deletion made "active but
sold nowhere" awkward to undo. A toggle removes that reason: the state is one
click from recoverable, and auto-retiring would overrule what the seller just
asked for.

So pausing the last branch leaves the service active and sold nowhere, the
response says `offeredAtCount: 0` with a sentence explaining it, and the app
repeats that sentence once rather than composing its own.

### 74.3 Editing a service pauses what it leaves out

`update` used to delete every offer and recreate the listed ones. That would
throw away a branch's price the moment somebody edited a service without
thinking about the branch list.

Listed branches are now upserted and switched on; unlisted ones are switched
**off**, keeping their price. The wholesale-replace semantics §72.2 borrowed
from the week of opening hours were right about intent and wrong about method.

### 74.4 What reads the flag

Everything that decides whether money can change hands: booking refuses a paused
branch, discovery lists only what a branch is selling, and `fromPriceMinor`
(§44) takes its minimum over offers that are actually on sale. The index moved
to `(locationId, isOffered)` to match.

### 74.5 Verified

Eleven tests in `from-price.spec.ts`, including the one this commit exists for —
**the price is kept while paused and restored on resume** — and that editing a
service out of a branch pauses rather than deletes it.

Live against the backend: pausing Haircut at Nyarugenge moved that branch's
headline from 7,000 to 8,000 while Kimironko kept 5,000, and resuming restored
**7,000 with nothing retyped**.

**996 passing across 26 suites.**

---

## 75. Wording, and grouping by what a customer can book (2026-10-01)

§74 was built on a misreading. The objection to §73 was the word **"remove"** on
the per-branch control — it read as permanent deletion — not a request for a
different mechanism. The toggle still stands on its own merits (§74.1), but this
is the change that was actually asked for.

### 75.1 Nothing is called "remove" any more

Every control now says what it does and implies it is reversible:

| Was | Is |
|---|---|
| `remove` beside a branch price | a checkbox, with the branch shown struck through and *(paused)* when off |
| "Retire everywhere" | "Stop offering everywhere" |
| "Retired" section | "Not on sale" |
| — | "Put back on sale" |

The confirmation no longer says a service "disappears"; it says where it goes,
that its prices are kept, and that it can be put back.

### 75.2 Grouped by whether it can be booked, not by a flag

The sections split on `isActive`, so a service switched off at every branch sat
among the live ones under a red warning. In the catalogue and bookable by nobody
is **the same position** as retired, whichever flag expresses it — so both now
appear under "Not on sale", where the way back is in front of you.

That also fixes the recovery path §74.2 left awkward. A service paused
everywhere is no longer stranded in the live table: it is listed with its branch
switches, and ticking one brings it back.

The red "Not on sale anywhere" became a muted "Switched off at every branch" for
the same reason — it is a choice, not a fault, and colouring it as an error says
somebody made a mistake.

### 75.3 The lesson

The request was one word. The response was a schema change, a migration and
eleven tests before anyone checked which word. §74's toggle is better than §73's
deletion and the work stands, but it was arrived at by building rather than by
asking — and a question would have cost one message.


---

## 76. "Everywhere" acts on the branches (2026-10-01)

Spotted on screen: a service sitting under **Not on sale** whose every branch
line offered to *"Stop offering here"* — stopping something already stopped.

### 76.1 Two flags that could disagree

`Service.isActive` and `ServiceLocation.isOffered` were independent, and "Stop
offering everywhere" flipped only the first. So a service could be off sale
while every branch still reported itself on, and the screen faithfully rendered
the contradiction.

**"Everywhere" now means every branch.** It sets `isOffered` on all of them and
does not touch `isActive` — one transaction and one price recalculation, rather
than the client looping, because a half-applied bulk change is exactly the state
this exists to prevent.

`isActive` keeps its original meaning, a soft delete that preserves history
(§10.5), and the business app no longer sets it. The screen still handles a
service retired that way, since one can exist from before this change or from
the API.

### 76.2 The screen reads the effective state

A branch line asks whether a customer could book **here, now** — which means
`isActive && isOffered`, not the branch flag alone. A retired service's branches
show "service stopped" rather than a button to stop them again.

The two ways back undo two different things, so they are two actions: a service
switched off everywhere is put back by turning its branches on at the prices it
had; one retired through the API has its flag cleared.

### 76.3 Verified

Five new tests, including the one this exists for — **after turning a service
off everywhere, no branch claims to be on sale** — plus prices surviving the
round trip and headline prices clearing and returning.

Live: stopping Haircut everywhere left `isActive: true`, both branches off, and
putting it back restored **Kimironko 5,000 and Nyarugenge 7,000** untouched.

**1001 passing across 26 suites.**

---

## 77. Business app: getting paid (2026-10-01)

The last slice before a business can run on this without help. It can now say
where its money goes and see what it is owed.

### 77.1 One screen, because it is one question

The destination and the balance share a page. An owner's question is "when do I
get my money", and the answer depends on both halves: an unverified number
pauses every payout (§48.3), so a balance shown beside no destination status
answers half the question and misleads about the other half.

### 77.2 The balance lied about being paused — a real bug this screen found

`payoutsPaused` reported **only** business suspension. A business whose payout
number was waiting to be checked was told payouts were fine, while every run
skipped it for exactly that reason.

A balance screen that says nothing is wrong about money that is not moving is
worse than one that says nothing at all. It now reports both reasons, with
`payoutsPausedReason` naming which — suspension outranks an unverified number,
because it is the larger problem and the one the business must fix first.

The `note` matches, and both say the same reassuring thing: **nothing is written
off**. The balance is held and goes out on the first run after the problem is
resolved.

### 77.3 Four figures, not one

"Ready to send", "still held", "not yours yet" and "paid so far". A single
balance would have to pick one meaning and would be wrong for the others: money
inside the payout hold is earned but not payable, and money against an
unresolved appointment is not earned at all.

Under them, one line that prevents the most likely misreading: **these are
deposits only**. The rest of each appointment is settled with the customer
directly and never passes through the platform (§29.2) — so a business
reconciling this against its till would otherwise find a gap and assume a fault.

### 77.4 Changing the number pauses payouts, and says so

Submitting supersedes the current number and starts again as UNVERIFIED (§48.2).
The form says that before you submit rather than after.

That is deliberate on both sides: a business that has lost control of its SIM
must be able to change the number immediately, and the pause is what stops the
money following whoever took it. Only the OWNER may submit — it is the one
decision that determines where money physically goes.

### 77.5 Verified end to end

- The three endpoints the screen calls: 200 each.
- A number with no `+`: refused by the E.164 matcher. A `+211` number: *"msisdn
  must be a +250 number."* (Its error example still said `+211921234567` in a
  Rwandan deployment — fixed.)
- Submitting `+250788999001` superseded the old one, and the balance flipped to
  `payoutsPaused: true` with reason `DESTINATION_NOT_VERIFIED`.
- An admin verified it in the console, and the balance went back to not paused.

**1004 passing across 26 suites.**

---

## 78. A superseded payout number says what replaced it (2026-10-01)

Reported from the console: Kigali Barbers appeared with two different statuses
and the page gave no way to tell they were two different numbers, one current
and one historical.

They were. §48.2 makes payout destinations append-only — changing a number
writes a new row and marks the old `SUPERSEDED`, because money went to the old
one and editing in place would quietly rewrite where a past transfer went.

But a superseded row that does not say what came next makes the reader infer the
successor from timestamps. That page is read during a **payment dispute**, which
is when guessing is least affordable.

### 78.1 Resolved on the server

Each `SUPERSEDED` row now carries `replacedBy` — the next submission for that
business, with its number, status and date.

Server-side rather than in the client, because a status filter means the
successor is almost never on the same page. Computing it in the browser would
work on the "All" tab and silently return nothing on the "Superseded" one, which
is the tab where it matters.

"The next one" is unambiguous: submissions are strictly ordered, so a chain of
three changes gives each row its own immediate successor rather than all of them
pointing at the latest.

### 78.2 Verified

Three tests, including a chain of three numbers where each superseded row points
at the one that directly followed it. Live: Kigali Barbers' `+250788100001` now
reads *"Replaced by +250788999001"*.

**1007 passing across 26 suites.**

## 79. Someone can answer a support ticket (admin console)

The ticket backend has existed since §24 — statuses, a transition table,
internal notes, reopen windows, notification emails. None of it was reachable.
A customer raising a ticket got an acknowledgement and then silence, because no
screen existed on which to reply. That made every other admin feature the more
finished-looking half of the console.

`/tickets` ("Support" in the nav) is a list with status tabs and a drawer per
ticket.

### 79.1 The buttons are the transition table, minus one

`TICKET_TRANSITIONS` (§24.3) is the authority; the page mirrors only which
buttons to draw, because a button for a move the server will refuse is worse
than no button. So: OPEN offers "Start handling", IN_PROGRESS offers "Mark
resolved", RESOLVED offers "Close".

**Reopening has no button on purpose.** Only the reporter may reopen — an admin
reopening their own resolution would defeat the point of the reopen window. A
RESOLVED ticket says so in words instead: *"Only the reporter can reopen this,
and only for a while."* Verified: an admin PATCH to IN_PROGRESS returns 403,
*"RESOLVED to IN_PROGRESS is not a transition you can make."*

### 79.2 Resolving asks what the outcome was

The server requires `resolutionNote` on RESOLVED, so the page prompts for it
rather than letting a 400 explain the rule. The prompt says what the note is
for — the reporter is sent it, and it is the record a reopen argues against —
because "Reason:" would collect "fixed".

### 79.3 Internal notes are marked, not merely excluded

One textarea posts either a public reply or an internal note, by checkbox:
*"Internal note — the reporter never sees this."* In the thread, internal notes
are flagged and tinted. Two reasons to show them differently rather than just
filter them out of the reporter's view: whoever picks the ticket up next needs
the context, and an admin about to type something blunt should be able to see
at a glance which box they are typing into.

Confirmed end to end, not assumed: an internal note posted as admin appears in
`GET /admin/tickets/{id}` flagged, and is **absent** from the reporter's
`GET /tickets/{id}`.

### 79.4 What the list surfaces without opening anything

Reference, subject, category, who reported it, last activity, status — plus two
flags that change whether you open it: **unassigned**, and **reopened ×n**. A
reopen count above zero is a resolution that did not hold, which is the single
most useful thing to see from outside.

### 79.5 Verified against the live backend

Every call the page makes, run against the running server: list (filtered and
unfiltered), detail with its message thread, assign, public reply, internal
note, OPEN→IN_PROGRESS, IN_PROGRESS→RESOLVED with a note, RESOLVED→CLOSED, and
the two refusals above. TKT-000005 was raised as a customer through the real
endpoint to test assignment from unassigned.

Worth recording about the method: my first attempt read a six-digit *ticket
reference* out of a notification email and used it as a login code. The OTP
harness now filters by subject and requires the mail to postdate the request.
A test fixture that picks the wrong six digits fails in a way that looks like
a broken endpoint.

## 80. A business can raise a ticket, and an X that means "close the panel"

§79 gave admins somewhere to answer tickets. Only customers could raise one, so
the console answered half the people who need it. A business with a missing
payout had no route to us at all.

### 80.1 The X

The ticket drawer's dismiss control read "Close", directly above a status button
also reading "Close" that ends the ticket for everyone. Two very different acts,
one word, fourteen pixels apart.

The dismiss control is now an X with `aria-label="Close this panel"`. The word
"Close" is left to mean the status transition, which is the one that is hard to
undo.

### 80.2 `/help`, not "Support"

In the admin console the section is **Support** — the queue you work. In the
business app it is **Help** — the thing you ask for. Same tickets, opposite
sides, and naming both after the admin's word would describe the business's own
problem from our side of the desk.

The statuses are relabelled for the same reason. `OPEN` reads to a business like
something *they* must act on, when it means the opposite, so it reads **"Waiting
for us"**. `IN_PROGRESS` → "Being looked at". Each carries a sentence saying what
it means for them. The categories get their words too: `PAYMENT_ISSUE` is
**"Getting paid"**, matching the nav item where they noticed the problem.

### 80.3 Reopen is here, because this is the side that may

§79.1 left reopening out of the admin console deliberately — only the reporter
may. This is the reporter, so the button exists, worded **"This is not fixed"**
rather than "Reopen", which is the thought they actually have.

Past the window the button is replaced by the reason it is gone. The client
checks the window only to decide what to show; the server enforces it.

### 80.4 Attachments: the shape was not what I assumed

I typed `attachmentUrl?: string` on a message. The live API disagreed, and an
optional field that is never populated renders nothing and reports no error —
it would have looked like a backend that drops screenshots.

What it actually does: a file sent **when the ticket is raised** hangs off the
*ticket* (`ticket.attachments`); a file sent with a **reply** hangs off that
*message*. Both are `{id, url, mimeType, sizeBytes}` arrays. Both are now
rendered, in both apps — the ticket-level one against the opening message, where
a reader expects to find it.

This also closed a gap in §79: the admin drawer showed no attachments at all, so
a screenshot could be sent and never seen by the person answering.

### 80.5 FormData through the shared client

`api()` JSON-stringified every body. It now passes `FormData` through untouched
and omits `Content-Type`, because the browser has to set it itself for the
multipart boundary to match the body it writes. Setting that header by hand
produces a boundary-less request the server cannot parse.

Limits are the gallery's, unchanged: JPG/PNG/WebP, 15MB (§10.6).

### 80.6 Verified end to end against the running server

A business raised TKT-000006 as multipart with a real PNG; `reporterType` came
back `BUSINESS`, derived from the token rather than the payload. Then: admin saw
it, assigned, replied publicly and left an internal note, resolved it with a
note; the business read the thread, saw the public reply and **not** the
internal note, and reopened it — `reopenCount` 1.

Refusals confirmed, not assumed: reopening a non-RESOLVED ticket gives
*"Only a RESOLVED ticket can be reopened. This one is IN_PROGRESS."*, and a
business reading a customer's ticket gets **404, not 403**, as §12 requires.

Ticket pill classes are namespaced `tkt-*`. The business app already had
`.pill.in-progress` for appointments; reusing it would have had two unrelated
meanings share a colour, and whichever page was styled second would win.

