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

- ~~Medical / dental~~ **Superseded by §266 (2026-10-10): clinics, dentists,
  eye care and tests by appointment are in, as "Health & Medical" — an
  administrator can switch it off.**
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

(§277 adds *where*: a manager or staff member may be given some branches, and
then sees and acts on only those; whole-business changes need every branch.)

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
| POST | `/appointments/:id/cancel` | the customer, or ~~any active business member~~ the owner or a manager of its branch (§277) |
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
- **Bookings go to every active member ~~, not just the owner~~ who looks after
  that booking's branch (§277), not just the owner.** Staff run the
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
- ~~**No per-user preferences or quiet hours.**~~ Built in §287. Deliberately skipped: there is no
  frontend or admin portal to reach such settings, so they would be API-only
  and untestable by a real user.
- ~~**Every active member gets every booking notification.**~~ Narrowed by branch (§277); each chooses how (§287). Fine at one or two
  staff; a busy salon will want this narrowed, which is the same feature as
  preferences above.
- ~~**No digest or batching.**~~ A seller's bookings can come as one morning summary (§287). Ten bookings send ten emails.
- **The reminder lead time is a constant**, not per-business configurable.
- ~~**No notification for `COMPLETED`**~~ — now "How was it?", completed by hand or by the §16.8 sweep (§287). Still none for the sweep's automatic no-show —
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
delivery path. Business-side messages go to ~~every active member~~ every active
member who looks after the conversation's branch (§277), for the same reason
bookings do (§20.4): whoever is on the floor should see it.

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
business — an admin any, a business user only one they are an ACTIVE member of
(§277: ~~any member~~ the owner and managers only, and a manager of some
branches sees only theirs).
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

> ~~"There is no profile endpoint … and none was invented for this."~~
> **Superseded by §144:** the name can now also be set, or cleared to Anonymous,
> from the account. Setting it through a review still works exactly as below.

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
owner may redirect where the money goes. ~~Any ACTIVE member~~ The owner, and a
manager of every branch (§277), may **read** the
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

- ~~The code input sits **in the row**, not behind a dialog. Verifying is the
  single most frequent action in the app and it should cost one keystroke
  sequence, not a click-then-type.~~ *Superseded by §191/§193: the row's
  Check in opens the check-in window with the customer chosen and the six
  boxes focused, and the sixth digit checks them in — one click and six
  keystrokes, where the row's box was a click, six keystrokes and a Verify.*
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

## 81. A ticket attachment is evidence, not a shop-window photo

Reported from use: *"I am not able to add files, images, etc."* The picker
opened, a file could be chosen, and nothing arrived.

§80.5 wired the upload correctly — multipart passes through the dev proxy and
reaches the interceptor. The failure was one layer further in: ticket uploads
reused `galleryUploadOptions`, which accepts **jpg, png and webp only**. A PDF
bank statement and an iPhone photo (HEIC) are the two most obvious things to
attach to a missing-payout ticket, and both were refused.

### 81.1 ~~§10.6: tickets share the gallery's upload options~~ — superseded

The original reasoning: *"someone refused a 20MB screenshot on a gallery should
get the identical refusal attaching it to a ticket, and separate configs drift
the moment one limit changes."*

That holds for the **size** limit and not for the **type** list, and conflating
the two cost the feature. A gallery is a shop window: every item is rendered to
customers, so a format a browser cannot display is not a stricter rule, it is a
broken listing. A ticket attachment is evidence, opened by one person reading
one ticket. Nothing renders it in a grid.

So the lists diverge and the **ceiling does not**: 15MB still comes from one
constant, `MAX_UPLOAD_BYTES`, and a test asserts all three configs share it.

Tickets now also take GIF, HEIC/HEIF, PDF, Word, Excel, CSV and plain text.
The gallery and chat are unchanged — only tickets were widened.

### 81.2 One filter, two lists

The filter itself was still worth sharing, so `makeUploadOptions(allowed, label)`
builds both. Only the set of types differs, which is the only thing that
legitimately differs. The refusal still names what IS accepted:
*"Unsupported file type "application/x-msdownload". Allowed types: images
(incl. HEIC), PDF, Word, Excel, CSV and text files."*

### 81.3 The picker judges on type OR extension

Browsers report an empty or non-standard MIME type for HEIC and for some Office
files depending on the OS. A client-side check on `file.type` alone therefore
rejects files the server would accept — the same class of bug, moved to the
browser. The client matches on either, and the server remains the authority.

### 81.4 The control now says what it took

Contributing to "it doesn't attach": the old field was a bare `<input
type="file">` inside a `<label>` that wrapped it, with no confirmation. A label
wrapping a file input re-dispatches the click to its control, which can open
the picker twice and makes a selection look ignored.

The input is now referenced by `htmlFor` and never wrapped, and the chosen
filename is shown with a **remove** control. Size and type are checked before
sending, so a file that would be refused is refused immediately rather than
after a 15MB upload.

### 81.5 Links say what they open

The original filename is deliberately not kept — storage names every object with
a UUID so a crafted upload name cannot steer the object key (§10.4). With images
only, "View attachment" was adequate. Now that it may be a spreadsheet, both
apps derive a label from the stored MIME type: *View PDF*, *View spreadsheet*,
*View image*.

This also fixed the admin side, which §79 shipped showing no attachments at all
— a business could send a statement and the person answering never saw it.

### 81.6 Verified

Each type uploaded against the running server and fetched back: pdf, heic, csv,
txt, docx, xlsx, png all store with the correct extension and serve with the
correct `Content-Type`. `.exe` is refused with 400. The gallery still refuses a
PDF and still accepts a PNG.

30 new tests in `upload-allow-lists.spec.ts`, written around the divergence
rather than either list on its own: a PDF must be accepted on a ticket **and**
refused on a gallery. One shared object passed both halves of that trivially,
which is why the bug survived until someone tried to attach a statement.

**1037 passing across 27 suites.**

## 82. "Waiting for support", because "us" is whoever is reading

Asked from use: *"what does 'waiting for us' mean"*. That question is the whole
finding — a status label nobody can read without asking has failed.

### 82.1 ~~§80.2: OPEN reads "Waiting for us"~~ — superseded

§80.2 relabelled the statuses for the asking side, reasoning that `OPEN` sounds
like a task on the business's desk when it means the opposite. That was right
about the problem and wrong about the fix: on a screen a business is reading
about their own ticket, **"us" is most naturally them**. The label swapped one
ambiguity for another.

`OPEN` now reads **"Waiting for support"**. "Support" cannot be read as the
business's own team, and it stays accurate once a business has staff with their
own logins — at which point "us" would have been wrong in a second way.

### 82.2 The explanation belongs next to the label

The clarifying sentence existed, and only inside the opened ticket. The list —
the screen where the question was actually asked — showed a bare pill.

Each row now carries a short line under its status: *"Nobody has picked it up
yet"*, *"Someone is on it"*, *"You can reopen it for 14 days"*. Two strings per
status rather than one, because a table row and an open ticket have different
amounts of room, and the previous single string fit neither place well enough
to be read.

The admin console keeps the raw status names. Those are the enum, read by people
who work the queue daily, and renaming them there would only put a translation
layer between an admin and the transition table.

## 83. Several files, listed before they are sent

Reported from use: *"after choosing another image or file, it seems like it
replaces the previous one"*, and that **"attach a screenshot"** was the wrong
words now that a ticket takes PDFs and spreadsheets.

Both were right. The second was my wording left over from §80, when a
screenshot was all it took.

### 83.1 The replacement was real, and was in the client

`TicketAttachment` has always been a one-to-many on ticket and message, and
`StorageService.upload` never cared how many times it was called. The ceiling
was `FileInterceptor` with `limits.files: 1`, and above that a client holding a
single `File` in state. A fresh `<input type="file">` reports only its own
latest selection, so picking a second file genuinely discarded the first.

State is now a list and each selection is appended. `FilesInterceptor(
'attachments', MAX_TICKET_ATTACHMENTS, …)` collects them, and `attach()` loops.

**Five per message.** Each is still capped at 15MB separately, so five is also
the multiplier on the worst-case request. The gallery and chat stay at one: a
gallery photo replaces a slot, it is not a bundle of evidence.

### 83.2 Sequential uploads, on purpose

`attach()` awaits each file rather than `Promise.all`. The rows are read back in
insert order, so uploading in parallel would list a reporter's files in whatever
order the storage driver happened to finish them — and the order someone
attaches evidence in is usually the order they want it read. Five files is not
a load worth racing.

### 83.3 The list is the feature

Chosen files are shown before sending, each with its size and its own
**remove**. Three things only become possible once the list is visible:

- **Duplicates are refused by name and size.** The same file twice is the
  picker being reopened, not a second attachment.
- **The input is cleared after every selection.** Without it, removing a file
  and choosing it again fires no `change` event, and the control silently does
  nothing — the original complaint, in a new place.
- **Every refusal names its file.** Rejections are a list, not one message, so
  "three added, this one was too big" is sayable.

### 83.4 Wording

"Attach a screenshot" → **"Attach a file"**, then "Add another file". The field
heading is now *"Anything that shows the problem"*, which is what the field is
for and does not promise a format.

### 83.5 The error filter had to become per-endpoint

`MulterExceptionFilter` hardcoded *"the maximum **photo** size"* and *"Upload
exactly one file, under the field name `file`"*. Both were wrong for tickets
the moment this landed, and it was not catching the count error at all —
`platform-express` maps LIMIT_FILE_COUNT to a plain `BadRequestException`
reading "Too many files", which the filter did not catch.

It now takes its limits per endpoint, so a ticket is told "Up to 5 … under the
field name `attachments`" and the gallery still says "exactly one photo".

Two traps, both found by running it:

- **It must catch `BadRequestException` narrowly.** Class-validator throws the
  same type from the same routes. Anything that is not one of multer's own
  sentences is re-emitted byte for byte — otherwise a list of field errors
  becomes one sentence about uploads. A test asserts a validation error
  survives untouched.
- **Match multer's sentences by prefix.** It appends the field to some of them
  ("Unexpected field - attachment"), so equality missed the case and left the
  raw message in place.

Nest also DI-instantiates a filter passed to `@UseFilters` as a *class*, and
reads a defaulted constructor argument as a dependency it must resolve — the
app refused to boot until every call site passed an instance.

### 83.6 Verified

Against the running server: a ticket raised with three files at once, a reply
carrying two more, all read back **in submission order** with the right
extensions; six refused naming the cap; exactly five accepted; one bad file
among good ones refused for the whole request; a JSON reply with no files still
accepted; the gallery still refusing a second file as a photo.

**1043 passing across 27 suites.**

## 84. Money: the ledger, and the one button that changes a balance

`BillingAdjustment` has been writable since §25 and executable since §36. A
ticket resolution could attach one (§24), and `PATCH
/admin/billing-adjustments/:id/execute` would turn it into ledger entries. No
screen showed any of it. An admin could record a decision about money and then
had no way to see it, let alone act on it — the adjustment sat in a table
nobody could read.

`/ledger` ("Money" in the nav) is three things on one page: what is held, the
adjustments waiting to be executed, and the entries behind both.

### 84.1 Held first, because it is the number you came for

The reconciliation figure sits above both tabs, with its `asOf` and the warning
that **nothing reconciles it automatically** — it is compared against the
provider's balance by hand (§36.7). `entriesWithoutSettlement` is surfaced in
amber when non-zero, because those entries are *missing from the figure* and a
total that quietly excludes rows is worse than one that admits it.

### 84.2 ~~§56.4: the admin app prints "RWF 8302 minor" and never divides~~ — superseded

The old reasoning: a currency's decimal places are a property of the currency,
this app does not carry that table, and inventing a decimal point is the class
of mistake §55 and §56 exist to prevent.

The premise stopped being true in §70.1, which added `GET /payments/currency`
reporting the exponent. Reading it is not the mistake; **assuming two decimals
is**, and a shared `useMoney()` never assumes — it prints the raw integer until
the exponent arrives, which is ugly and never wrong.

`PayoutsPage` was migrated with it. Five call sites, one file, and the
alternative was two money conventions inside one console — the reader would
have had to know which page they were on to know what a number meant. The
helper mirrors business-web's deliberately, so the two consoles cannot disagree.

### 84.3 Signs are carried, not implied

Ledger entries are signed from the **business's** point of view (§34.2):
positive is owed to them, negative is owed back. The helper has a `signed()`
that always prints the sign, and negatives are coloured. A minus swallowed by a
column boundary is the one formatting bug on this page that would actually cost
money.

### 84.4 Executing says what it cannot undo

The Execute button is the only act on this screen that changes a balance, and
it does so by **appending** — the database forbids editing an entry (§34.2). So
the confirmation says exactly that: *"It cannot be undone — a mistake is
corrected by recording another adjustment, not by reversing this one."*

`settlementRef` is genuinely optional (§25.2): some adjustments settle by
netting against a future payout, and inventing a reference would make a
reconciliation look complete when it is not. The prompt says which case is
which, and blank is accepted while a one-character reference is not. An executed
row shows its reference, or *"netted against a payout"* where there is none.

### 84.5 Two shapes that do not match, left unmatched

`BillingAdjustment.amount` is a **decimal string in major units** ("2.5").
Every other figure on the page is a **minor-unit integer**. They are printed as
they are, rather than converting the adjustment into minor units to make the
columns look alike: 2.5 RWF becomes 3 minor by ROUND_HALF_UP, so a converted
column would show "3" beside a ledger entry of 3 and hide that a rounding
happened. The executed row names how many entries it wrote instead.

### 84.6 Verified against the running server

Every call the page makes, including the limit: `/admin/businesses?limit=200`
is a **400** — the cap is 100 — which would have blanked every business name on
the page. Found by running it, not by reading the DTO afterwards.

The whole chain, end to end: a customer raised TKT-000011 against a real
cancelled appointment, an admin resolved it with a `FEE_REFUND` of 2.5, which
appeared as **outstanding**; executing it with reference `MOMO-REF-55012` moved
held from **RWF 8302 across 28 entries to RWF 8305 across 29**, appended one
`ADJUSTMENT` entry payable immediately, and a second execute returned **409
"This adjustment has already been executed. Record a new adjustment instead."**

Also corrected: `execute` returns `{adjustment, entry}`, not a bare adjustment.
The page does not read the response, so nothing broke — but the type would have
told the next reader that nothing was written to the ledger.

**1043 passing across 27 suites.**

## 85. ~~The Money screen says it in words anyone can read~~ — reversed

**Reversed the same day, at the user's request: "revert this renaming you just
did, i don't like it."** The code is back to what §84 shipped. Kept here because
a reversed decision is still a decision, and the next person to have this idea
should find the outcome rather than the idea.

### 85.1 What was tried

After asking for an explanation in plain English, the user agreed to the screen
being simplified too. So the Money page was reworded: entry types named who
gained or lost what (*Deposit received → Customer paid*, *Platform fee → Our
fee*, *Manual adjustment → A fix done by hand*), **Adjustments → Fixes**,
**Ledger → Money records**, **Execute → Apply this fix**, **held → waiting**,
**available → ready to send**, **outstanding → still to do**. `PayoutsPage` was
dragged along for consistency (*Unsettled → Not sent yet*).

### 85.2 Why it was wrong anyway

The request was *"explain to me ... in very simple primary school english"*.
That was about **explaining**, in chat. I offered to rewrite the screen as
well, the user said yes to the offer, and the result was not what they wanted.

The mistake was mine before the offer was made: wanting a thing explained
simply is not the same as wanting it renamed. An admin console is used daily by
people who come to know its words; "Deposit received" is what the money *is*,
and "Customer paid" is a sentence about one moment that stops being accurate as
soon as the deposit is refunded. Plain explanation makes a term learnable.
Replacing the term leaves nothing to learn, and nothing that matches the API,
the database, or this file.

The standing preference is kept, and narrowed: **plain words when I explain,
the domain's words on screen.**

## 86. A legend, because a label cannot say who

Asked while reading the ledger: *"'Platform fee returned', returned to who?"*

A fair question the label cannot answer. It names the money and leaves out both
parties — who hands it back, and who ends up with it. The answer is that **the
platform** returns it and **the customer** receives it, and neither word is in
the label.

### 86.1 The answer, for the record

When a business cancels, the customer is refunded in full **including the fee
taken at booking** (§25.1). `PLATFORM_FEE_REVERSAL` is positive on the
*business's* row because it cancels the `PLATFORM_FEE` taken when the deposit
landed — otherwise the business would be funding our fee on a booking that
earned it nothing. The cash goes to the customer; the entry keeps the business
whole.

Remera Nails, one booking, as it stands in the demo data:

| Line | Amount |
|---|---|
| Deposit received | +1,200 |
| Platform fee | −600 |
| Deposit refunded | −1,200 |
| Platform fee returned | +600 |
| Gateway fee | −500 |
| | **−500** |

The business ends at exactly the gateway's charge, which §25.1 says it bears.
The first four net to zero, which is what "refunded in full" means in ledger
terms.

### 86.2 A legend, not longer labels

§85 renamed these and was reversed. So the labels stay exactly as they are —
they match the enum, the API and this file — and a short **"What these lines
mean"** list sits under the table, one sentence per type, saying who gained or
lost what. It leads with the rule that makes every sign readable: amounts are
written from the *business's* point of view.

This is the shape the §85 attempt should have taken. A term that is explained
beside the table stays learnable and stays matched to the system underneath;
a term replaced by a sentence is neither.

## 87. Asking MTN what it is holding

§34.1's held figure exists "to be compared against the provider's statement",
and §36.7 says that comparison is made by hand. Nothing ever asked the operator
for its side of it, so the comparison was a hand-written instruction on a screen
and nothing more.

Asked directly: *"is it possible to see the amount the platform is holding in
the momo sandbox mtn platform now?"* It was — by curl, with nothing in the
codebase to do it.

### 87.1 A separate interface, because the ability is separate

`DisbursementProvider` says it is "deliberately narrow ... balance enquiry,
reversals and statements are separate problems and would each need their own
thinking." That still holds, so `BalanceReporting` is its own interface rather
than two more methods. The reason is concrete: an operator that can send money
may be unable to report a balance, and MTN's sandbox is exactly that.

`MomoBalanceProvider` is the one class that legitimately needs **both** products'
credentials. §64.2 refused to merge collections and disbursements because one
object holding two credential sets fails as "subscription not found", which
reads like broken code rather than a crossed wire. The defence moves rather than
disappearing: a credential set is one object, passed whole, and no call site
ever picks a key and a user separately.

### 87.2 The sandbox is not a smaller production — it is a prop

Measured, not assumed. Within a few minutes the sandbox returned:

- collection `EUR 1000`, then `EUR 0`, then **`EUR -25`**
- disbursement `EUR 1000`, then `500 NOT_ALLOWED_TARGET_ENVIRONMENT`, then
  `404 RESOURCE_NOT_FOUND`, then `500 NOT_ALLOWED`
- each wallet failing independently, and the pair swapping which one worked

A negative collection balance is not a number any real wallet would report. So
the figures are props, and transfers do not move them — the two real
disbursements of §64 left the figure untouched.

### 87.3 Refusing to subtract is the feature

`comparable` is false, and `difference` null, whenever a difference would be a
lie:

| Reason | Why |
|---|---|
| `SANDBOX` | Props, whatever they say |
| `DIFFERENT_CURRENCY` | Sandbox reports EUR; this deployment settles RWF |
| `BALANCE_UNAVAILABLE` | No answer is not a balance of zero |
| `NOTHING_HELD` | Nothing to compare |

**Sandbox is checked before currency, on purpose.** A sandbox that happened to
report RWF would otherwise produce an arithmetically valid, entirely meaningless
difference. A test asserts the hardest version of this: figures that agree
*exactly*, in sandbox, still refuse to compare — agreeing by coincidence is the
most dangerous case, because it is the one nobody questions.

Only the **collection** wallet is compared. It holds customers' deposits, which
is what the ledger is a claim about. The disbursement wallet answers a different
question — can we afford the next run — and is shown beside it, never subtracted.

Both wallets are reported even when nothing can be compared. Seeing MTN's number
is useful on its own; the screen just never pretends it reconciles.

### 87.4 What this is worth

In sandbox: almost nothing, honestly stated. In production, where MTN reports
both wallets in RWF, the difference is what catches a payment that landed and
was never recorded — the failure nobody notices until month end. The work is
done now so that switching credentials is the whole of the change.

### 87.5 Verified

Ten tests on the comparison logic, weighted towards the refusals. Live against
MTN's sandbox repeatedly, which is how §87.2 is a measurement rather than a
guess. An earlier version of the error text fell through to an empty string and
produced *"The operator answered 500. "* with nothing after it; every branch now
returns a sentence, and an unrecognised code is named rather than swallowed.

**1053 passing across 28 suites.**

## 88. A business can fill in its own shopfront

Chosen as the next build after a survey of what the backend offers against what
any screen reaches. The gap that mattered: a business that signs up today gets a
listing with **no description and no photo, and no way to add either**. The seed
filled those in for the demo businesses, which is exactly why it went unnoticed.

Everything downstream — services, hours, payouts — sits behind a shopfront a
customer would not click.

### 88.1 The logo was never uploadable

`UpdateBusinessProfileDto` has accepted `logoUrl` and `coverImageUrl` as plain
strings since the beginning. That quietly assumed the business already had the
image hosted somewhere. They do not — not having anywhere to put their business
online is the reason they are here.

`POST /business/profile/image/:kind` takes the bytes, the same way a gallery
photo does. One route with the kind in the path rather than two near-identical
ones; they differ only in which column is written.

It uses **`galleryUploadOptions`**, not the wider ticket list from §81. These
are shop-window images: a format a browser cannot render is a broken listing,
which is the exact distinction §81 drew when it widened tickets and left the
gallery alone.

### 88.2 The old image is removed after the row is written, never before

A failed write must not leave a profile pointing at a file that is gone. The
delete is also not awaited into the response path — an orphaned object is a
cleanup problem, a failed request is the user's. A test asserts a storage
failure leaves `logoUrl` null rather than half-set.

### 88.3 Changing category clears the subcategory

The server validates that a subcategory belongs to its category, and refuses the
pair with *"That subcategory does not belong to the selected category."* The form
clears the subcategory whenever the category changes, so the refusable pair is
never assembled.

Verified by assembling it deliberately: Automotive + Barbershop is refused.

### 88.4 Galleries stay per branch

One gallery section per location, not one per business, because
`MAX_GALLERY_PHOTOS_PER_LOCATION` is per location for a reason (§10.6): a
customer wants to see the place they are actually walking into. The screen says
so, and shows each branch's count against its limit.

### 88.5 Verified

Live: logo and cover uploaded and recorded; replacing a logo removed the
previous file from disk and left the new one; `banner` refused as a kind; a PDF
refused as *"Allowed types: jpg, jpeg, png, webp"*; two gallery photos added,
listed with their display order, one deleted; the profile patched with a
matching category pair and refused with a mismatched one.

Incidentally fixed in the demo data: **Kigali Barbers was seeded as "Automotive
/ Car Repair & Mechanic"**. It is now Beauty & Personal Care / Barbershop,
corrected through the screen being built — which is the sort of thing only
visible once somebody can see their own listing.

Seven tests on the service, including the one that matters: storage failing
leaves no URL behind.

**1060 passing across 29 suites.**

## 89. A branch is closed, never erased

Item 1 of the wiring plan — "two routes, no backend work" — turned out to be a
data-loss bug with a UI gap in front of it.

### 89.1 What `DELETE /business/locations/:id` actually did

It hard-deleted the row, and the comment above it said:

> Hard delete, unlike services. A location has no historical appointment
> references to preserve yet ... **Revisit when appointments start pointing at
> a locationId.**

They do, and had for a long time. `Appointment.locationId` was `onDelete:
Cascade`, so deleting a branch deleted **every appointment ever made there** —
completed and paid ones included. From those appointments, `Review` and the chat
`Thread` cascaded away too. `LedgerEntry.appointmentId` is `SetNull`, so the
money rows survived with nothing left to explain them: a balance whose history
had been removed, which is precisely what §34.2's append-only ledger exists to
prevent.

Nothing had called it, because no screen existed. Wiring the button would have
shipped the bug.

### 89.2 Closed, like a service is retired

`Location.isActive`, matching `Service.isActive`, and the same shape the user
asked for in §73: *"should not be deleting but something that toggles on and
off"*. A closed branch stops taking bookings and disappears from customer
search; everything that happened there stays readable, and it can be reopened.

`Appointment.locationId` is now `onDelete: Restrict`. Soft deletion means
nothing calls a hard delete — Restrict makes it **impossible rather than merely
unused**, which is the same reasoning the adjacent `serviceId` relation already
carried.

### 89.3 Closing refuses while bookings are still to happen

A branch with `BOOKED` or `IN_PROGRESS` appointments cannot be closed:

> This branch has 3 bookings still to happen. Cancel or complete them first,
> then close it.

Those are real people with a time reserved. Cancelling them is a decision with
refunds attached (§25), and it is not one a "close branch" button should make
silently.

### 89.4 Three places had to stop offering it

Closing is only real if the branch actually stops selling:

- **Discovery** — filtered in `buildWhere`, so the count and the page agree, the
  same reason `maxPriceMinor` moved into the query. `findOne` became `findFirst`
  and 404s.
- **Availability** — 404 for the public; **members still see it**, on the same
  reasoning as the status gate beside it: an owner reopening a branch needs to
  check its hours still produce sensible slots first.
- **Booking** — refuses with 404, not a message. To a customer, a branch that is
  not open does not exist.

The business's own list still shows closed branches, greyed, with a reopen
button. It is the one place they must remain visible.

### 89.5 A test that relied on the destructive cascade

`business-approval.spec.ts` cleared state with
`businessProfile.deleteMany({})`, which worked only because locations and then
appointments cascaded away beneath it. Restrict broke it — correctly. It now
clears appointments first.

Switching it to `resetDatabase` was the wrong fix and failed differently: that
helper truncates `users` too, removing the admin created in `beforeAll`.

### 89.6 Verified

Live: a branch edited; closing refused on a branch with a booking, naming the
count; a branch with none closed, and discovery went from **7 locations to 6**,
its detail page 404'd, its availability 404'd; reopening brought it back to 7.

Eight tests, including the one that matters most — the appointment survives the
close, where the old delete destroyed it — and a booking refused while closed
then accepted after reopening, so closing is not a one-way door.

Two attempts to verify booking refusal through the live API were defeated by the
OTP resend cooldown, and the first produced a **false pass**: the owner login
silently failed, so the branch was never closed and the booking succeeded for
the wrong reason. Moved into the suite rather than retried.

**1069 passing across 30 suites.**

## 90. People: who works here, and what they can do

Item 2 of the wiring plan. Unlike §89 the backend needed nothing — `members`
was carefully built and had simply never been reachable. A business was exactly
one person, because the only way to add a second was a POST nobody could send.

### 90.1 The roles, in the words of the person choosing

Taken from the guards rather than invented:

| | |
|---|---|
| **Owner** | Runs everything, including who works here. Only one person can be the owner. |
| **Manager** | Can change services, hours, prices and bookings. Cannot add or remove people. |
| **Staff** | Can see everything and handle bookings, but cannot change the business. |

The line between OWNER and MANAGER is exactly "may change who has access", and
saying so is more useful than naming the role twice.

### 90.2 What the screen does not offer

The owner cannot be demoted or removed, and nobody can be promoted into a
second owner — there is one owner per business and no ownership transfer. The
server enforces all of it; the screen simply does not draw controls that would
only earn a refusal, and shows the role as a plain label instead.

Members who may not manage people still see the list. Knowing who you work with
is not a privilege, which is also why `listMembers` is the one route in that
controller open to every active member.

Removed people stay visible under **"No longer here"**, because `removeMember`
is a soft removal — the row is the record that this person once had access.

### 90.3 The invitation was a dead end, and that is what this item really fixed

The flow worked exactly as far as the email. It says *"To accept, simply sign
in"* — and an invited colleague cannot, because they have no account, and
business-web's login deliberately sends no role (§50: sending one locked every
administrator out). So the server answered:

> This email has no account yet. Send `role` as BUSINESS or CUSTOMER to create one.

...and the page showed it as an error. Every invitation to someone new ended
there. **The feature was unusable for its main case** and nothing revealed that
until it was driven end to end.

§50's rule is kept intact. Authentication still sends no role. The sentence the
server returns is a *registration* prompt, so the page now treats it as one: a
second step saying there is no account yet, that this is where an invited person
creates theirs, and one button that re-requests with `role: BUSINESS`. A role is
sent only when someone has explicitly asked to create an account.

### 90.4 Verified end to end

An owner invited an unregistered email as MANAGER; the email arrived; she
registered through the new step; the invitation was consumed and she appeared as
an ACTIVE MANAGER without any separate accept endpoint — verifying an OTP is the
acceptance.

Then: demoted to STAFF; refused when she tried to invite anyone (403); the owner
refused demotion and removal, each naming why; removal succeeded and left the
row as `REMOVED`; removing twice refused. A removed member holding a
**still-valid token** got **403** on `/business/members`, `/business/profile`
and `/business/services` — access ends with the membership, not with the token.

Finally the whole thing again with a genuinely new person: invited as STAFF,
blocked at sign-in, registered through the new step, joined, and confirmed STAFF
can read `/business/services` (200) but not invite (403).

## 91. Closures and breaks

Item 3 of the wiring plan, and like §90 the backend needed nothing. Availability
has honoured both mechanisms all along — `CLOSED_EXCEPTION` and `EXCEPTION` are
already named sources in its result. Only the screen was missing, so a business
could not close for a public holiday without a developer.

### 91.1 Two mechanisms, kept apart on the page

They answer different questions, and merging them into one "unavailable" form
would have made both harder to reach:

- **Whole days** — shut for a holiday, or open at different hours. Replaces the
  weekly template for that date.
- **Part of a day** — lunch, a meeting, a delivery. Takes a slice out of an
  otherwise normal day.

### 91.2 The form cannot assemble a refusal

An exception must either close the day **or** set both custom times — never
both, never neither, and never one time without the other. Four separate
refusals, all correct, and all unreachable from the screen: a single dropdown
picks "closed all day" or "different hours", and the time fields only exist in
the second case.

The only refusal a person can still reach is a close time earlier than an open
time, which is a genuine mistake worth being told about rather than prevented.

### 91.3 Verified by watching the slots move

Not "the row saved" — the thing that matters is whether a customer can still
book. On a branch open 08:00–19:00 with 44 slots:

| Change | Result |
|---|---|
| Closed all day | 44 → **0** slots, source `CLOSED_EXCEPTION` |
| Custom hours 10:00–14:00 | 44 → **16** slots, source `EXCEPTION` |
| Lunch break 13:00–14:00 | 44 → **40** slots, source still `TEMPLATE` |

The lunch break leaving the source as `TEMPLATE` is right: the day is still an
ordinary day, with an hour taken out of it.

All five server refusals confirmed, deleting another location's exception is a
404, and removing each row put the slots back exactly as they were. Test rows
were deleted afterwards; the seeded demo exception is the only one left.

## 92. Reviews, and the one reply a business gets

Item 4 of the wiring plan. The third in a row where the backend was complete and
only the screen was missing — a bad review sat unanswered forever, and the
business could not even read it.

### 92.1 Any active member may reply

Not owner-only. Replying to a customer is day-to-day work rather than
configuration, which is how the server has it: `BusinessRolesGuard` with no
`@BusinessRoles`, putting it with the STAFF-permitted actions. The screen
follows rather than inventing a stricter rule.

### 92.2 The page shows exactly what a customer sees

Hidden reviews are excluded **in the query**, for every viewer including the
business. So a review an admin has hidden is simply absent here, and nothing on
this screen can disagree with the public listing.

The byline is the display name and nothing else — never an id or an email, which
a viewer entitled to identity gets through a separate select. Confirmed from an
anonymous request: no `customer` object in any row.

### 92.3 One reply, editable for a week

A second reply is a **409** — *"Edit it instead of posting a second one."* So the
page never offers one: once a reply exists it shows the reply with an **Edit**
control, not an empty box.

That control disappears after `REVIEW_EDIT_WINDOW_DAYS` and says why, rather
than offering an edit the server answers with a 400.

### 92.4 Small things the screen does

A **"waiting for a reply"** count beside the rating, because the useful question
is not what the average is but which reviews still need an answer.

The reply placeholder changes with the rating: at two stars or below it reads
*"A calm, specific reply does more for the next reader than for this one."*
A reply to a bad review is read mostly by people deciding whether to book.

### 92.5 Verified

Replied to a real 2-star review; a second reply refused with 409; the edit
succeeded and set `responseEditedAt`; editing a review with no reply refused
with 400; **another business replying to it got 404**, not 403. The public
listing, fetched with no token, shows the new reply and leaks no identity.

## 93. Review moderation, and the listing that makes it reversible

Item 5 of the wiring plan, and the first needing backend work: `hide` and
`unhide` existed with **nothing to list what they act on**.

### 93.1 Hiding was a one-way door

Every other listing excludes hidden reviews **in the query** — that is what
makes hiding real. Which meant a hidden review was invisible to the public, to
the business, *and to the admin who hid it*. `unhide` took an id that nothing
would ever show you again.

`GET /admin/reviews` is the one listing that returns them. It is the whole
reason the pair of PATCHes was reachable only in theory.

### 93.2 What the queue carries that other listings refuse to

**Identity.** `customerEmail` and `customerId`, because an admin is entitled to
them (§28.6) and a moderation decision about one person's words cannot be made
against "Anonymous".

**Who hid it and why.** `hiddenByEmail` and `hiddenReason` are shown on the row.
`hiddenReason` has always been required — *"hiding customer feedback without
recording why is the kind of moderation that cannot be reviewed later or
explained in a dispute"* — and until now nothing displayed it, so the record
existed and could not be read.

**Business and location names**, because a sentence of complaint means little
without knowing who it is about.

### 93.3 Defaults that match the job

`visibility` defaults to ALL, and the screen offers **"Only 1 and 2 star — the
ones that get disputed"** as a filter rather than a default: a moderator usually
arrives from a ticket about a specific review, not from a sweep.

`hiddenCount` is **platform-wide, not this page**. It is the number worth
watching, and a count that changed with the filter would answer a question
nobody asked. A test pins exactly that: a page scoped to a business with nothing
visible holds zero rows while the count still moves.

### 93.4 Verified against live data

The thing worth checking is not that a flag flipped but that the rating moved.
On a branch with four reviews averaging **3.5**: hiding the 2-star took the
public listing to **three reviews averaging 4.0**, and unhiding put it back to
3.5 from four.

Also: hiding with no reason refused by validation; hiding twice and unhiding
twice both refused; a business asking for the queue got **403**. The demo data
was restored afterwards.

Seven tests, including the one this section exists for — a review absent from
the public listing and present in the queue, carrying the reason it was hidden.

**1077 passing across 30 suites.**

## 94. The user directory

Item 6 of the wiring plan, and the same shape as §93: the action existed and
nothing could reach it. `PATCH /admin/users/:id/display-name/clear` takes an id
that **nothing in the platform produced** — no list, no search, no lookup
anywhere. An admin who learned of an abusive display name had no way to find the
account it belonged to.

### 94.1 A directory, not a user manager

`GET /admin/users` lists, filters by role, searches email and display name
case-insensitively, and narrows to accounts that **have** a display name —
which is the filter that turns a directory into a queue, since clearing one is
the only action here.

Deliberately not added: editing, suspending or deleting a user. §16.9's note
still holds — there is no admin edit of a byline, because replacing a name with
wording an administrator preferred would publish words under that customer's
byline that they never wrote. Clearing is the whole of it, and that asymmetry is
the point rather than an omission.

### 94.2 Counts, not history

Each row carries bookings, reviews and tickets as **numbers**. The question a
directory row has to answer is whether this account is real and active; its
history belongs to the screens that already show it. Active memberships come
with it, so a business account says where its holder works and with what role.

Removed memberships are excluded: they say where someone *used* to work, which
is history rather than who they are now.

### 94.3 Verified

The reason is required, and the customer is told — both confirmed. Clearing
`Deng` changed that reviewer's byline on the public listing from **Deng** to
**Anonymous**, and an email arrived titled *"Your review display name was
removed"*. A business asking for the directory got **403**. Demo data restored
afterwards.

Nine tests, including search matching a display name alone and the role scoping.

A note on method: `UID=$(...)` in the verification script failed with "bad math
expression" — `UID` is readonly in zsh. It read as corrupt data for a moment and
was neither.

**1086 passing across 31 suites.**

## 95. Appointments, and the one button that pays a customer

Item 7, and the last of the three where the action existed with nothing to reach
it. `PATCH /admin/appointments/:id/business-cancellation` took an id no listing
produced.

It is also the only action in the admin console that **moves money**. Saying a
cancellation was the business's fault triggers §25's chain: the customer is
refunded in full including the platform fee, and the business carries the
operator's charge for moving that refund. There is no endpoint for the reverse.

### 95.1 `canReclassify` is computed on the server

Three conditions decide whether reclassifying does anything: the appointment is
CANCELLED, it is not already blamed on the business, and a deposit was actually
taken. The PATCH enforces all three.

The row carries the answer rather than leaving the client to re-derive it. A
client working the rule out independently would eventually disagree with the
server, and the failure mode is a button that offers to refund and then
refuses. Tests assert the agreement directly: for each case where
`canReclassify` is false, the PATCH is called and must throw.

### 95.2 The form spells out what will happen, in money

Not "this will reclassify the cancellation". The panel names the figures for
that specific booking: what the customer gets back, that it includes our fee,
what the business loses, and that both are told. Above them, one line:
**"This moves money and cannot be undone."**

`gatewayChargeMinor` is required and has no sensible default, because it comes
off the operator's statement and **the business pays whatever is entered**. The
field says so rather than pre-filling a guess that someone else would carry.

The ticket id is optional in the API and the form calls it *"the evidence"*,
because a refund with no recorded cause is the one an auditor asks about.

### 95.3 Verified by the ledger, not the flag

A real customer-cancelled booking with a 1400 RWF deposit, reclassified with a
50 charge. The five entries for that appointment:

| | |
|---|---|
| DEPOSIT_RECEIVED | +1400 |
| PLATFORM_FEE | −700 |
| DEPOSIT_REFUND | −1400 |
| PLATFORM_FEE_REVERSAL | +700 |
| GATEWAY_FEE_DEBIT | −50 |
| **Net to the business** | **−50** |

Exactly the operator's charge, which is what §25.1 says the business bears, and
nothing else. The customer is whole; the platform gave its fee back.

Also confirmed: a missing reason, a missing or negative charge, and an unknown
ticket id are each refused; doing it twice is refused; the row leaves the queue;
and both parties received a cancellation email.

Nine tests. **1095 passing across 32 suites.**

**A note on the demo data.** This was performed against a real seeded booking,
and the ledger is append-only — those five rows are permanent. That is the
feature working as designed, not an accident, but it means the demo data now
contains one genuine business-cancellation refund. It is arguably the most
useful row in it.

## 96. The small remainder: notifications, analytics, detail, providers

Items 8 to 11 together. None needed design; all four were reachable endpoints
with nothing calling them.

### 96.1 One inbox, in both shells

`/notifications` is guarded by the JWT alone and scoped to the caller inside the
service, so customers, business members and admins share one implementation. The
bell is therefore the same component in both apps, differing only in which API
module it imports.

~~**Polled, not pushed.**~~ Live since §287, the poll kept underneath. There is no websocket in this platform, and a count that
is a minute stale is worth more than a connection to maintain. Opening a
notification marks it read, because the alternative is a per-row control for
something nobody deliberately does.

Verified live: 43 unread for the business, one marked read leaving 42, mark-all
reporting *"42 notification(s) marked as read"*, and the admin seeing a
different inbox of 28 — one per account, as the guard implies.

### 96.2 §67.4 closed: analytics said USD while holding RWF

`currency: 'USD'` was hardcoded in the analytics response. The amounts are sums
over `Appointment.depositAmountMinor`, denominated in `Appointment.currency` —
RWF since §55. The literal was correct the day it was written and silently wrong
from the moment the deployment moved.

It now reports `INTERNAL_CURRENCY`. Summing across rows is only sound because
every row holds that currency, which `CurrencyGuard` refuses to boot without, so
it is the right thing to name. Confirmed live: `"currency": "RWF"`.

The screen reads the currency from the response rather than assuming the app's
own — which required `business-web`'s `useMoney().format` to take an optional
code, as admin-web's already did. The **exponent** still comes from the server's
table either way: a label is the caller's business, a decimal place is the
currency's.

### 96.3 Partial totals are shown, not rounded over

Analytics reports `complete: false` and a note when appointments could not be
accounted for. Both are surfaced. A total that quietly omits rows is the number
a business acts on and then stops trusting.

### 96.4 Appointment detail is the dispute screen

`GET /appointments/:id` carries what the list does not: when the deposit landed,
the operator's reference, what the operator actually charged and at what rate.
That set has one use — a customer disputes a charge — which is why it is a
drawer rather than more columns.

### 96.5 Payment providers are shown read-only

`GET /payments/providers` on Settings, deliberately not editable: it is a
consequence of which credentials are configured, not a setting. A toggle would
invite someone to "turn Airtel on" by ticking a box that cannot do that. It also
says plainly when **no** operator is configured, which means no deposit can be
taken at all.

**1095 passing across 32 suites.**

## 97. Multiple countries: deferred, with the trigger written down

Raised as a question rather than a request: start in Rwanda, add Kenya, Uganda
and the rest later, with an admin toggling which are open. Discussed and
**deferred**. Rwanda only for now.

### 97.1 More of it is ready than expected

- `OPERATOR_PREFIXES` is **already keyed by country code**, and already explains
  why South Sudan is absent rather than guessing at its mapping.
- Ledger rows already carry `currency` **and** `settlementCurrency` per row.
- Every money aggregation in payouts and ledger already groups by
  `settlementCurrency` and returns arrays rather than single figures (§51).
- `PLATFORM_TIMEZONE` is already configuration.

### 97.2 What actually blocks it

`INTERNAL_CURRENCY` is a **deployment constant** — 49 usages across 11 modules —
and `CurrencyGuard` refuses to boot if the ledger holds anything else. That is
not incidental: amounts are stored as bare integers whose unit is implied, and
the guard's own comment says why changing it is unsafe — *"a balance of
1,200,000 becomes 1,200,000 of something else."*

With it: one set of MoMo credentials per deployment (MTN Rwanda and MTN Uganda
are separate accounts entirely), a single `PAYOUT_MSISDN_COUNTRY_PREFIX`, and
`PlatformSetting` as a **single row** holding one fee, one payout hold and one
exchange rate.

The architecture today is therefore **one country per deployment**, deliberately.

### 97.3 The choice, when it comes

**A — a deployment per country.** Kenya gets its own database, env, credentials
and admin. Costs nearly nothing today because it is what the code assumes. Costs
later: an admin per country, a business trading in two countries holding two
accounts, manual cross-country reporting.

**B — one deployment, all countries.** Per-country currency, credentials, fees
and discovery scoping, with every money aggregation audited. The largest change
since the ledger, and the risk is in money rather than screens.

### 97.4 Why not now

Not difficulty — sequencing. There is no customer app, no live payment in
Rwanda, and no real business yet. Building per-country payments against an API
nobody has seen, and per-country fees for a fee model nobody has paid, means
guessing, and the guesses get written into money code.

**The trigger for revisiting is a business that trades in two countries and
wants one account.** Until then A costs nothing and keeps both options open.

When it is time, the cheap first step is `countryCode` on businesses and
locations with Rwanda as the only value — honest data, no change to the currency
premise, and the A-or-B decision made with real information.

### 97.5 Noted in passing

`PLATFORM_TIMEZONE` falls back to `Africa/Juba` in code while the env sets
`Africa/Kigali`. Correct in this deployment, stale as a default.
`PlatformSetting.providerCurrency` is where a second country would first collide.

## 98. Categories the platform chooses to open

The taxonomy ships complete and the platform opens part of it — start with the
two or three there is somebody to serve, add the rest as that changes.

`Category.isLive`, defaulting to **true** so every seeded category keeps
behaving exactly as it did. The opposite default would have emptied the picker
on deploy.

### 98.1 It gates the picker, never discovery

Switching a category off stops a **new** business choosing it. A business
already in it keeps its listing and stays in search.

Dropping somebody's shop out of search because an admin tidied the taxonomy
would be a silent punishment for a decision they did not make. If that is ever
wanted it should be a deliberate act against that business, with a reason, like
every other moderation decision here.

The admin row therefore shows **how many businesses are in it** before you
switch it off, and says *"still listed"* against the count afterwards.

### 98.2 Verified

Switching Automotive (0 businesses) and Beauty & Personal Care (2) off took the
public picker from 8 categories to 6, while `/discover/locations` stayed at 7
locations — the two Beauty businesses untouched. Both restored.

## 99. Administrators inviting administrators

One primary administrator, and the rest invited by them. The same line a
business draws between OWNER and MANAGER (§90): running the platform and
deciding who runs it are different powers.

### 99.1 The invitation is what confers the role

`POST /auth/otp/request` accepts `BUSINESS` or `CUSTOMER` and **nothing else** —
the DTO has always refused `ADMIN`, which is why nobody can make themselves one.
So an `AdminInvitation` row, writable only by the primary administrator, is the
single path in.

That has a consequence worth stating: an invited administrator has no account
and cannot ask for one, so `requestOtp` issues them a code on the strength of
the invitation alone. It is the one exception to "no role, no code".

### 99.2 An ordering bug that the design made inevitable

The first implementation put the invitation check *after* the guard that refuses
a code with no role. Since an invited administrator's code is issued with **no
role**, by design, that guard rejected the single case the feature exists for:
*"This code was issued for an account that no longer exists."*

The invitation is now consulted first. It also outranks whatever role was asked
for, so an invited address cannot be turned into a customer by sending
`role=CUSTOMER` to the verify step before accepting.

### 99.3 Only an address with no account at all

An existing customer or business cannot be promoted. Their role decides what
every guard lets them reach, and changing it under them would move their own
bookings — or their shop — out of the app they use. The refusal says which kind
of account is in the way.

### 99.4 Revoking admin access did nothing for fifteen minutes

Found by doing it: after `revokeAdmin`, the demoted account's **existing token
still opened `/admin/reviews`**. `JwtStrategy` does no database read and
`RolesGuard` trusted the role in the token, so a revoked administrator kept
their access until it expired.

For a customer or business that is harmless — nothing demotes them. For an
administrator it is not: access is taken away precisely when someone is no
longer trusted with it, and "another fifteen minutes" is not an answer to that.

`RolesGuard` now re-reads the role from the database **when ADMIN is required**,
and only then. The admin console is used by a handful of people, so one query
costs nothing there; customer and business routes, which carry the traffic, are
untouched. Confirmed: the same token went from 200 to **403**.

### 99.5 Removal demotes rather than deletes

A revoked administrator becomes a CUSTOMER. They may have assigned tickets,
hidden reviews and created adjustments, and those records name them. Deleting
the account would break that history; demotion ends the access and keeps it.

The primary cannot be removed by anyone, including themselves, and nobody can
remove their own access. At most one primary exists, enforced by a **partial
unique index** — a plain unique on a boolean would also forbid a second
`false`, allowing exactly one administrator and nobody else.

### 99.6 Verified

Invited an unregistered address; the email arrived; she signed in with no role
and came back as ADMIN; the invitation was consumed; she could work the console
but not invite anyone — *"Only the primary administrator can invite or remove
administrators."* Then: an uninvited stranger still refused a code, inviting an
existing admin, an existing customer and an existing business each refused by
name, a duplicate invitation refused, and removal leaving a CUSTOMER account
whose token stopped working immediately.

Thirteen tests, including that the database itself refuses a second primary.

**1108 passing across 33 suites.**

## 100. The whole taxonomy, editable

§98 gave categories a switch. This extends it to types, adds creating and
renaming, and replaces the checkbox.

### 100.1 A type's switch is ANDed with its parent, never copied into it

`Subcategory.isLive` is independent in storage and combined on read. Copying the
parent's state down would mean rewriting every child whenever a category is
toggled, and the two would disagree the first time that half-failed.

The consequence needs saying on screen, so the admin row carries
`effectivelyLive`: a type whose own switch is on, inside a category that is off,
shows *"Not offered while 'Beauty & Personal Care' is hidden."* Without that the
row looks open and is not.

Verified: hiding Beauty took the picker from 8 categories to 7, while Barbershop
still reported `isLive: true` and `effectivelyLive: false`.

### 100.2 ~~Nothing in use can be deleted~~ — superseded by §101

Kept for the reasoning about the foreign keys, which still holds. The delete it
guarded no longer exists.

`BusinessProfile.categoryId` is `SetNull` and `Subcategory` cascades from its
parent — so deleting a category in use would silently strip the category from
every business in it **and** take their type with it. The §89 shape exactly.

A delete is refused the moment anything depends on it, naming the count and
pointing at the switch: *"4 businesses are using this category or one of its
types. Switch it off instead — deleting would strip the category from them."*
The button is not drawn at all in that case, because a control that always 400s
teaches people to ignore the message.

Deletion exists for the row somebody created with a typo thirty seconds ago.
Retiring part of the taxonomy is what the switch is for.

### 100.3 A switch, and a question before it moves

The checkbox is now a toggle. A checkbox reads as "tick this and apply later";
these take effect the moment they move. The control underneath is still a real
`<input type="checkbox">` — keyboard behaviour and label association come free,
and a `div` with an `onClick` has to reimplement both and usually gets one wrong.

Every switch confirms first, and the confirmation **names the consequence rather
than asking "are you sure"**. Switching one off with businesses in it says how
many and that they keep their listing; switching one on says new sign-ups can
choose it. The reassurance is the part worth reading.

### 100.4 Where a business picks this

Asked, and worth recording: **"Your shopfront" → Details**, the Category and
Type of business dropdowns (§88). There is no separate onboarding wizard — a
business signs up, gets an empty profile and fills it in there, which is also
why a newly registered business has no category until someone sets one.

### 100.5 Verified

Created "Dining" with three types; duplicates refused by name at both levels
with a 409; it appeared in the seller picker immediately; switching one type off
took the picker from three types to two; deleting a category in use and a type
in use both refused with counts; deleting the unused ones worked, leaving all
eight original categories and all eight categorised businesses untouched.

**1108 passing across 33 suites.**

## 101. Nothing in the taxonomy is deleted

Corrected on sight: *"why do you use 'delete', we are just retiring them not
delete at all meaning we can take them back."*

Right, and it is the **second time** — §75 was the same correction about the
word "remove" on a service. The principle was already recorded there and I did
not carry it across to a screen I wrote fifteen minutes later. Writing it down
is evidently not the same as applying it.

### 101.1 Two controls already covered every case

- A category that should no longer be offered → **switch it off**. Reversible,
  and the businesses in it keep their listing.
- A category created with a typo → **rename it**.

There is nothing a delete does that those two do not do better, and one thing it
does that neither does: make the decision permanent.

§100.2 built a careful guard — refuse while anything depends on it, name the
count, point at the switch — which was a correct answer to the wrong question.
Not offering the operation is simpler than guarding it, and cannot be got wrong
later by someone relaxing the guard.

### 101.2 Removed from both sides

`DELETE /admin/categories/:id` and `DELETE /admin/subcategories/:id` are gone,
along with their client calls and buttons. The schema is untouched: rows were
never being deleted in practice, so nothing needs migrating.

The page now says so where it is used: *"Nothing here is ever deleted —
switching one off retires it, and switching it back on brings it straight
back."*

### 101.3 The general rule, stated once

Across §73 (services), §75 (wording), §89 (branches) and now the taxonomy, this
platform retires and never erases. The reason is the same every time: retiring
is reversible and erasing is not, and the records left behind — a booking, a
listing, a ledger entry — are usually what somebody will need to explain a
decision later.

**Anything offering to delete should be read as a bug until proven otherwise.**

## 102. The customer app: Expo, and the first screen

The platform could not take a booking. Eleven of twelve wiring items were done
and every one of them was tooling around that hole.

### 102.1 Expo over Flutter, for a reason specific to this repo

Not a judgement on the frameworks. **457 TypeScript files and a generated API
contract**: `docs/openapi.json` comes from the NestJS DTOs, and
`openapi-typescript` turns it into a `schema.d.ts` both web apps consume. A
React Native app runs the same command and gets the same file, so changing a DTO
breaks the mobile build. Dart would mean hand-written models and drift
discovered at runtime, on somebody's phone.

The client, the money helper and the OTP flow also port directly. `useMoney()`
in particular — the helper that reads the exponent from the server rather than
dividing by 100 — has already been the subject of two bugs (§67.4, §96).
Rewriting it in another language is a third chance to get it wrong.

### 102.2 ~~"I can exercise it end to end in a browser"~~ — that was wrong

The argument offered for a web app first. Challenged, and it did not survive:
**I have never clicked through a browser in this project.** Verification has
been curl against the backend, plus typecheck and build on the frontend, with
the user doing the clicking.

React Native loses nothing by that measure and gains something: Xcode is
installed here, so a simulator can be booted, screenshotted and **read**. That
is more than is possible for the two web apps. The claim was convenient rather
than true.

What remains honest: I can see the screen but not tap it. Driving a flow still
needs a person.

### 102.3 Checked the docs instead of trusting memory

The scaffold ships an `AGENTS.md` whose first instruction is that Expo ships
breaking changes every SDK release and its APIs should not be written from
training data. Taken seriously, and immediately useful: this is **SDK 57, React
19.2, React Native 0.86**, and the router installation steps came from the
versioned docs rather than memory.

The file is kept, with a line added pointing at the root `CLAUDE.md` and this
file first — Expo guidance sits on top of the product's rules, not beside them.

### 102.4 Tokens go in the Keychain

`SecureStore`, not `AsyncStorage`: a refresh token on a device that may be lost
or shared deserves better than plain storage. It is async, unlike
`localStorage`, so the token cache is held in memory and rehydrated once at
startup — otherwise every request would await a Keychain read.

Everything else about the client is the web one unchanged: single-flight
refresh, exactly one retry after a 401, the same reasoning in the same comments.

### 102.5 Discovery, anonymous

Browse, search, filter by category, sort, "open now". Unauthenticated, because
the endpoint allows it and asking someone to sign in before they can see a price
loses most of them.

Running against the live backend in the simulator: **7 places**, Kimironko Spa
showing ★5.0 (1) and **from RWF 8,000** — formatted through the server's
exponent, not divided by anything.

### 102.6 Two setup notes

`babel-preset-expo` had to be installed explicitly; npm workspace hoisting left
Metro unable to resolve it. And `expo start --ios` exits if the simulator deep
link fails, so Metro is started on its own and the URL opened with `xcrun simctl
openurl`.

## 103. A booking is the shop's wall clock, not the server's

Found by sending the customer app's exact payload at the real backend. The app
sends what the customer tapped — `2026-11-03T10:00:00`, a time with **no zone**,
because that is what availability returned and what the slot means.

It stored `2026-11-03T08:00:00.000Z`, which is correct: 10:00 in Kigali. And it
was correct **by accident**.

### 103.1 The accident

`new Date(dto.startTime)` reads a zone-less string in the **host's** timezone.
This machine is set to `Africa/Kigali`, so the conversion happened to be right.
A server in UTC — which is every deployment — would have read the same string as
10:00 UTC and stored a booking at **12:00 Kigali**.

Two hours late, on every booking, discovered by a customer arriving to a shut
shop. Nothing in the test suite covered it because every test ran on this
machine.

### 103.2 The fix is to use the helper that already existed

`zonedWallTimeToInstant` has been in `availability/time.util.ts` all along —
availability generates its slots with it, and it handles the hour that does not
exist on a DST boundary. Booking simply never used it.

Now: a string carrying a zone (`Z` or `±HH:MM`) is an instant and is trusted. A
zone-less one is a wall clock, resolved against the **platform zone** —
exposed from `AvailabilityService` rather than re-read from config, so the zone
that generated the slot and the zone that resolves the booking cannot drift.

### 103.3 The test runs in two time zones

Four tests, and the two that matter assert the customer's chosen time survives
the round trip. They pass here and, more to the point, **with `TZ=UTC`**.

Reverted the fix and ran them under UTC to be sure they were not passing for the
wrong reason: *Expected "10:00", Received "12:00"*. The whole suite now passes
under both — **1112 across 34 suites**, twice.

A note on method: this was only visible because the verification sent the
*literal* payload the client sends, rather than a tidied-up one with a `Z` on
the end. A convenient test string would have hidden it completely.

## 104. Provinces and districts

Asked for: businesses choose a province, customers filter by one, and a business
can be in two.

### 104.1 Districts, not provinces alone

Every branch on the platform is in the City of Kigali. A province filter there
offers **one option** and answers nothing.

So the model is province → district, with the district on the branch. Province
filtering works exactly as asked (it is reached through the district), and the
filter is useful in the launch market from day one: the same nine branches split
Gasabo 4, Kicukiro 3, Nyarugenge 2.

Rwanda's five provinces and thirty districts are seeded, checked against
Wikipedia rather than written from memory.

### 104.2 Place belongs to the branch

Which is what makes "a business in two provinces" fall out rather than needing
anything: a business already has many branches, and **Kigali Barbers appears in
both Gasabo and Nyarugenge** in the demo data.

The province is reached *through* the district rather than stored beside it. A
district cannot move province, and two columns that can disagree eventually do.

`districtId` is nullable: every existing branch predates this, and a required
column would have made them unsaveable. A branch without one is simply not
findable by place — which the branch screen says, rather than the save failing.

### 104.3 Two filters, and the narrower one wins

Sending both a province and a district applies the **district**. ANDing them
would produce a contradiction nobody can read: a Gasabo branch asked for by
Kigali province and Kicukiro district would silently vanish. A test pins it.

In the customer app, districts appear only once a province is chosen — thirty
at once is a wall of names, twenty-seven of them hours away.

### 104.4 Reference data is not test data

`resetDatabase` truncates every table, which removed the provinces, and
`migrate deploy` applies a migration **once** — so a test database that had
been reset never got them back. Every place test asserted against a Rwanda with
no provinces in it.

Two changes. `resetDatabase` leaves `provinces` and `districts` standing: they
are part of the country, no application code writes them, and truncating them
only creates a state no deployment is ever in. And `prisma/reference-data.sql`
is now the **living** copy, idempotent, run by the test harness after migrating
— the migration keeps a frozen copy because migrations are history and must not
change.

### 104.5 Verified

`/places/provinces` returns 5 provinces and 30 districts, correctly grouped.
Discovery carries each result's district and province. Filtering by district
gives Gasabo 4, Kicukiro 1, Nyarugenge 2; by province, Kigali 7 and every other
province 0. The business branch screen shows the district or says it is missing,
and offers the thirty grouped by province.

Seven tests, including one business in two provinces and a branch with no
district staying out of every place filter.

**1119 passing across 35 suites**, under the host zone and under `TZ=UTC`.

## 105. Where the platform is open

Clarified after §104: *"I meant Headquartered like Musanze, Rwamagana etc and can
be added from the admin portal as well and can be retired from there too."*

Musanze and Rwamagana are districts, which confirms §104 chose the right unit.
What was missing is that the list is a **decision**, not a fixed fact.

### 105.1 The country is a fact; the territory is a choice

Rwanda has thirty districts whatever this platform does. Which of them it trades
in is something an admin decides — open Musanze when there is somebody to serve
there, retire it when that changes.

`District.isLive`, defaulting to **true** so nothing changes on deploy and the
backfilled branches stay findable. Exactly `Category.isLive`'s default and
exactly its reasoning (§98).

### 105.2 Retired, never deleted

§101, and the case is stronger here than it was for categories. A district may
be the recorded location of branches, of past bookings, and of the ledger
entries that explain them. There is no delete endpoint at all; the admin screen
offers a switch and a rename, which between them cover every reason anyone would
have wanted one.

The guarantee is the same as a retired category's: **branches already there keep
their listing and stay in search.** Two tests hold it, including that the
district remains filterable for them — retiring gates the picker, not the data,
so a saved link or an old filter still works.

### 105.3 A province with nothing open disappears

The public list returns only provinces with at least one live district. A filter
row offering "Western Province" that matches nothing is worse than not offering
it: it reads as the search being broken rather than the platform not being there
yet.

Measured: retiring all 27 districts outside Kigali left the customer's filter
showing **City of Kigali alone**.

### 105.4 Verified

Retiring Gasabo — four branches in it — removed it from the picker while all
four stayed in search, and the response said so in words: *"Retired. New
branches cannot choose it, and the 4 already there keep their listing."*

Adding worked (Kinigi, in Northern Province); a duplicate name or code gives
409; a lowercase code gives 400 naming the rule. Everything was restored
afterwards except Kinigi, left **retired** so the screen has a closed place to
show.

Ten tests in `places.spec.ts`. **1122 passing across 35 suites.**

## 106. Four places, and filtering is always a choice

*"just add this four — Kigali, Musanze, Rubavu, Rusizi — and remove everything
else"*, then: *"leave them under kigali and not collapsed, but doesn't mean when
a customer logs in as located in gasabo should not see listings from other
locations, they are just for filtering explicitly."*

### 106.1 A city is one place; a province is a region of separate towns

The four names are not the same kind of thing. **Kigali** is a city whose three
districts are neighbourhoods — Gasabo is part of Kigali, not an alternative to
it. **Musanze, Rubavu and Rusizi** are districts in their own right, towns hours
apart, and nobody looking for Rubavu would think to tap *"Western Province"*.

So `Province.isCity`, true only for the City of Kigali, which genuinely has
special administrative status in Rwanda. A flag rather than special-casing the
`KIGALI` code in each client, because three apps would need the same exception
and one would forget.

The filter row is built from it: a city contributes **one chip**, everywhere
else contributes **its districts**. Which gives exactly the four names asked
for — *Anywhere · Kigali · Musanze · Rubavu · Rusizi* — and Kigali's districts
stay underneath as a second row rather than being collapsed away.

### 106.2 Nothing filters itself

The important half of the instruction. **A customer in Gasabo sees every
listing** until they choose otherwise.

Confirmed rather than assumed: there is no `expo-location` dependency, no
permission prompt, and nothing sends `lat`/`lng`/`radiusKm` — they exist on the
API and the app never uses them. Both filters start `null`, "Anywhere" is
selected on open, and it is the only state a customer has not asked for.

Recorded because it is the kind of thing a later "helpful" change breaks:
**place is a filter a customer applies, never one applied to them.**
*(Still true of a NAMED place. Distance from where the customer is now is
applied by default once they share it — the user asked for that in §171.)*

### 106.3 Twenty-four retired, none deleted

Everything outside the four is retired, through the admin endpoint rather than
SQL, so it went the route a person would take. All 31 districts remain in the
admin listing with their state, and all nine demo branches stayed in search
throughout — the §105 guarantee holding under a change that touched most of the
table.

### 106.4 Two bits of drift caught

`prisma migrate diff` reported an index on `locations(districtId)` present in
the database and missing from the schema — §104's migration created it and the
model never declared it. Declared now, and the two are in sync.

And `reference-data.sql` needed the `isCity` update too: without it a fresh
database would have had Kigali as an ordinary province, and the filter row would
have read "City of Kigali, Northern Province, Western Province" — three labels
nobody asked for.

**1124 passing across 35 suites.**

## 107. Nearest first, and nothing hidden

Asked: *"apart from filtering don't you think there are other uses like
calculating nearest listings near customers etc."*

Yes — and it sits with §106.2 rather than against it. **Sorting** by distance
still shows everything; it is **filtering** by radius that hides things.

### 107.1 ~~`sort=distance` requires lat, lng and radiusKm~~ — superseded

That rule forced every proximity search to also be an exclusion. Knowing where
somebody is should put the nearest shop first, not hide the one across town.

Now: `lat` and `lng` go together, because half a coordinate is not a place.
`radiusKm` is **optional and separate** — without it, distance is computed for
ordering and display and nothing is excluded; with it, it narrows. Verified
against the live platform: a position alone returned all **7** places ordered
1.1 km to 7.6 km; the same position with `radiusKm=5` returned **4**.

A radius with no position is refused — *"a radius has to be a radius around
something."*

### 107.2 A branch with no coordinates sorts last, it does not vanish

It cannot be measured, which is not a reason to hide it. The existing ordering
already used `?? Infinity`; what changed is that the query no longer excludes it
when there is no radius to exclude it by.

### 107.3 The permission is asked for at the moment it explains itself

Three rules in the app, all consequences of §106.2:

- **Never on open.** The prompt fires when someone taps **Nearest**, and not
  before. An app that asks before showing anything gets declined, deservedly.
- **Declining costs nothing.** The sort falls back to rating and every listing
  is still there. The screen says so in one line rather than leaving a tapped
  control doing nothing.
- ~~**It orders, it never excludes.** The app sends the position **without a
  radius**, so the far shop stays on the list.~~ Superseded by §171: Home
  narrows to 10 km by default, growing where that holds too few places.

`Accuracy.Balanced`, not `High`: this sorts a list of shops, and street-level
precision would cost battery and a visible delay to change nothing anybody would
notice. The iOS permission sentence says what it is for and that browsing works
without it — *"to use your location" answers nothing and gets declined.*

Distance is shown per card, as **"600 m away"** under a kilometre and
**"2.3 km away"** above it. Nobody says "0.6 km".

### 107.4 A test that documented the old rule

`discovery.spec.ts` asserted all three of lat, lng and radiusKm were required.
Correct when written, and exactly what this changed. Rewritten to the new
contract rather than deleted, with the superseded line kept — half a coordinate
and a lone radius are still refused, and a bare position now resolves.

Eight new tests in `nearest.spec.ts`. **1132 passing across 36 suites.**

## 108. One command to start everything

Five things have to be running to see a change: Postgres, Mailhog, the backend,
two web apps and Metro — in that order, because each needs the one before it.
Starting them by hand means five terminals and remembering which comes first.

`./scripts/dev.sh`, or `npm run dev`. `--no-app` skips Metro, which is the slow
one and is not needed for backend or web work.

### 108.1 What it handles that a list of commands does not

**Colima.** Postgres lives in Docker and on this machine Docker lives in Colima,
so a rebooted machine has neither. The first attempt died at "database did not
come up", which is a poor way to be told the container runtime is off. It now
starts Colima itself and says it is doing so, because a cold start is slow
enough to look like a hang.

**Migrations, from the right directory.** Prisma reads `DATABASE_URL` from the
`.env` beside its schema, so `npx prisma migrate deploy` run from the repo root
finds no database. The second attempt died there. It runs in a subshell from
`apps/backend`, and also applies `reference-data.sql` — idempotent, and a
database that was reset would otherwise have no provinces and every place filter
would match nothing (§104.4).

**Metro alone.** `expo start --ios` quits if the simulator deep link fails, and
would take the whole script with it (§102.6). Metro starts on its own, and the
simulator is opened only if one is already booted; otherwise the script prints
the one command to run.

### 108.2 Ctrl-C stops the apps and leaves the containers

Postgres and Mailhog keep running on exit. A stray Ctrl-C that dropped the
database would mean reseeding, which is a much worse outcome than two containers
left up. `npm run dev:stop` stops those deliberately.

### 108.3 Verified from a genuinely cold machine

Colima was not running when this was written, which is why the first two
attempts failed and why both failures are now handled. The third run brought up
all five services and the backend answered with **7 places** from live data.

### 108.4 The phone app is pointed at this machine, not localhost

A real phone reading `EXPO_PUBLIC_API_URL=http://localhost:3000` looks for the
backend **on itself** and finds nothing. The script writes this machine's wifi
address into `apps/customer-app/.env` on every start.

Every start, not once: the address changes whenever this machine joins a
different network, and a stale one fails in a way that looks like the backend
being down. A simulator reaches either, so the LAN address is simply always the
right answer.

### 108.5 Metro runs in the foreground, or there is no QR code

Found by being asked where the QR code was, and not having an answer.

Metro draws its QR **only when attached to a terminal**. Redirected to a log it
prints a plain "Waiting on http://localhost:8081" instead, so the code existed
nowhere — and on an iPhone there is no way in: Apple's rules stopped Expo Go
scanning QR codes itself, so a phone camera and a visible QR are the only route.

Metro now starts **last and in the foreground**, with everything else already up
and logged to files. Two things fall out of that: the QR is on screen, and
bundler errors appear as they happen rather than in a file nobody is watching.

Generating a QR separately was the first idea and the worse one — a second
source of the same URL, able to drift from the one Metro actually serves.


## 109. The deposit nobody could notice being paid (2026-10-02)

The platform's whole point is taking a deposit, and that loop had never once
been driven. Driving it found the booking works — and that the phone could not
tell.

### 109.1 Every field name in the payment poll was wrong

`apps/customer-app/src/api/booking.ts` declared the poll's reply by hand:

```ts
{ appointmentId, status, depositPaidAt, paymentInitiatedAt,
  paymentProviderReferenceId, providerStatus?, message? }
```

What `GET /appointments/:id/payment-status` actually returns:

```ts
{ appointmentId, appointmentStatus, paymentStatus, providerReferenceId, failureReason? }
```

One field in five was right. The screen read `undefined` for the rest, so:

* the "Check your phone and approve the payment" line, keyed on
  `paymentInitiatedAt`, **never appeared**. Tap Pay and the screen looks dead
  while the handset is waiting for a PIN.
* nothing ever refetched the appointment. `awaitingPayment` came from the
  appointment query, the four-second `refetchInterval` was on the payment query,
  and only `pay.onSuccess` invalidated the appointment — once, immediately.
  So the deposit lands, the backend moves to BOOKED, and the phone **polls
  forever showing the Pay button**. The arrival code is never shown.

Nothing failed. Not a type, not a test, not a request. This is the third time
this exact class of bug has been found in this project (§81 and §83 were ticket
attachments), and the first two were found the same way: by sending a real
request and reading the real reply.

The fix is three parts. The poll now stops on what ends the wait rather than on
what the wait is for:

```ts
refetchInterval: ({ state }) => (state.data?.paymentStatus === 'PENDING' ? 4000 : false)
```

An effect refetches the appointment the moment the operator says SUCCESSFUL,
because `depositPaidAt` and the arrival code live there and nothing else was
going to ask. And the initiate reply, which already says `PENDING`, is **seeded**
into the poll's cache rather than triggering a refetch, so the "approve on your
phone" line appears with the handset prompt instead of up to four seconds later.

### 109.2 Why the sandbox hid it

MTN's sandbox approves in **under half a second** — measured at 0.54s. So the
single early `refresh()` in `pay.onSuccess` happened to fire *after* the money
had landed, and the screen worked. On a real handset, where someone unlocks their
phone and types a PIN, it could not have.

A sandbox that answers instantly is not a fast version of production. It is a
different system, and it hid a total failure of the waiting state.

### 109.3 The field taught people to type what it would reject

`InitiateDepositPaymentDto` takes MSISDN and nothing else: `^\d{8,15}$`, no `+`,
no spaces. The input a customer types into is labelled **`07xx xxx xxx`**.

Confirmed against the live endpoint:

| typed | result |
|---|---|
| `0788123456` | 200 |
| `0788 123 456` | **400** |
| `+250788123456` | **400** |
| `250788123456` | 200 |

So the placeholder demonstrated a format the backend refuses, and the app's own
check — `phone.trim().length >= 9` — counted characters, letting `07 88` through
as four digits dressed as five characters.

Normalised in the app (`toMsisdn`, digits only) rather than by loosening the DTO.
The operator wants MSISDN; one stripper next to the keyboard beats a regex that
also has to accept prettiness, and nobody should be told off for typing a phone
number the readable way.

### 109.4 The sandbox's payer numbers, probed rather than assumed

The FAILED branch of the screen was new, so it needed a real failure. MTN's
sandbox drives the outcome from the payer number, and these were confirmed by
asking it rather than taken from documentation:

| payer | result |
|---|---|
| `46733123450` | `FAILED: INTERNAL_PROCESSING_ERROR` |
| `46733123451` | `FAILED: APPROVAL_REJECTED` |
| `46733123452` | `FAILED: EXPIRED` |
| `46733123453` | **stays PENDING** — the only way to see the waiting state |
| anything else | `SUCCESSFUL` |

`46733123453` is the valuable one: it is the only way to exercise the state a
real customer spends most of their time in.

In every failure the appointment stayed `PENDING_PAYMENT` and
`providerReferenceId` came back **null**, exactly as §57.3 intends — the slot is
still held and a retry is possible. The screen now says so and offers "Try
again", rather than treating a failure as the end.

### 109.5 `failureReason` is for support, not for reading

It arrives as `FAILED: APPROVAL_REJECTED`. The provider interface is explicit
that it is "for logs and support", and the first draft of the response DTO said
the opposite — that it was shown to the customer verbatim. Corrected.

`explainFailedDeposit` turns the three cases into sentences, because they differ
in what the customer should do next: a rejection was their own choice, an expiry
means they were too slow, an internal error is the operator's fault. The raw code
stays on screen in small print, because that is what a support ticket needs.

### 109.6 The contract described no responses at all

The root cause, and it is bigger than this screen. `docs/openapi.json` covered
115 paths and described a usable response schema for **five** of them. Both
payment endpoints returned bare object literals, so the generated contract said
`{ type: object }` — there was nothing for a client to be wrong about, which is
why a hand-written guess was the only option.

So §60's "the contract is the source of truth for the SHAPES" was only ever true
of **request bodies**. Every response type in all three frontends is hand-written
and can drift in silence. That is the mechanism behind §83 and behind this.

Fixed for these two endpoints: both now return a declared DTO, the service's
return type **is** that DTO, and `@ApiOkResponse` puts it in the contract. The
service and the DTO can no longer disagree without the backend failing to
compile.

Not fixed for the other 108 endpoints, deliberately — that is a day's work on
its own. The trigger for doing it, written down as §97 wrote one: **the next time
a client reads a field that is not there.** A third instance of the same bug
means the pattern, not the instance, is what needs fixing.

### 109.7 A test that asserts names, as names

`test/payment-status-contract.spec.ts` asserts `Object.keys(reply).sort()` for
both replies, which is unusual and deliberate: a test checking only values would
have passed throughout the entire bug.

Proved it fails for the right reason by renaming `appointmentStatus` to `status`
in both the DTO and the service, as a careless refactor would. Four of the five
tests failed, naming the drift exactly — `- "appointmentStatus" + "status"`.
Restored, and the suite is **1137 across 37**.

### 109.8 The customer app now generates its types, as §102.1 promised

§102.1 chose Expo over Flutter on one argument above all: "a React Native app
runs the same command and gets the same file, so changing a DTO breaks the mobile
build." That command had never been wired up. The app had no `schema.d.ts` and
every type in it was hand-written — the argument for the framework was true in
principle and false in the repository.

`scripts/api-types.sh` now regenerates the contract and all three clients in one
command, and the payment types are imported from it. Running it immediately
turned this bug into a compile error:

```
app/booking/[id].tsx(151,28): error TS2339:
  Property 'paymentInitiatedAt' does not exist on type '{ appointmentId: string; ... }'
```

One command rather than three, because three clients generated from different
versions of the contract is the same silent drift the contract exists to prevent.

The generator runs out of `apps/admin-web/node_modules`, which looks wrong and is
the only thing that works: a root devDependency forces a root `npm install`,
which fails on a pre-existing peer conflict in `apps/backend` (`@nestjs/schematics`
wants TypeScript >= 6, the backend pins 5.9); installing it in the customer app
fails because `openapi-typescript@7` peers on TypeScript ^5.x while Expo SDK 57
pins 6; and `npx -y openapi-typescript` cannot fetch here. admin-web already has
it pinned, with a TypeScript that satisfies the peer, and the output is
byte-identical for all three apps. The reasoning is in the script, where whoever
next wonders will be standing.

### 109.9 What this means for the platform

A customer can now book and pay, and be told what happened. That was the hole
§102 opened with — "the platform could not take a booking" — and it is closed,
against the real operator rather than a stub.

## 110. My bookings, and two more things the client invented (2026-10-02)

A booking could be reached only by the screen that created it. Close the app
after paying and the arrival code was gone from the phone — it is in the email
too (§54), but a customer standing at a counter is not reading email.

### 110.1 A third hand-written value the backend never had

While typing the new screen against the contract, §109's trigger fired on its
own. The discovery screen offers a sort chip labelled **"Newest"**, and
`DiscoverySort` in the app read:

```ts
export type DiscoverySort = 'rating' | 'price' | 'distance' | 'newest';
```

The backend enum is `rating | price | distance`. Every tap of that chip was a
400: *"sort must be one of: rating, price, distance"*. It had been on the screen
since §102.

Unlike §109 this one was preventable on the day it was written — request
parameters HAVE always been in the contract; the app simply was not reading it.
Deriving the type from `paths['/discover/locations']` turned the chip into a
compile error immediately.

Then the question of what to do about it. The chip was removed from neither
side: `newest` was **added to the backend**, ordering by `createdAt desc`. A
control the author put there, which plainly means something, is better made to
work than deleted — and deleting it would have been a product change made on the
way past, which is not mine to make.

`createdAt`, not `updatedAt`: when the shop was listed, not when its row last
changed. On `updatedAt` the list would reshuffle every time a business saved its
opening hours, which is not what "newest" means to anyone. Both are tested,
including the edit-does-not-promote case.

### 110.2 "What's next" and "what happened" are sorted differently

`GET /appointments` has always ordered `startTime desc`, which is right for the
business app — a schedule is read from the most recent backwards — and exactly
wrong for a customer's Upcoming tab, where it opens on the booking FURTHEST
away.

Reversing the page in the client would have been worse than doing nothing:
twenty-five rows in the right order, but the wrong twenty-five, because the
ordering decides which rows the page contains. So `sort=soonest|latest` was added
to the endpoint, defaulting to `latest` so the business app is untouched.

Tested across pages as well as within one, since within-page order is exactly
what a client-side reverse would have got right.

### 110.3 The screen

Two tabs, two different questions: Upcoming (`from=now`, soonest first) and Past
(`to=now`, latest first). The boundary between them is pinned when the screen
opens rather than read per render — a `now` that moves on every keystroke lets
the two tabs disagree about the booking happening right now, and can drop it from
both.

Each row carries the status in the customer's words rather than the platform's.
`PENDING_PAYMENT` gets the only nudge — "Pay the deposit to confirm this slot" —
because it is not a state to describe but a thing to do, and it is the row that
costs someone their slot if ignored.

Signed out, the screen explains itself and offers a sign-in rather than hiding.
The header link on Discovery is shown to everyone for the same reason: a button
that is not there teaches nobody that bookings are kept with an account.

### 110.4 Seen, with the part I could not see said plainly

Booted in the iOS simulator against the live backend: the header link renders,
the screen opens, and the signed-out state reads as written. Expo Go had to be
installed on the simulator first — §102.5's run predated it.

**The signed-in list was not seen.** Signing in needs an emailed code typed into
the phone, and §102.2 is still true: I can read the screen but not tap it. What
was verified instead is the data underneath — the list endpoint returning the
right rows in each order, confirmed against the running backend. The rendering
of a populated list is the part a person still has to look at.

## 111. A customer can finally leave a review (2026-10-02)

The whole reviews feature was built on something nobody could produce. The
business app can **reply** to a review (§92), the admin console can **hide and
unhide** one (§93), and discovery's default sort is **"Best rated"** — all of it
running on five seeded rows, because no client called
`POST /appointments/:id/reviews`.

Three of seven places had any rating at all. The moderation queue could never
fill, the replies had nothing to reply to, and the default sort ranked on data
that could not grow.

### 111.1 The app could not tell "you can review this" from "you already did"

This had to be solved before any screen could be written, and nothing existing
answered it. The public listing deliberately carries **no `customerId`** (§92.2 —
the byline is a display name and nothing else), so an app cannot find its own row
in it. The only way to discover an existing review was to post one and read the
**409**.

So the customer's own appointment reads now carry their own review. On the
CUSTOMER projections only, and that restriction is the whole design:

**A business must not get it.** Joining the review onto the shared projection
would have handed a business a review an admin had **hidden** — and §93 is
entirely about hiding removing it from every listing. The test that matters most
in this section asserts the field is *absent*, not null, from a business's read.

**The author still sees their own, hidden or not.** Hiding it from them would
leave the app offering "write a review" on an appointment the server answers with
409 "already reviewed" — worse than saying nothing. No `hiddenAt` is exposed
either way: whether an author should be *told* their review was hidden is a
moderation question this does not settle, and inventing an answer in passing
would be the wrong place to decide it.

It is on the **list** as well as the detail, so the Past tab can say "you rated
this" without one request per row — with fifty rows that is fifty requests.

### 111.2 Driven all the way through, not stubbed

The reason this took real setup: only a **COMPLETED** appointment may be
reviewed, and nothing in the system had ever reached that state through the real
endpoints. So the probe ran the whole lifecycle — customer books, pays through
the MTN sandbox, the shop verifies the arrival code, the shop completes the
visit, the customer reviews it:

```
business verifies arrival -> 200 IN_PROGRESS
business completes        -> 200 COMPLETED
leave a review            -> 201
a second review           -> 409 This appointment has already been reviewed.
edit it                   -> 200 rating=5, editedAt set
```

And the part worth checking is not that a row appeared but that **the aggregate
moved**: the location's public listing went from 1 review to 2, and its rating
from 1.0 to 3.0. The byline read "James A." — the name supplied with the review,
which §31 stores on the user and not on the review.

Two route prefixes were wrong in the first attempt, both found by driving it:
verify and complete live under `business/appointments`, not `appointments`. And
the first business account tried got a **404, not a 403**, for an appointment
belonging to another business — the cross-tenant rule working, confirmed by
accident.

### 111.3 The screen says what the rules are instead of discovering them

Both server refusals are repeated in the client, not to enforce them but to
explain them. A visit that is not COMPLETED gets a sentence rather than a form.
A review past its seven-day window shows what was written with the controls gone
and a line saying why, rather than an edit box that returns a 400 — the same
choice §92.3 made for the business's reply.

The star picker names each score, so a tap is a sentence rather than a number.
And the display-name field says the thing that is surprising: filling it in
rewrites the byline on **every review this person has ever left**, because the
name lives on the account. That is intended behaviour (§31) and invisible
otherwise.

### 111.4 A header that read `review/[id]`

Found in the simulator, and only there. Every early return in an expo-router
screen needs its own `<Stack.Screen>`: until one renders, the header is titled
with the route's **file name**. So the loading and not-found states of the review
screen showed **`review/[id]`** across the top.

Not new, and not confined to the new screen — `booking/[id]`, `book/[id]` and
`shop/[id]` all had it, on both their loading and their failure states. Six
branches fixed. A typecheck cannot see this and neither can a test that renders
the happy path; it took looking at the screen.

The not-found copy was weak too, and the same screenshot showed why: *"That
booking could not be found"* is what a signed-out customer sees, and it reads as
though the booking is gone. It now says what to do about it.

### 111.5 What was seen and what was not

Seen in the simulator: the route resolves, the header title is right on every
state, the not-found copy renders. **The form itself was not seen populated** —
reaching it needs a signed-in customer with a completed visit, and signing in
needs an emailed code typed into the phone. §102.2 still holds: I can read the
screen, not tap it.

What stands in for it is that every endpoint behind the form was driven against
the live backend, including both refusals and the aggregate moving.

### 111.6 One thing the types cannot say

`findOne` and `findAll` pick their projection at runtime, so their inferred
return type is the **union** of the two and names `review` on neither branch.
The runtime is right and the type cannot express it, which is why the new tests
cast through `unknown`.

Worth noting rather than fixing today: it is the same shape of problem as §109.6
— the server knows things about its responses that nothing downstream can read.

## 112. Chat, on both sides, and an email that should never have left the server (2026-10-02)

The last unwired cluster. Six endpoints and a whole WebSocket gateway (§21, §22)
had been built, tested and never once called by a client — which is why the thing
below survived in it for a month.

### 112.1 A customer was being handed the shop's staff email

Every message carried its sender as `{ id, email, role }`, to **both sides**. On
a customer's phone that `email` is the personal login address of whichever member
of staff typed the reply — handed to anyone who messages the shop, on every line
of every conversation. The realtime push carried it too.

§92.2 had already settled this for reviews: *"the byline is the display name and
nothing else — never an id or an email."* Chat simply did not follow, and nothing
noticed because nothing had ever read the response.

Fixed before a client could depend on the shape, which is the only cheap moment
to do it. The projection now depends on who is reading:

* a **customer** gets `{ id, role }`. That answers both questions they have —
  is this mine, and which side is it from — and the shop's NAME is on the thread.
  Which member of staff replied is not theirs to know.
* a **business** keeps the email. They are entitled to the customer's address
  (§28.6), and on their own side it is how several members of staff (§14) tell
  each other apart in one thread.

The socket gets the **narrow** shape regardless, because one room holds both
sides and a single payload cannot be tailored per viewer. The business inbox
polls underneath, so a reply appears instantly and gains its byline a moment
later — which is the right way round.

Five tests, including one asserting `Object.keys(sender)` and one driving the
realtime publisher, because that was the path most likely to be forgotten.
Confirmed against the running backend as well: a socket client joined as the
customer and the push arrived carrying `{"id":…,"role":"BUSINESS"}` and no
address.

### 112.2 Finding one booking's conversation

Every booking is created with a thread (§21.1), and there was no way to ask for
it. The only route was to list every thread and search client-side for a matching
`appointment.id` — which works until a customer has more threads than a page
holds, and then silently opens the wrong conversation or none.

`GET /threads?appointmentId=` added, narrowed **inside** the caller's scope and
never instead of it, so someone else's appointment id matches nothing rather than
reaching their conversation. Verified: own booking returns the right thread, a
random uuid returns zero rows, a non-uuid is a 400.

### 112.3 Sending is REST, receiving is socket

§22.2's split, followed exactly. Both clients POST a message and learn about the
other side's over the socket. Neither sends over the socket, because creating a
message carries the real logic — the empty-message rule, the length limit, the
photo upload, the notification debounce — and two transports accepting messages
would be two paths that must agree forever.

Both clients also **poll underneath the socket**, and that is not redundancy for
its own sake. A phone sleeps, changes network and loses signal; a shop leaves a
tab open all day. A socket that quietly died would leave either side looking like
nobody had replied. The socket makes it instant, the poll makes it correct, and
the screen is right with the socket switched off entirely.

Two small things both clients needed: a seen-id check before appending a pushed
message, because a reconnect replays and the sender's own POST already added it —
without it every message you send appears twice; and marking a thread read tied
to messages **arriving** rather than the screen opening, so an empty thread does
not clear a badge for messages that had not loaded. Read state is per person
(§21.3), so an owner opening a thread still cannot clear it for the staff member
who has to answer it.

### 112.4 What each side shows, and what it deliberately does not

The business inbox has **no "new message" button**. A shop does not cold-open a
conversation with someone who has not contacted it — the server has no endpoint
for it either, and this is the same decision, not a coincidence.

Both lists **hide threads that have never been used**. One is created with every
booking, so a customer with ten bookings would open Messages onto ten empty
conversations and a busy shop would bury the real ones. The customer's list keeps
empty INQUIRY threads, because a customer who just opened one and has not typed
yet should still see it.

An appointment thread shows **what it is about** — the service and the date —
because eight threads with the same shop are otherwise eight identical rows.

### 112.5 The business app's websocket needed its own proxy

The REST client talks to `/api`, which Vite proxies and rewrites. A socket cannot
go through that: the rewrite strips the prefix, and socket.io serves its handshake
at a fixed `/socket.io` whatever the namespace. So a second proxy entry, with
`ws: true` — without which the proxy answers the handshake poll and never
upgrades, and the socket silently falls back to polling forever.

In development the socket connects to **this** origin and Vite forwards it, the
same one-origin trick that keeps CORS out of the picture locally; in production
`VITE_API_URL` names the backend.

### 112.6 Seen, and not seen

The customer's Messages screen renders, signed out, with its sign-in invitation.
The business app builds. The socket was driven headlessly end to end — connect,
join, receive a message the business POSTed over REST — which is the part most
likely to be wrong and the part a screenshot could not have shown anyway.

**Neither conversation was seen with messages in it.** That needs a signed-in
session on both sides at once, and §102.2 still holds. Every endpoint underneath
was driven against the live backend: thread creation and its idempotence, sending
from both sides, the empty-message refusal, unread counts moving to zero on
read, and the sender projection differing by viewer.

## 113. Every image broken on a real phone, and the way out of an account (2026-10-02)

Both found by opening the simulator and looking, which is becoming the pattern.

### 113.1 `APP_BASE_URL` was still localhost

A photo sent in a chat stored fine and served fine — at
`http://localhost:3000/uploads/chat/…`. On the simulator that works, because it
shares this machine's network. **On a real phone `localhost` is the phone**, so
that image is a broken box.

And not only chat photos. That base builds the URL of **everything anyone
uploads**: shop logos, cover images, gallery shots, ticket attachments. The API
beside them answers perfectly, which is what makes it confusing rather than
obvious — the app works and all its pictures are missing.

Exactly §108.4 again, from the other end. That section pointed the APP at this
machine's wifi address; this is the BACKEND having to know its own. `dev.sh` now
works the address out **before anything boots**, because both need it at start,
and writes it into `apps/backend/.env` as well as the app's.

**The URL is stored on the row at upload time**, so this fixes the next upload
and not the last one. Anything uploaded under a previous address keeps pointing
there. For dev data that is fine and worth knowing rather than fixing.

Verified without disturbing a running stack: a second backend booted on port
3001 with the new setting returned
`http://192.168.1.89:3000/uploads/chat/…`, reachable, where the one still
running returned localhost.

A note on method: the first attempt to verify this was wrong twice. `touch`ing a
source file does **not** make `nest start --watch` restart — it watches content,
not mtime — so two uploads came back localhost and looked like the fix had
failed. The second backend is what settled it.

### 113.2 Signing out existed and was reachable from nowhere

`signOut()` has been in the client since §102 and no screen ever called it. On a
shared phone — which in this market is most of them — an account you cannot
leave is an account somebody else is using.

The account screen says who you are, the name on your reviews, when you joined,
and offers the way out. Signing out **clears the query cache**, which is not
housekeeping: everything in it was fetched as that person, and left in place the
next person to open the app would see the last one's bookings until each query
happened to refetch.

It sits on the header's LEFT, because the right already holds the two places a
customer goes often. An account is somewhere you go rarely and need to find
instantly, mostly to get back out of it.

The display name is shown and **not editable here**, which is the honest shape
of the system rather than a gap: the name lives on the user (§31), there is no
customer-facing endpoint to change it, and the one place it is set is the review
form — because that is the only place it means anything. The screen says so.

That also closed a weakness left open in §111.3: the review form's name field
started blank because nothing told the app what the current name was.
`/users/me` carries it, so the field now shows what people will actually see
instead of an empty box and a promise.

### 113.3 What the user's own session proved

While this was being written, the simulator was signed in and driven by hand,
which settled three caveats earlier sections had to leave open:

* **a conversation with messages in it** — four messages both ways, including a
  photo sent from the business side, a path the probes had not exercised. The
  backend log shows `Pushing message:new to thread:8319… (2 socket(s) in room)`
  and the debounced email going out.
* **the review form, used by a person** — a 5-star "I enjoyed it" on Nyarugenge
  Branch, posted under the name "Jok", which is also how that name came to be on
  the account screen above.
* **a confirmed booking** — Steam room at Kimironko, deposit RWF 800 received,
  arrival code shown. That is the §109 payment path finishing on a screen, which
  is the thing the platform could not do this morning.

## 114. The last two open findings (2026-10-02)

§67 listed four things found by walking the API by hand. Two were fixed at the
time; these are the other two, open since 2026-10-01.

### 114.1 The collections log named the wrong currency

```
MoMo requesttopay accepted: ... amount=10.00 RWF ...
```

`amount` is formatted against the **outbound** currency — EUR under the sandbox
override, hence two decimals — while the code printed beside it was
`params.currency`, the real one. So the line claimed `10.00 RWF` for a request
that said `10.00 EUR`, and in a zero-decimal currency `10.00` is not even a
well-formed figure.

Now printed against `outboundCurrency`, the same value the amount was formatted
with, and the quoted currency is named alongside **when the two differ**:

```
amount=30.00 EUR (quoted in RWF)
```

Both, rather than just the outbound one, because the whole point of the override
is that they disagree (§52.1) and a reader of the log needs to see it.

Never a charging bug — the request body was always right, and the §55.2 fix that
corrected the body simply missed the log line next to it.

### 114.2 `openNow` was filtering the page, not the search

The reported symptom was a count: `openNow=true` returned **6** locations and
said `total: 7`. The cause was worse than the symptom.

`openNow` was applied as `.filter()` on the rows **after** they came back, while
`total` was the database's count and `take`/`skip` had already run. Three
separate failures from one line:

1. **`total` counted rows the filter then removed**, so a client paginating on it
   asks for a page that does not exist.
2. **A page came back short.** Twenty-five rows fetched, nineteen open, nineteen
   returned — looking to a client like the end of the results.
3. **Rows became unreachable.** `offset` skipped unfiltered rows, so a page whose
   slots were all taken by closed branches returned **nothing**, and the open
   branches behind it could not be reached at any offset.

The third is the one that matters and the one the symptom hid completely.

**The fix, and why not SQL.** Whether a branch is open right now comes from
today's template hours, today's exceptions and the clock, and that rule lives in
`openNowByLocation`. Rewriting it as a WHERE clause would put one rule in two
languages — the drift §44 moved the cheapest price into a column to avoid.

So the rule stays where it is and its *result* goes into the query: when the
filter is asked for, the candidate ids are resolved first, `openNowByLocation`
decides which are open, and those ids restrict the real query. `total`, `take`
and `skip` then all see the same set. The same shape §107's distance prefilter
already uses, and the map it produces is reused for the page's own `openNow`
flag, so nothing is computed twice. One extra query, only when the filter is
asked for.

### 114.3 Proving it, and a false negative on the way

Four tests. Under a revert to the old behaviour all four fail, each with exactly
the number the bug produces — `total` 2 where 1 is right, 5 where 2 is right, and
the unreachable page returning `[]`.

That took two goes. The **first** revert left the new short-circuit in place and
changed only the `where` clause, so two of the four still passed and the proof
was worthless. A revert that does not faithfully reproduce the old behaviour
proves nothing, and a test that passes against it is not evidence.

The first version of the paging test was also weak: with four locations and the
default name ordering, the old post-filter happened to return the right union.
Rewritten so the closed branches sit **at an offset boundary** — open, open,
shut, shut, open — which is the arrangement that makes a row unreachable rather
than merely out of order.

A note on the live check: comparing the running backend against a fixed build on
another port showed both agreeing, which proved nothing — `nest start --watch`
had already restarted the running one onto the fix. (It ignores a bare `touch`,
§113.1, but a real edit it picks up.) The tests are the evidence here, not the
two ports.

**1156 across 40.**

## 115. A billing adjustment that cannot be paid is refused by the database (2026-10-02)

§68.6, deferred since 2026-10-01 and finally answered. The answer turned out to
be different from either option that was on the table, and the tests are what
found it.

### 115.1 The question was wrong

§67's recommendation was: make the settlement columns `NOT NULL`, so the database
refuses an entry a payout run can never send. §68.6 deferred it because
`NOT NULL` applies to every row already written, and §45 added those columns to a
ledger that already had entries and could only backfill some. The question looked
like "backfill the rest, or exclude them with a partial constraint".

Neither. **A `CHECK ... NOT VALID` makes the choice unnecessary**: Postgres
enforces it on every INSERT and UPDATE from now on and does not scan what is
already there. Confirmed against Postgres rather than assumed — with a null row
already present, the `ALTER` succeeds, the row survives, and the next null INSERT
is rejected.

Backfilling was never really available anyway, and that is worth saying because
it was the obvious path. `ledger_entries` is append-only, and the
`ledger_entries_immutable` trigger names `settlementCurrency`,
`settlementAmountMinor` and `bookingExchangeRate` **specifically**. Satisfying
`NOT NULL` would have meant disabling the trigger that makes a ledger
trustworthy, in order to invent figures nobody recorded. The trigger's own error
message says what to do instead: *"Append an opposing entry."*

### 115.2 The broad version was wrong, and five tests said so

Written as §67 described it — settlement required on **every** entry — five
existing tests failed, and every one of them was right.

A `DEPOSIT_RECEIVED` entry legitimately has no settlement figure when the
appointment never went through the payment initiation that records what was
charged. Payouts already exclude those rather than convert at a guessed rate, and
that is the designed behaviour, not an oversight.

Forbidding it would put the constraint **inside the transaction that confirms a
deposit**. The write fails, the transaction rolls back, the appointment stays
`PENDING_PAYMENT` — and the operator has taken the customer's money with nothing
recorded. That is precisely what §34 means by "a confirmed deposit that failed to
reach the ledger is money the platform holds and cannot account for", and it is
far worse than an entry nobody can be paid.

So the constraint covers `ADJUSTMENT` entries alone, which is exactly what §67.5
found. An adjustment carries no such risk: nothing has moved when it is written,
so refusing one means it is simply not applied — already what §68.2 made the
service do. This is the same rule one layer down, where no bug in the layer above
can get past it.

`bookingExchangeRate` is excluded: a payout run reads only the two columns, and
the rate is context for a reader rather than something the money depends on.

### 115.3 What the tests had to be

Seven, all going through raw SQL. Prisma's own types would stop most of this at
compile time, which is exactly why they prove nothing about the database — and
the entries §67.5 found were written by code that type-checked perfectly.

One of them asserts the **opposite** of the rule: a `DEPOSIT_RECEIVED` with no
settlement must still be accepted. It is there so that widening the constraint
fails loudly rather than quietly, because the cost of widening it is a deposit
confirmation rolling back after the money has gone.

Another accepts a **negative** settlement amount. The rule is about presence, not
sign — an adjustment that takes money back is what §68's billing adjustments
write, and a constraint that refused it would break the feature it exists to
protect.

### 115.4 A rollback in the middle

The first migration was applied before the tests were run, so undoing it meant
dropping the constraint and deleting the row from `_prisma_migrations` in **both**
the dev and the test database. The test database was missed on the first pass,
which produced a failure claiming a constraint that no longer existed anywhere in
the source — worth recording, because the symptom pointed nowhere near the cause.

**1163 across 41.**

## 116. Nothing stopped anyone hammering this (2026-10-02)

The platform is feature-complete and had no rate limiting, no security headers,
and CORS open to every origin. All three are the kind of thing that is invisible
until the day it is not.

### 116.1 CORS, and being honest about what it buys

`app.enableCors()` with no arguments, since the beginning, with a comment saying
to tighten it. Now an allow-list from `CORS_ORIGINS`, empty in development
because three apps on three ports plus a simulator would make a list one more
thing to keep in step.

Worth being accurate about the gain: **CORS is not an access control.** curl, the
phone app and any server ignore it entirely, and the guards and limits are what
actually protect this API. Tokens live in `localStorage` rather than cookies, so a
hostile origin could not ride an existing session even before this. What the list
does is stop a page on another site making requests from a signed-in person's
browser, which matters for the admin and business apps. It is one fewer way in
for the cost of one environment variable, not a wall.

`helmet` alongside it, with `contentSecurityPolicy` off — this process serves no
HTML of its own except the Swagger page, which the default policy breaks — and
`crossOriginResourcePolicy` relaxed, because the upload fallback serves images at
`/uploads` that the apps load from another origin. Blocking that is §113.1's
broken pictures again from a different direction.

### 116.2 Rate limiting, and why the general ceiling is high

Nothing capped request rate at all. The OTP endpoint has a per-recipient
cooldown, which stops one address being spammed and does nothing about one
machine walking a list of thousands; every other endpoint, including the one that
asks MTN to charge a phone, had no limit of any kind.

**Express middleware rather than `@nestjs/throttler`, and not by preference.**
The Nest package has no release past 6.7.1 and ships a CommonJS build, while this
project is ESM-only because `@nestjs/common@12` is. It runs perfectly under Node
24 — verified, 5 requests through then 429 — and Jest's ESM runtime cannot
`require` it until Node 24.9, so three suites that boot the real application
stopped running. `express-rate-limit` ships both formats, and the policy reads
better in one place than scattered across decorators.

The narrow limits are where the protection is: 5/min on requesting a sign-in
code, 10/min on verifying one, 10/min on asking an operator to charge a handset,
20/min on starting a conversation. Each of those endpoints sends an email, costs
money or makes somebody's phone buzz.

**The general ceiling is 600/min, and that is deliberate.** Counting is by client
IP, and in this market that is not one person: mobile carriers here put very
large numbers of subscribers behind a handful of addresses, and a salon or an
office shares one. A limit tuned to what a single enthusiastic customer could
reach would cut off a whole neighbourhood the moment a few of them opened the app
— a failure that looks exactly like the platform being broken, and lands on the
busiest places first.

Which is also the argument for `TRUST_PROXY_HOPS`: behind a load balancer every
request appears to come from the balancer, so one busy customer would limit
everyone. Set too high, a caller can forge the header and escape the limit
entirely, so it is the number of proxies actually run rather than a guess.

Off entirely when `NODE_ENV=test`. An e2e suite is one client making hundreds of
requests in seconds from one address — indistinguishable from the abuse this
exists to stop, and a suite that fails depending on how many tests ran before it
is worse than no suite. Found by the guard-chain suite failing after the limiter
went in. The numbers are unit-tested separately and were driven against a running
build.

### 116.3 Refusing to start, rather than warning

`assertProductionReady` runs before the application is even built. It follows the
two guards this codebase already has — `MomoPaymentProvider` refuses when the
sandbox currency override is set in production, `CurrencyGuard` refuses when the
ledger holds a currency the deployment no longer uses — for the same reason: a
misconfiguration found at boot is an ops problem, and the same one found at
runtime is a customer losing something.

Every item has already cost something here, which is why these four and not a
generic checklist:

- **`CORS_ORIGINS` empty** — §116.1.
- **`APP_BASE_URL` local or private** — §113.1, the one where every image in
  every app is broken while the API beside it answers perfectly.
- **`R2_PUBLIC_URL` empty** — the local-disk fallback on a host with an ephemeral
  filesystem deletes every uploaded file on the next deploy, silently.
  `ALLOW_LOCAL_UPLOADS=true` is the way to choose that on purpose, because a
  persistent disk is a legitimate choice and must simply not be the one nobody
  made.
- **`OPENAPI_PUBLIC=true`** — a complete map of the attack surface, published.

It reports **every** problem at once rather than the first. Whoever is fixing
these is on a deploy pipeline with a slow feedback loop, and one error per
attempt is four deploys.

Pure, and takes its environment as an argument, so its tests run without booting
anything and without touching `process.env` — which under `maxWorkers: 1` would
leak into every suite after them.

### 116.4 And somewhere for the errors to point

`docs/DEPLOYMENT.md`, which did not exist. Written for someone who has not read
this file, with the reasoning behind each requirement rather than a list of keys:
what breaks, how it looks when it breaks, and the two things to do before taking
real money — validating the §115 constraint over history, and backups, because
the ledger is append-only and there is no other copy.

It deliberately does not cover choosing a host, DNS, TLS or CI. Those depend on
nothing in this codebase, and guessing at them would date faster than the rest.

**1171 across 42.**

## 117. Four things the apps could not do (2026-10-03)

Found by auditing route coverage per app, in both directions. The audit script
was wrong twice before it was right, which is recorded below because the wrong
versions were convincing.

### 117.1 A new business was told three times to do something it could not

`POST /business/locations` existed, OWNER/MANAGER-gated, and no client called it.
Meanwhile three separate pages said:

> *"Add a branch first, under Branches & hours."*

Go there and you can edit, close and reopen a branch. There was no way to open
one. A newly approved business was instructed three times to do the one thing the
app did not offer — and the only reason the platform works today is that the seed
script creates locations.

**Coordinates are the hard part**, and the reason this is not a four-field form.
They are REQUIRED on create and optional on update (§43.2): a branch with no
position never appears in a distance search, which is what §107 made the default.
But a shop owner does not know their coordinates and should not have to type
decimal degrees.

So the field takes what they already have — the Google Maps link everyone here
sends over WhatsApp to say where they are. `parseCoordinates` reads the three
shapes those links come in plus a bare pair, and names the shortened
`maps.app.goo.gl` case explicitly, because that one carries no coordinates at all
and would otherwise fail as "could not read that". There is a "use my current
position" button for someone standing in the shop, and the parsed point is shown
with a link to check it on a map before saving.

`0, 0` is refused with an explanation rather than a validator's name. The server
refuses it too (§43's Null Island check) — this is so the person reads a sentence
instead of a rule.

Twelve cases run against the parser directly, since the web apps have no test
runner. All pass, including the one that matters: a `/place/` URL carrying both
`@lat,lng` and `?q=lat,lng` resolves to the `@`, which is where the map is
actually centred.

The form also says, before the save, that **a new branch starts closed every
day** — verified, `create` writes no hours rows at all — because a business that
does not know that reads an empty calendar as the platform being broken.

### 117.2 An admin was approving businesses blind

`GET /admin/businesses/:id` returns branches, services with their per-branch
prices, and members. Its own comment says this is "more of the picture than one
number ever was" for an admin reviewing an application. Nothing called it.

So approval — the gate that makes a business visible to every customer — was done
from a table row showing a name, a category and a date.

The drawer is **read-only**. The actions stay on the row where they already are:
duplicating approve and reject inside it would be two places to keep in step, and
its job is to answer "what am I about to let in", not to be a second control
panel.

Two things it says that the data implies and a reader would otherwise have to
work out: a business with no branches means "approving this puts an empty shop in
front of customers", and a missing description is "worth asking about before
approving".

`AdminBusiness` was being returned for both the list and the detail, so the three
extra fields were invisible to TypeScript. Now `AdminBusinessDetail extends
AdminBusiness`, which is the §109 lesson applied before it could cost anything.

### 117.3 Nobody could ask for their arrival code again

`POST /appointments/:id/resend-verification-code` has existed since §53.2, with a
one-minute cooldown and a five-send ceiling. The client function was written in
the customer app. **No screen in any app called it.**

The code is emailed, and an email is exactly the thing that gets deleted. There
was no way back to it.

Driven end to end before wiring: the code genuinely **changes** — `842890` became
`085740` — so the screen invalidates the appointment rather than showing "sent"
beside a number that no longer verifies. An immediate second attempt returns *"A
code was just sent. Try again in 60 second(s)"*, which the button mirrors by
being unavailable rather than by offering something that will be refused.

The five-send ceiling is deliberately NOT mirrored: `verificationCodeSentCount`
is not exposed, and the server's refusal already says what to do instead — ask
the business to verify you in person. Widening a projection to show a number
nobody acts on is not worth it.

### 117.4 An expired session left the phone rendering errors

Both web apps have handled this since they were written, through a
`SESSION_ENDED` window event. The customer app shipped `onSessionEnded` for the
same purpose — a phone has no window events — and **nothing subscribed to it**.
So a refresh token expiring mid-use left every screen rendering with every query
failing, and nothing to suggest that signing in again would fix it.

Now it clears the query cache and routes to sign-in. Clearing matters for the
same reason it does on sign-out (§113.2): everything cached was fetched as that
person.

One real bug fixed on the way: `onSessionEnded` returned `Set.delete`'s boolean,
so it could not be used as a React effect cleanup without a type error. Returning
the subscriber's own boolean was never intended; it was the implicit return of a
one-line arrow.

### 117.5 The audit was wrong twice before it was right

Worth recording, because both wrong versions produced confident output.

**First pass**: matched calls with `api<...>(` and read the HTTP method from a
fixed 260-character lookahead. `api<Page<AdminBusiness>>(` has nested angle
brackets that `[^>]*` stops short on, so half the admin app looked unwired; and
the lookahead ran past the end of one function into the next, reporting its verb.
It claimed nine admin calls hit the wrong method. **All nine were false.**

**Second pass**: a small scanner with bracket balancing, reading the method from
inside that call's own parentheses. Zero false positives — and then three
findings that were still wrong for a different reason: `/auth/refresh` is called
with raw `fetch` inside the client, and the payout CSV export through a `download`
helper. Neither goes through `api()`, so neither is visible to a tool that only
looks there.

The lesson is the §109 one again from the other side: a tool that reads one
pattern reports everything else as missing. Each finding was confirmed by reading
the code before any of it was acted on, and three of the seven did not survive
that.

**Three things that looked like gaps and are not**, checked and left alone:
`retireService` is unused because §76 decided "Everywhere" acts on the branches
rather than the service's own flag; the operator choice is unused because
`choiceRequired` is `available.length > 1 && suggested === null` and MTN is the
only provider, so it is always false — latent, and a bug the day Airtel is added;
and the business app's copy of the `download` helper is genuinely dead, left in
place because an export is the obvious next thing to want from that app.

**1171 across 42.**

## 118. The one administrator, offered a button to remove themselves (2026-10-03)

Found by being asked a question the screen should have answered: *"whose email is
that, the primary or the secondary?"*

On a platform with one administrator the Administrators panel showed one row —
the reader's own account — with a **Remove access** button beside it, under a
heading saying "You are the primary administrator". Nothing on the row said it
was theirs.

### 118.1 The server was never at risk

`revokeAdmin` refuses twice over, and both refusals are the right ones:

```
You cannot remove your own access.
The primary administrator cannot be removed. There must always be one.
```

Confirmed live: pressing it returns **400**. So nobody could ever have locked
themselves out — the fault was entirely in offering it.

That makes it a worse kind of bug than it looks, not a better one. The
confirmation dialogue read *"They lose it immediately, even if they are signed
in"* about the person reading it, which is frightening, untrue, and the only
explanation the screen gave of a row it never identified.

### 118.2 The directory did not carry the fact it needed

`GET /admin/users` returned no `isPrimaryAdmin`, so the panel could not tell
primary from secondary, and nothing compared a row against the reader. Every row
got a button.

The flag is now on the row. It is the same rule the rest of this codebase
follows — §92.3 hides a reply control once the edit window has closed, §109's
screen stops polling when there is nothing left to wait for — **do not offer what
the server will refuse.** A disabled control teaches; a control that errors
blames the person who pressed it.

Comparing against the signed-in user's id alone would have been enough *today*,
since only the primary sees these controls at all and the primary is therefore
always the reader. The flag is there because that reasoning is a chain of three
facts, any of which could change, and the server already refuses on the flag
directly.

### 118.3 What the row says instead

"You, the primary administrator" — which answers the question that prompted this,
and would have answered it without anyone needing to ask.

A secondary administrator's row keeps its button, because that is the one case
the server allows.

## 119. Closing an account, and pausing a shop (2026-10-03)

The first of the new features, and it started with a question: *"do buyers also
need to activate and deactivate their accounts, or do they just need to delete?"*

The answer is in the foreign keys, and it is neither.

### 119.1 Nobody can delete anything here, and the schema says so

`users` is referenced with `ON DELETE CASCADE` from fifteen tables. Deleting one
person runs:

```
DELETE user
  → CASCADE appointments      (every booking they ever made)
      → CASCADE reviews       (every rating they left)
      → CASCADE threads
      → SET NULL ledger_entries.appointmentId
```

That last line is the one that matters. The ledger entries **survive and lose
what they were for** — money a business is owed, with nothing saying why. And
every business they ever reviewed changes rating because somebody else closed
their account.

This is §89 exactly, which found the same shape for branches and answered it with
`Restrict` plus a soft close. For people it is worse, because a customer's
appointments are the counterparty record of money a business has already been
paid.

So: **the row stays and the person goes.** `closedAt` is set, `displayName` is
cleared, and `email` is moved to `closed-<uuid>@closed.invalid` — a reserved
domain (RFC 2606) that holds nothing. Every review they left keeps its text and
its rating and now reads **"Anonymous"**, because §31 renders a null name that
way and the review itself was never touched.

Releasing the address is deliberate, not a side effect. The original email now
matches no row, so signing up again works and produces a genuinely new account
with none of the old one's history. Verified: the old address returns *"This
email has no account yet"*, and signing up gives a different id.

**Deactivate is a business concept, not a customer one.** A business pausing
means something — stop taking bookings, keep the shop. For a customer there is
nothing to pause: nothing of theirs is public except a review byline, and closure
is what deals with that.

Three refusals, each driven against the live backend before the screen was built:

* **a booking still to come** — *"You have 1 booking(s) still to come"*. Somebody
  is expecting them and is usually holding their deposit. Same rule §89 applies
  to closing a branch.
* **the only owner of a business** — *"Make someone else an owner first"*. Only
  an OWNER may invite, so a business left without one can never be changed again.
* **closing twice**.

Refresh tokens are revoked in the same transaction — all nine, confirmed. The
access token still works for its remaining fifteen minutes, which is the §99
window and acceptable here: the person doing this is the account's own owner.

### 119.2 The export sits on the same screen, before the close

A copy of everything — bookings, reviews, conversations and support tickets —
assembled on request rather than queued to an email. The queue, the job, the
signed link and the expiry are worth adding the day this is too big to answer in
a request, and not before. 15 bookings, 1 review and 16 conversations came back
in one call.

It is offered **above** the close button and named again inside the closing
dialogue, because the moment someone is leaving is the only moment they want it.
Messages are labelled `you` / `the business` so a reader can tell whose words are
whose without a key, and a ticket's internal notes are excluded — those are
support's working-out about a person, not a record of what they were told.

There is no id parameter anywhere in it. It reads the caller, so there is nothing
to tamper with.

### 119.3 A paused shop, which is not a suspended one

`pausedAt` on the business, deliberately **not** `status: SUSPENDED`. That is a
moderation state an admin puts a business into, with a reason the business is
told — reusing it would make a holiday indistinguishable from a sanction in every
admin listing.

The widening that mattered was `isPubliclyBookable`. It took a `BusinessStatus`;
it now takes the row and needs `pausedAt` as a **required** field. That is the
whole design: optional would let a `select` that forgot to ask for it compile
cleanly and silently skip half the check. Making it required turned up **both**
call sites immediately as compile errors — availability/booking and the shop
page were each selecting only `status`.

Driven end to end, and the second attempt is the one that proves it: the *same*
booking with a *real* service id returns **404 while paused and 201 once
resumed**. The first attempt used a bogus service id, failed on the service, and
proved nothing.

Discovery drops from 8 places to 7, the shop page 404s on a direct link, and the
count agrees with the rows — §114.2's rule applied to a filter added afterwards.

### 119.4 Two API decisions worth recording

**`POST /users/me/close`, not `DELETE`.** The name has to match what happens, and
nothing is deleted. A `DELETE` verb on an endpoint that deliberately keeps the
row is a lie told to the next person who reads the route table.

**`expo-file-system/legacy`, on purpose.** Version 57 replaced `cacheDirectory` +
`writeAsStringAsync` with `File`/`Paths` classes whose published typings expose no
text write. The legacy module is a supported export of the same package and does
exactly one thing here. Spelunking for an undocumented method and guessing is the
mistake this app's own `AGENTS.md` opens by warning about (§102.3).

**1183 across 43.**

## 120. Saved places, which is where the cart went (2026-10-03)

Asked for as "adding to cart". A cart does not fit this platform, and saying so
was worth more than building one: each booking is a specific slot at a specific
branch with its own deposit, so a basket of them would mean either reserving time
nobody has paid for, or one payment split across several businesses and a ledger
that has to be taught about it.

Offered three readings — a shortlist, several services in one visit, several
bookings paid together — and the answer was the shortlist. So this is a list of
places kept to come back to, and the screen says so by what it does not have: no
total, no checkout, no quantity. **Saving reserves nothing.** A slot is held by
booking it, and a basket that held slots would take them from somebody who was
ready.

### 120.1 A place, not a business, and never a hidden one

Keyed on the LOCATION for the same reason a search result is one (§43): a
customer saves the branch they would actually walk into, and a chain's two
branches are different answers to "where shall I go".

Saving one twice is saving it once, enforced by the unique index rather than a
read-then-write that two taps both pass — the same reasoning §21.1 used for
inquiry threads. Unsaving something never saved is not an error either: the end
state is what was asked for, and a client that lost a response should be able to
repeat itself.

Saving a branch that is not public is a **404**, not a 403. It does not exist to
a customer, and "that one is pending" leaks a moderation state.

**A saved place that stops being bookable stays in the list, marked.** Hidden, a
customer whose barber vanished would conclude the app lost it. And `bookable` is
one field rather than three, because the branch closing, the shop pausing and the
shop losing approval all mean the same thing to a customer — and two of the three
are nobody's business.

### 120.2 The field that is absent rather than false

Each search result says whether this customer saved it, and **says nothing at all
when nobody is signed in**. Not `false`: there is no answer to "have you saved
this" without a "you", and `false` renders an empty heart that cannot be filled.
`SaveButton` returns null for `undefined` for exactly that reason.

The discovery controller's own comment had already called this: *"Nothing here
varies by viewer... and so this route cannot later grow a viewer-specific branch
without one."* It grew one. The comment is updated rather than deleted, because
being right in advance is worth keeping.

One query per page, never one per row, and none at all for a signed-out caller —
the query budget §43 states out loud.

The heart is optimistic, which almost nothing else in this app is. A heart that
waits for a round trip feels broken on a slow connection, and being wrong costs
nothing. It is written into **every** cached page at once — the search list, a
filtered list, the shop's own page — because the same place appears on several
and patching one leaves the others disagreeing until they happen to refetch.

### 120.3 Five test modules needed a new provider

Adding `FavouritesService` to `DiscoveryService` broke five suites at once with
"Nest can't resolve dependencies". They construct their providers explicitly,
which is what makes a missing wire a loud failure rather than a silent `undefined`
— the cost is five edits, and the alternative is a test module that quietly
provides everything and proves less.

**1191 across 44.**

## 121. Browsing by category, and passing a shop on (2026-10-03)

### 121.1 The chips were for people who already knew what they wanted

Discovery has filtered by category since §43. The chips scroll sideways and show
about three of eight, and the **subcategories were reachable from nowhere at
all** — thirty-odd names the admin maintains (§100) that no customer could see.

So: a screen with the whole list, what each category covers in the admin's own
words, and its subcategories behind a tap. Behind a tap because eight categories
with every subcategory expanded is a wall of words, and the narrower names only
start meaning something once somebody has picked the area.

Tapping a category opens discovery already filtered. `useState`'s initialiser
runs once, which is exactly right here: the route is a **starting point**, not
something that fights the chips afterwards.

Changing or clearing a category clears the subcategory with it. "Beauty + Auto
Electrical" matches nothing by construction, and a filter that silently returns
nothing is worse than one that cannot be set.

Verified against live data: 8 places with no filter, 3 for Beauty & Personal
Care, 2 for Barbershop under it.

A note for whoever reads the demo data and panics as I did: **Automotive returns
zero, and that is the seed, not the filter.** Kigali Auto Care is filed under
"Health & Wellness / Massage Therapy". The categories were assigned at random
when the Rwanda dataset was reseeded, and it is worth fixing one day so the demo
reads as a real market.

### 121.2 A share with no link, on purpose

There is no public website, so there is nothing honest to link to. Rather than
invent a URL that 404s, a share carries the information itself — the shop's name,
its district and address, the price it starts at.

That is not a placeholder, it is the better message for this market. Somebody
forwarding a shop over WhatsApp is passing on an address, and an address works
whether or not the person receiving it has the app. The day
`EXPO_PUBLIC_SHARE_BASE_URL` names a real domain, every share gains a link and
nothing else changes.

Shop sharing sits in the header beside the heart; sharing the app itself sits on
the account screen, which is where someone is already thinking about the app
rather than about one shop.

## 122. Legal documents, written by an admin (2026-10-03)

Asked for as "a legal section with the Terms of use, privacy policy and seller
agreement", and I said the text would have to come from a lawyer. The answer was
better than the question: **the admin writes them in the portal.** That turns the
blocker into data and makes the versioning the interesting part.

### 122.1 A published version is never edited

The rule the whole feature is shaped around. What somebody agreed to has to stay
readable exactly as they read it — a privacy policy that can be rewritten under
the people who accepted it records nothing at all.

So publishing writes `publishedAt` and from that moment the row is read-only; the
server refuses an edit with a sentence saying why. A change is a **new version**,
seeded with the published text so an admin changes the sentence rather than
retyping four thousand words — which is how mistakes get in.

A draft is a row with `publishedAt` null, and there is **at most one per kind**,
enforced by a partial unique index rather than by the service's read-then-write.
Two admins pressing "write a new version" together both pass that read, and the
loser's work would vanish into a second draft nobody would find.

`publishedAt` is set once and never cleared. Unpublishing would hide the terms
somebody is currently bound by.

### 122.2 `/legal/me` was being swallowed by `/legal/:kind`

Found by driving it: the acceptance endpoint returned **500**. Nest matches
routes in registration order, `/legal/:kind` matches `/legal/me` perfectly well,
and `me` then reached Prisma as a `LegalDocumentKind` it could not parse.

Two halves to the fix, and the second is the one that matters. Registering the
specific controller first makes `/legal/me` reachable. Adding `ParseEnumPipe` to
`:kind` makes **any** future collision a 400 naming the three valid values rather
than an internal error that says nothing — a 500 from a route table is a bug
nobody can diagnose from the outside.

### 122.3 Who agreed to what, and when it goes stale

`LegalAcceptance` is keyed on the **document**, not the kind. "They accepted the
privacy policy" is worth nothing without saying which one, and keeping versions
exists so that question has an answer years later.

`onDelete: Restrict`, so a document somebody agreed to cannot be removed and
their acceptance cannot vanish with it.

Status is computed as the **highest version ever accepted**, not the most recent
acceptance. The two differ the moment somebody reads an old version afterwards,
and treating that as a downgrade would ask them to re-agree to something they are
already past. Tested.

**Nothing blocks on acceptance.** Locking a shop out of its own calendar over a
wording change would cost it the day. The apps say "this is new, please read it"
and carry the admin's one-line note on what changed, because nobody rereads four
thousand words to find the sentence that moved.

### 122.4 Who sees which

Reading is **anonymous**. Somebody deciding whether to sign up has to be able to
read the terms first — requiring agreement before reading is the thing everybody
complains about, and it is also the one thing that would make the agreement worth
nothing.

The customer app hides the **Seller Agreement**: it binds businesses, it is shown
in the business app, and a customer reading it there would reasonably think it
applied to them. The business app shows all three, because a business is bound by
the other two as well.

Plain text, not HTML or Markdown. An admin pasting from a word processor would
paste markup that two apps then have to agree about rendering, and one of them is
a phone.

**1202 across 45.**

## 123. Services you have not finished writing (2026-10-03)

Asked for as "drafts when adding services that auto save".

### 123.1 A separate table, not a flag on `Service`

The whole design, and the reason is one section back. A draft living in
`services` would be one forgotten `where` away from a customer seeing a
half-written service with no price — and §119 had just finished widening
`isPubliclyBookable` because exactly that kind of filter was missed in **two**
places at once.

A draft cannot leak out of a query it is not in. That is worth a table.

Nothing on it is validated, and nothing on it is required. A draft exists
*because* it is incomplete, so applying the service rules to it would defeat the
point — they apply when it becomes a service, through the endpoint that already
enforces them. The only rules kept are the ones that stop it being unstorable: a
length cap so a runaway paste cannot fill the table, and the right type so a
number field holds a number.

The per-branch prices are **JSON**, not rows. A draft's offers point at a service
that does not exist, and a relational shape would need its own table, its own
cascade and its own cleanup for data thrown away the moment the service is real.

### 123.2 The shop's, not one person's

Per business. A shop is a shared workspace (§21.3) — an owner starting something
and a manager finishing it is normal, and two people each holding invisible
half-finished services is how the same service gets written twice. Who started it
is recorded and shown, so it is still obvious whose work it is.

### 123.3 Where the debounce lives

In the **page**, not in the form. The form unmounts the moment it closes, and
that is exactly when the last keystroke still needs saving — a timer inside it
would be cancelled by the unmount that made saving urgent.

1200ms: long enough that typing a name is one save rather than eleven, short
enough that closing a laptop lid loses a sentence and not a service.

A failed auto-save is **silent**. An error box interrupting somebody mid-sentence
is worse than a quiet retry on the next keystroke, and nothing is lost either way
— the form still holds the text.

The draft is created **before** the form opens, so the first keystroke has
somewhere to go rather than being the one that gets lost. Closing the form keeps
it; creating the service discards it, because a draft that outlived its service
would sit in Unfinished describing something that already exists.

### 123.4 The one real delete in this codebase

§75 and §101 both ended with the same correction: things are retired here, never
deleted. Discarding a draft is the exception, and it is worth saying why rather
than letting it look like a lapse — no customer saw it, no money moved because of
it, and keeping every abandoned half-sentence forever would turn the Unfinished
list into the mess it exists to prevent.

**1208 across 46.**

## 124. A picture, and the numbers you pay from (2026-10-03)

Asked for as "logos for the business and customer apps", which I first read as
app icons. It meant per-account images — and the business half already existed
(§88, logo and cover on the shopfront). So one new thing, not two.

### 124.1 A customer's picture is for the customer

Uploaded, never a linked URL — the same rule §88 set for a shop logo: an address
somebody else controls can become anything at all after it has been accepted. It
reuses `galleryUploadOptions`, deliberately NOT §81's wider ticket-attachment
list: this is a picture, not evidence.

**Shown to them and to nobody else.** A shop needs a name to call out and an
arrival code; it does not need a face, and §112.1 had just finished removing an
email address from a chat message for the same reason. If a shop ever does need
to recognise somebody, that is a decision to take deliberately rather than one to
arrive at by leaving a column exposed.

The old file is deleted **after** the new one is stored, never before. The other
order loses the picture when the upload fails.

### 124.2 "Payment methods" that store no payment method

The feature was asked for as a payment methods section, and the honest version of
it in this market stores a **phone number**. MTN charges by prompting the
handset, so there is no token, no mandate and no credential to keep — nothing
here can be charged by anybody not holding the phone.

That is said in the model, in the migration, in the service and on the screen,
because a table called "payment methods" invites somebody to one day put a card
in it. What this actually is: a keyboard shortcut at the moment a customer is
least patient. The number still goes to the same endpoint, through the same DTO,
to the same provider.

Normalised to digits before storing, so one number cannot be saved twice wearing
different spaces — which the unique index alone would allow. The save DTO repeats
the payment endpoint's own `^\d{8,15}$` rule, so a number cannot be SAVED in a
shape that would be refused at the moment somebody tried to pay with it.

Saving after a successful payment is **best-effort and silent**. A payment that
worked must never be reported as failed because a convenience row could not be
written — the same rule the realtime push follows (§22.2) and the draft auto-save
(§123.3).

`lastUsedAt` floats the number they actually use to the top, rather than asking
anybody to rank their own phones.

### 124.3 A second test module needed a second provider

`AccountService` gained `StorageService` and the §119 suite stopped resolving —
the same failure favourites caused in §120.3, for the same good reason. Explicit
providers make a new dependency a loud error rather than a silent `undefined`,
and the cost is one line per suite.

**1208 across 46.**

## 125. Why "Add a picture" refused (2026-10-03)

Reported as "adding image to the app as profile image refuses". Two causes, both
real, and the second was sitting in a path nobody had tried yet.

### 125.1 An iPhone photo is HEIC, and the allow-list is jpg/png/webp

`ALLOWED_MIME_TYPES` has been three formats since §10 and §81 deliberately kept
it that way for shop-window images. An iPhone's photo library returns **HEIC**,
so the upload came back:

```
400 Unsupported file type "image/heic". Allowed types: jpg, jpeg, png, webp.
```

Confirmed by sending each type at the endpoint: png and jpeg pass, `image/heic`
and `application/octet-stream` do not. The second matters as much as the first —
`ImagePicker`'s `mimeType` is optional, and React Native sends
`application/octet-stream` when it does not know, which the same list refuses.

**Widening the server would have been the smaller change and the wrong one.** A
HEIC profile picture renders in neither web app, because browsers do not support
it. §88 wanted shop-window images that display everywhere, and a picture nobody
can see is not a picture.

So the conversion happens on the phone — the only place that can read HEIC.
`expo-image-manipulator` re-encodes to JPEG before upload, and whatever came out
of the library, what leaves `pickImage` is a JPEG and says so. That fixes the
unknown-type case too, because the type is no longer guessed at all.

JPEG rather than PNG: a photograph is what this is for, and a PNG of one is
several times the bytes over what is usually somebody's mobile data.

### 125.2 The same bug was in chat, unhit

`app/thread/[id].tsx` did this:

```ts
type: asset.mimeType ?? 'image/jpeg',
```

which looks careful and is exactly the problem — it passes HEIC straight through
when the picker reports it. **Every photo a customer tried to send in a
conversation would have been refused**, and nobody had found it because the only
photo ever sent in chat came from the business side, in a browser (§112.6).

One `pickImage` now serves both, so the two cannot drift again.

### 125.3 What is not yet known

No upload attempt appears in this backend's log, so the fix above is the cause of
**a** refusal, and whether it is the one that was hit is not established — the
attempt may predate the running instance, or have failed at the permission prompt
before any request was made.

The permission path now explains itself rather than throwing a bare error, so
whichever it was, the next attempt says something useful. Worth asking what the
message actually said rather than assuming this closed it.

**1208 across 46.**

### 125.4 The real cause: Expo's fetch cannot carry a React Native file

§125.1 found a true bug and fixed it. It was **not** the one being hit. The
phone's actual message was:

```
Unsupported FormDataPart implementation
```

which is thrown by `expo/src/winter/fetch/convertFormData.ts`, not by the server
and not by React Native. The mechanism, read rather than guessed:

Expo installs a WinterCG `fetch`, and patches React Native's `FormData` so it has
an `entries()`:

```js
formData.entries = () => formData.getParts().map((part) => {
  if (part.string) return part.string;
  if (part.file)   return part.file;
  if (part.blob)   return part.blob;
});
```

A React Native file part is `{ uri, name, type, headers, fieldName }` — none of
those three keys. The map returns **undefined**, the loop below reaches its
`else`, and throws. `ExpoFormData` even declares
`append(name, { uri, name?, type? })` as a supported overload; the converter
simply does not implement that branch.

So `{ uri, name, type }` — React Native's own file convention, correct for a
decade — cannot be uploaded through Expo's `fetch` at all.

The fix is to stop using `fetch` for files. `File.upload()` from
`expo-file-system` builds the multipart request natively: no FormData, nothing to
convert, nothing to fall through. It takes the field name, the mime type, the
headers and extra form parameters, which is everything both call sites needed —
including the chat message's text riding alongside its photo.

**Three things this says about the evening.** The first fix was real and
unprompted by evidence I had: no upload ever reached the server, which I noted in
§125.3 rather than claiming it closed. The actual error named its own file, and
reading that file took minutes where guessing had taken an hour. And the bug was
in a dependency's handling of a shape its own types advertise — the kind that
cannot be found by reasoning about one's own code.

**1208 across 46.**

### 125.5 It was uploading the whole time

Reported as "still can't get uploaded". It had been uploading for an hour. The
evidence was on disk:

```
uploads/users/4c3b5684-.../8b77db7a-....jpg   23:48
uploads/users/4c3b5684-.../8b77db7a-....jpg   23:49
```

Two attempts from the phone, both stored, both 200, the URL serving `image/jpeg`
over the LAN address, and `imageUrl` set on the row.

**`GET /users/me` did not return `imageUrl`.** The column was added to the model
(§124.1) and to the client's `Me` interface, and never to the one hand-written
`select` that feeds the account screen. So `me.data.imageUrl` was permanently
`undefined`, the screen rendered the empty circle every time, and a feature that
worked end to end looked like it failed.

This is §109 again, in the third place it has appeared: a hand-written projection
missing a field the client's own type promises. The §109.6 trigger said the next
instance would be the one to act on the pattern rather than the instance. **This
is it**, and it is recorded here as a debt rather than fixed in passing, because
retrofitting response DTOs across 110 endpoints is its own piece of work and not
something to start at midnight inside a bug report.

### 125.6 "There is no upload button"

The other half of the report, and not a bug: on Android the picker's own crop
screen is the final step and its confirm button says **"Crop"**. Nothing is
labelled upload or add, so tapping Crop and then looking around for the real
button is the correct reading of what is on screen.

The screen now says so, and says "Uploading…" while it works. A silent no-op was
also possible — backing out of the picker returned `null` and the handler did
nothing at all, which is indistinguishable from a failure. Both ends of that now
speak.

**Three bugs, one report, and only the third was the one being hit.** §125.1's
HEIC refusal is real and would have struck any iPhone. §125.4's
`Unsupported FormDataPart` was the error actually on screen. This one was behind
both, and would have been found an hour earlier by checking `uploads/` before
theorising.

**1208 across 46.**

## 126. Acceptance, asked for at the three moments it means something (2026-10-04)

§122 built the documents and deliberately blocked nothing. Asked to go further:
acknowledge at sign-up, prompt existing people when a version changes, and stop
a business posting a service until it has agreed.

The shape that falls out is **one hard gate and two soft ones**, and which is
which is the whole design.

### 126.1 A new account accepts as it is created, on the server

Recorded in `verifyOtp`, not left to the client to post afterwards. The
registration screen will not continue without the tick, so the acknowledgement is
real — but a record that depends on a second request is missing whenever that
request fails, and this record exists precisely to be produced years later.

Exact versions, by id. "They accepted the terms" is worth nothing without saying
which (§122.3). A business accepts the Seller Agreement at the same moment: it is
registering to trade under those terms, and asking again a minute later would be
asking twice for one decision.

It never throws. An account with no acceptance row is caught by the prompt on
next open; an account that **failed to be created** because a consent row would
not write is a person who cannot sign in at all.

### 126.2 The tick is explicit, and the documents open before it

Not "by continuing you agree" in grey text under a button. A checkbox that gates
the button, with both documents reachable **from that screen** — being asked to
agree to something you cannot open is what makes consent worthless.

Only on the registration step. Somebody logging back in agreed when they joined,
and asking at every sign-in turns a meaningful tick into a reflex.

### 126.3 A changed document interrupts, and blocks nothing

The customer app shows a modal with no close button — a notice that can be swiped
away is one nobody reads. It still blocks nothing: read, agree, or "Not now", and
everything keeps working.

That asymmetry is the point. Stopping somebody mid-booking over a wording change
would cost them the slot they were about to take. The business app gets a
**banner** rather than a modal for the same reason, one step further: a shop
opening its appointments on a Monday morning should not meet a dialogue.

It only prompts people who agreed to an **older** version. Somebody who has never
agreed is a new account, and §126.1 already recorded them — prompting them would
be asking twice.

The change note comes before the document, because nobody rereads four thousand
words to find the sentence that moved.

### 126.4 One hard gate, on the server

Listing a service is a business holding itself to the Seller Agreement, so that
is the one action worth stopping outright.

**Enforced in `ServicesService.create`, not in the screen.** A gate that lives in
a client is a suggestion: the API is reachable with curl, and the record of who
agreed is the only thing that makes any of this mean anything. Driven live:

```
create a service, unaccepted  -> 403 "Please read and accept the Seller
                                      Agreement (version 1) first."
after accepting               -> 201
after v2 is published         -> 403 "...(version 2) first."
```

Three narrowings, each deliberate:

* **Create only, never update.** Blocking an edit would trap a shop with a wrong
  price it cannot correct.
* **Nothing published means nothing to accept.** Refusing then would lock a
  business out of its catalogue over a document that does not exist.
* **Asked before the form opens**, not after it is filled in. Making somebody
  write a whole service and then telling them they cannot post it is the worst
  possible moment to raise this — and accepting carries them straight on to what
  they were doing rather than returning them to the start.

### 126.5 Four more test modules

Adding `LegalService` to `ServicesService` broke three suites and five module
lists. Third time this session (§120.3, §124.3), and the same conclusion each
time: explicit providers turn a new dependency into a loud failure rather than a
silent `undefined`, and one line per suite is the price.

**1213 across 46.**

## 127. The demo data said a car mechanic was a masseuse (2026-10-04)

Noticed while building the browse-by-category screen (§121.1): Automotive
returned zero places, and Kigali Auto Care was filed under **Health & Wellness /
Massage Therapy**. A tailor was under Pet Grooming, a gym under Portrait
Photography.

### 127.1 An index into an alphabetical list

```ts
const categoryFor = (index: number) => categories[index % categories.length];
```

Each business carried a `categoryIndex` — its position in the file. So every one
got whatever category happened to sit at that index once the taxonomy was ordered
by name, and the assignment was arbitrary by construction.

Nothing was broken by it. The filter worked perfectly on nonsense, which is why
it survived until a screen made the nonsense visible — a browse list is the first
thing that reads the data as a human would.

Named lookups now, and they also fail loudly: an index silently picks a different
category when the taxonomy is edited, while a name that no longer exists stops the
seed and says which one.

### 127.2 The reset had been broken since §89, unnoticed

Re-running the seed failed before it wrote anything:

```
Foreign key constraint violated: appointments_locationId_fkey
```

The script deleted business profiles under a comment reading *"Cascades take
locations, services, appointments, ledger entries, reviews, tickets and payout
destinations with them."* That was true when it was written, and **§89 made it
false on purpose** — `Appointment.locationId` became `onDelete: Restrict`
because the cascade was silently deleting every booking ever made at a branch and
orphaning the ledger entries recording the money.

So the demo seed has been unrunnable for a fortnight and nobody found out,
because nobody re-ran it. A comment describing a cascade that no longer exists is
worse than no comment: it is the reason the one-liner underneath looked fine.

### 127.3 And then the ledger refused as well

With appointments deleted explicitly, the next layer spoke:

```
ledger_entries is append-only: ... appointmentId ... cannot be changed after
insert. Append an opposing entry instead.
```

`ledger_entries.appointmentId` is `SET NULL` on delete — an **UPDATE** — and the
immutability trigger names that column. The database refuses to let an
appointment lose its money record.

Which is right, and makes wiping demo data the one job that has to take the
ledger apart deliberately. The trigger guards UPDATE, not DELETE, so removing the
entries outright is allowed — and is what "this never happened" actually means.

### 127.4 The gate caught its first caller, and it was mine

Then §126.4 refused the seed:

```
403 Please read and accept the Seller Agreement (version 2) first.
```

The script creates users with `prisma.user.create` rather than through the OTP
flow, so it goes around the one place that records acceptance. The gate working
on its first outing, on the only caller that uses the back door.

Fixed by having the seed accept as it registers, which is what a real business
does — rather than making the seed an exception to a rule whose whole value is
being universal.

### 127.5 What it reads like now

```
Kigali Auto Care   -> Automotive       / Car Repair & Mechanic
Kigali Barbers     -> Beauty & Personal Care / Barbershop
Nyamirambo Salon   -> Beauty & Personal Care / Hair Salon
Remera Nails       -> Beauty & Personal Care / Nail Salon
Kimironko Spa      -> Health & Wellness / Massage Therapy
Gikondo Fitness    -> Health & Wellness / Personal Training
Kicukiro Tailors   -> Home Services     / Carpentry & Furniture Repair
Kacyiru Studio     -> Photography       / Portrait Photography
```

Browsing by category returns 4 under Beauty, 1 under Automotive, 1 under Health —
and Health has two businesses, because Gikondo Fitness is SUSPENDED and Kicukiro
Tailors is PENDING, both by design so the moderation queue has something in it.
Checked rather than assumed, since a missing business is exactly what a broken
filter looks like.

**1213 across 46.**

## 128. Response contracts, and the machinery that makes them true (2026-10-04)

§109.6 said the pattern would be worth fixing the next time a client read a field
that was not there. It happened twice more — §117's admin detail, §125's profile
picture — so this is that work, starting with appointments.

**The measurement first.** 7 of 156 operations described a response. 112
hand-written response types across the three clients, 7 derived from the
contract. Every one of those 112 is a guess nothing checks.

### 128.1 A DTO that cannot drift

Writing a class per response is the obvious move and, done naively, is **the same
guess moved one directory**: a DTO sitting beside a query can disagree with it
exactly as a client's interface could.

So each one is checked against the query it describes:

```ts
type AppointmentPayload = Serialised<
  Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>
>;

export class AppointmentDto implements AppointmentPayload { … }
```

The select moved out of the service into `appointment-select.ts` to make that
possible. Proved it bites before trusting it: adding `verificationCodeSentCount`
to the select and not the class fails the build, naming the field.

`Serialised<T>` is the piece that makes it honest. A DTO describes **the wire**,
not the row, and the two differ in two places that have each already cost
something — a `Date` arrives as an ISO string, and a `Prisma.Decimal` arrives as
a string too (`"15"`, never `15`, which is why §56 reads it and never multiplies
it). Declaring `Prisma.Decimal` on a DTO also breaks the contract outright: it is
a class with no enumerable properties, so the generator emitted a nameless empty
schema and **refused the whole document**. §60 built that check and it earned its
keep on first contact.

Inline object types do the same thing — `location!: { id: string; … }` compiles
and produces a nameless schema. Named classes, which a client wants to import
anyway.

### 128.2 It found a bug three minutes after it existed

The moment the customer app derived its type:

```
Property 'verificationCode' does not exist on type { … 24 more … }
```

I had annotated `GET /appointments/:id` with the LIST shape. The detail read uses
`CUSTOMER_APPOINTMENT_SELECT`, which names the arrival code; the list projection
deliberately does not (§54.2). A third class fixed it — and the mistake was mine,
made minutes earlier, caught by the machinery built to catch exactly it.

That is the argument for the remaining work in one line. The same mistake made by
hand, in a client, is an evening.

### 128.3 Where this stands

Appointments done: nine endpoints describing their responses, and all three
clients deriving `Appointment` from the contract rather than declaring it.

**149 operations remain undescribed.** This is incremental on purpose — each
module is a vertical slice that ends with a client deriving its types, because
that is the step that finds things. A pass that only added DTOs would leave the
clients still guessing and prove nothing.

**1213 across 46.**

### 128.4 Responses that are built, not selected

Appointments could be checked against `Prisma.GetPayload<{select}>` because the
service hands the row straight back. Discovery does not: it flattens the
district, rounds a distance, attaches an indicative figure and adds `saved` only
when somebody is signed in. There is no payload type to compare against.

So the other direction — the **service declares the DTO as its return type**, and
TypeScript checks the implementation against the class. Same guarantee, opposite
way round, and the only one available when a response is assembled.

It found something immediately: `ApproxSettlement.rateAsOf` was a `Date` in
memory and a string on the wire. Nothing did arithmetic on it — it is shown
beside an indicative figure so a reader can judge how old the conversion is — so
it is now a string **end to end**. Carrying a `Date` through meant the in-memory
shape and the response shape differed by exactly one field, which is enough to
need a bridge between them for no gain.

### 128.5 One include, not two

The first version of `BusinessLocationDto` compiled perfectly against a copy of
the service's `include` that I had pasted into the DTO file. It would have
drifted the first time either changed, which is exactly the failure this whole
section exists to prevent — and it compiled, so nothing would have said so.

The include is now **one exported constant**, used by the query and by the type
the DTO is checked against. A relation added to that query without a field added
to the class fails the backend build; a field removed from the class fails the
client's.

### 128.6 Where this stands

**17 of 156 operations describe a response**, up from 7. Appointments, discovery
and business locations are done, and the clients derive nine types from the
contract rather than declaring them.

139 remain, and the remaining work is mechanical rather than uncertain: the two
patterns above cover every case, and `Serialised<T>` and the shared selects are
written once. The grind is real — `/admin` alone is 57 operations — but each
module is a slice that ends with a client deriving its types, because that is the
step that finds things rather than the step that adds files.

### 128.7 Two classes, one schema, silently

`BusinessServiceDto.locations` generated as an offer with **no `isOffered` and no
`location`** — and nothing said so. The business app's own services page simply
stopped compiling against its own data.

The cause: `create-service.dto.ts` already exports a `ServiceOfferDto` for the
request body. **OpenAPI schema names are global.** Two classes with one name are
one schema, the generator keeps whichever it saw, and the contract then describes
the wrong shape to every client.

Renamed to `ServiceOfferedAtDto`, and the generator now **refuses to write a
contract containing a duplicate name**. It cannot be detected in the document —
the duplicate has already collapsed to a single entry by then — so the check
reads the source for `export class …Dto` and groups by name. Proved it fires by
adding a colliding class and watching the build stop, naming both files.

That is the second guard this file has earned, beside §60's empty-schema check:
both exist because a contract that generates and is wrong is worse than one that
does not generate, since it looks finished.

The find is also the argument for the whole exercise restated. A hand-written
client would have declared `isOffered` happily, read `undefined` forever, and
shown every paused service as live — §109 again, in a place nobody was looking.

### 128.8 `string` where the server only ever sends four values

`BusinessProfileDto.status` was written as `string` and compiled — until the
`implements` check against the Prisma payload rejected it: the column is a
`BusinessStatus`.

Worth more than it looks. `string` is not wrong so much as useless: it hands
every client "any text at all" where the server sends one of four values, so a
screen can carry a branch for a status that cannot happen and none for one that
can. The business app had `status: string` hand-written for exactly as long.

A loose type is the same failure as a wrong one, arriving quietly.

### 128.9 Dates, and where a response is assembled

Appointments return `Date` objects and Nest serialises them; the DTO says
`string` and `Serialised<T>` bridges the two. That works because the service does
not declare its return type — Prisma's payload does.

A response that is **built** declares its own shape, and then the two must agree
exactly. Rather than bridge them, the two such fields found so far —
`ApproxSettlement.rateAsOf` and `SavedPlace.savedAt` — are ISO strings **at the
source**. Nothing does arithmetic on either; both are shown. One shape beats two
shapes and a conversion between them.

### 128.11 A third kind: spread the row, join a little on top

Payouts fit neither pattern. The admin list spreads a whole Prisma row and joins
the business name and the destination on top, so it is **selected and built at
once**: the dates arrive as `Date`, but three fields exist on no Prisma model.

Declaring a return type would mean converting seven dates by hand, in a method
whose job is not formatting. So it is checked the other way instead:

```ts
class AdminPayoutDto extends PayoutDto implements Serialised<PayoutWithProfile>
```

`PayoutDto` is the bare row three other routes already return — `send`,
`mark-paid`, `mark-failed` — so describing it once covers four responses. The
`extends` is what keeps the admin shape honest about the fourteen fields it
inherits; Swagger flattens it, and the generated schema has 18 properties where
the parent has 14, which is how we know the inheritance survived.

The rule this settles: **a response is checked against Prisma's payload unless
the service assembles it from nothing.** Declaring a return type is for the
latter only. `listForBusiness` carries a comment saying exactly that, because the
obvious-looking `Promise<BusinessPayoutPageDto>` does not compile and the reason
is not obvious.

### 128.12 `PauseReason` was `string`

The console typed it `export type PauseReason = string` while the server has only
ever sent two values. Deriving it tightened it to the enum — the same quiet
widening as §128.8, now twice, which is why no client type here is hand-written
any more.

Two vocabularies showed up for one idea while doing this: a run reports
`SUSPENDED` / `NO_VERIFIED_PAYOUT_DESTINATION`, a balance reports
`BUSINESS_SUSPENDED` / `DESTINATION_NOT_VERIFIED`. Both are now in the contract
and visibly different. **Left alone deliberately** — they are two separate
published enums and renaming either is a breaking change made for tidiness, not
for a reader who is stuck. Noted here so the next person knows it was seen.

### 128.14 A response that says `{"type": "object"}` and nothing else

Counting what was left revealed something worse than an undescribed response.
**Twenty-three operations carried a schema of `{"type": "object"}`** — no `$ref`,
no properties, just the word "object". That is what the Swagger plugin emits for
a handler it cannot infer, and it is a response that LIES: the contract asserts
a shape, and a client generated from it receives `Record<string, never>`, a type
that permits no field and explains nothing.

The §60 guard never saw them. It inspects `components.schemas`, and these are
inline on the operation, belonging to no named schema at all. One of the
twenty-three was `GET /users/me` — the endpoint whose missing `imageUrl` cost an
hour of §125.

So a third generator guard, built as a **ratchet** rather than a wall: the known
ones are listed in `generate-openapi.ts` and the build fails on any operation
NOT on the list. It also fails on a stale entry — an operation that now
describes itself properly but is still listed — because an allowlist nobody
prunes is how a ratchet stops ratcheting. Both halves were proved to fire before
being trusted, and the stale half then fired for real, on this very commit,
after `/users/me` was fixed.

Twenty-one entries remain. Deleting the last one should be followed by deleting
the list.

### 128.15 `{ message: string }`, written out eleven times

Removing a saved number, revoking an invitation, closing an account: all answer
with a sentence meant to be SHOWN to the person who pressed the button. Each
client wrote the shape inline at every call site. Now `ActionMessageDto`, named
once.

### 128.16 `implements` is only half a check

The important finding of this slice, and it invalidates an assumption §128 was
built on.

`implements` requires a class to have AT LEAST the payload's members. It says
nothing about members the payload does NOT have. So a field dropped from a
`select` leaves the DTO still declaring it, the contract still promising it, and
all three clients still typing it — **the exact shape of the §109 and §125 bugs**,
both of which were a response missing a field its own published type claimed.

Proved, not reasoned about: deleting `imageUrl: true` from `ME_SELECT` left the
build green and `GET /users/me` went on advertising a picture it no longer
returned. Deleting `currency: true` from `APPOINTMENT_SELECT` did the same.

Hence `NoExtraFields<Dto, Wire>` in `common/serialised.ts`, used BESIDE
`implements`, never instead of it — together they pin the shape from both sides:

```ts
export class FooDto implements FooWire {}
export const __fooIsExact: NoExtraFields<FooDto, FooWire> = true;
```

It names the offending field in the error. Retrofitted to every DTO written so
far; re-running both deletions now fails the build, naming `imageUrl` and
`currency`.

The lesson is older than this section: **a check not seen to fail is not known to
work.** The same mistake as §114.2's unfaithful revert, found this time because
the proof was run rather than assumed.

### 128.17 Three DTOs assumed a business always has a name

`BusinessProfile.name` is nullable — a profile exists from registration and is
named at the first save. `MeBusinessDto`, `AdminUserBusinessDto` and the data
export's `conversations[].with` all declared it `string`. The compiler found all
three.

Also fixed while there: `role` and `status` fields typed `string` where enums
exist, the §128.8 widening for a third time.

### 128.18 Two shapes for one resource, twice

Describing the users module exposed two endpoints answering with a narrower row
than their sibling:

- `POST /users/me/payment-numbers` selected 4 fields where the listing selects
  6. The customer app typed BOTH as the 6-field `SavedNumber`, so `createdAt`
  and `lastUsedAt` were promised and absent.
- `POST /admin/users/invite` returned the whole row; the listing returns a
  narrower one with the inviter's address joined.

Both now use the listing's select, so one DTO describes each pair. Chosen over
publishing two schemas: the clients already believed there was one shape, and
they were right about what it should be.

Neither was reachable yet — no screen consumes either response — so this is a
bug prevented rather than fixed. `PATCH /admin/users/{id}/display-name/clear`
was a third: the console typed it as returning a full directory row, counts and
all, where the server answers with three fields.

Checked and deliberately not changed: `POST /admin/users/invite` returns the
invitation row unselected, which would be a leak if an invitation carried a
token. It does not — invitations are matched by EMAIL ADDRESS at registration —
so every field on it is safe to show the administrator who sent it.

### 128.20 Percentages and rates are strings, and stay strings

`platformFeePercentage` is `toFixed(2)`; the exchange rate is `toFixed(8)`.
Both are published as STRINGS, and the DTOs say so. A Decimal rendered to a
float is the §55.2 mistake moved somewhere new — and these two numbers are what
every booking's fee and every deposit conversion are computed from.

Three dates became ISO strings at the source, per §128.9: the fee's `updatedAt`,
the rate's `exchangeRateUpdatedAt` and `heldTotals.asOf`. All three were already
strings on the wire — Nest serialises a Date that way — so nothing changed
except that the types stopped disagreeing with reality.

### 128.21 A union that had to stay a union

`WalletBalance` is a discriminated union: a wallet reported `OK` carries an
amount and a currency, one reported `UNAVAILABLE` carries a reason instead. The
easy move is one class with everything optional, which would let a client read
`reportedAmount` off an unavailable wallet and get `undefined`.

So it is published as two schemas under a `oneOf`, registered with
`@ApiExtraModels` because nothing references them by type directly. The generated
client gets a real union back, and the console derives
`WalletBalance = Reconciliation['wallets'][number]` from it.

`notComparableReason` came through as its four-value enum, which matters more
than it looks: `comparable: false` with `difference: null` is only useful if the
reason is readable, and §87 exists entirely to refuse to show a difference that
would be a lie.

### 128.22 One optional-field type standing in for two real ones

The console had a single `CurrencyTotal` with `entryCount?` and
`reportingInternalMinor?` both optional, used for two genuinely different
shapes: the held totals, which count entries, and a filtered page's totals,
which do not. Optional fields were how one type covered both.

Worse, it typed `settlementCurrency: string` for both — and the filtered total
is grouped by a NULLABLE column, so that one really can be null. A page reading
it as a string would print "null" as a currency code beside a money figure.

Now two derived types, `HeldCurrencyTotal` and `FilteredCurrencyTotal`, each
honest about its own fields. Nothing in the console read the optional ones, so
again a bug prevented rather than fixed.

### 128.24 One include, not three — again

`GET /business/locations` used the shared `LOCATION_INCLUDE`. `POST` and `PATCH`
each carried their own inline `{ hours: ... }`, so creating or editing a branch
answered WITHOUT the district and without the media count that the listing
returns and that `BusinessLocationDto` declares.

The §128.5 finding, three more times in one file. All three now use the one
constant, which is also why the ratchet's allowlist lost two more entries.

Not reachable: `NewBranchForm` and the hours page both discard the response and
refetch. A bug prevented, not fixed — but the next screen to read that response
would have found a missing address.

### 128.25 Capacity answers with four fields, not a location

`PATCH /business/locations/{id}/capacity` returns `{id, name, capacity,
updatedAt}`. The business app typed it as a full `Location`, promising hours, a
district and a media count the route has never sent. Its own DTO now.

### 128.26 A POST documented as 200 that answers 201

The mistake of this slice, and it was mine.

Nest answers a POST with **201** unless `@HttpCode` says otherwise.
`@ApiOkResponse` writes a **200** into the contract, and the 201 vanishes from
it. A generated client then holds a type for a status the server never sends and
none for the status it does — so the response reads as `undefined` at the call
site, for a reason nothing in the client explains.

**Eight routes had it**, and one of them — `POST /appointments` — since the very
first §128 commit. It is invisible in the finished document, where a 200 entry
looks exactly like a deliberate one, so a fourth generator guard reads the
source instead, as the duplicate-name guard does. Proved to fire.

The lesson is the §128.16 lesson again: the contract was wrong in a way that
only showed up when something was generated from it and USED. Describing a
response is not the same as describing it correctly, and only a check that runs
tells the two apart.

### 128.27 Two response decorators on one route

Found by the guard above, not by me. Annotating routes in bulk re-annotated six
that an earlier slice had already done. The generator keeps one and discards the
other, silently, exactly as it does for duplicate schema names (§128.7).

Five pairs were identical and harmless. One was not: `isArray: true` against
`type: [Dto]` for the same DTO, where which one survived decided whether the
contract said "a location" or "a list of locations". A fifth guard now refuses
adjacent response decorators, also proved to fire.

### 128.29 Two responses whose shape depends on who is asking

Chat messages hide the sender's email from a CUSTOMER viewer (§112.1). Ticket
messages hide `isInternal` from a REPORTER, and filter internal notes out
entirely. In both cases the SAME endpoint returns a different shape depending on
the caller's role.

Published as an OPTIONAL field with the reason written beside it, rather than
two schemas under a `oneOf`. A `oneOf` needs a discriminator, and here the
discriminator is the viewer's role, which is not in the payload — a client could
not tell the two variants apart from the response alone.

The business app genuinely is always the business viewer, so it narrows
`email` back to required in ONE place, with a comment, rather than making every
screen handle an `undefined` that cannot occur there. The customer app simply
never reads the field.

### 128.30 `implements` was half a check; the fix was half a fix

§128.16 added `NoExtraFields` to catch a DTO declaring a field its `select` no
longer provides. It compared **top-level keys only** — which left nested DTOs
open to the very bug it was written to stop, because a class with an extra
property is still assignable to an interface without it.

Going deep found it immediately: **`LocationHoursDto` and `LocationDistrictDto`
published four timestamp fields that exist on NEITHER model.** `LocationHours`
has no `createdAt`; `District` has no `updatedAt`. The contract has been
promising them, and all three clients typing them, since §104.

`ExtraFieldPaths<Dto, Wire>` now recurses through objects and arrays and
compares nullable fields by their underlying shape. Proved by deleting a NESTED
field — `location.address` from `APPOINTMENT_SELECT` — and watching three DTOs
fail at once, naming it.

The shallow version was deleted rather than kept beside the deep one. Two ways
to make the same assertion is an invitation to reach for the weaker one.

### 128.31 `attachments` on the list that never carried it

Both the business and admin consoles declared `attachments` on the ticket LIST
type. `TICKET_SELECT` does not select attachments — only the detail read does.
The comment above the field in one client even said "verified against the
running server", which it had been: against the DETAIL endpoint.

It is on `TicketDetailDto` only now. Nothing read it off a list row, so once
again a bug prevented rather than fixed — but a support queue that tried to show
a paperclip would have found nothing there.

Also aligned: the ticket list's message select is shared with the DTO that
describes it, and the chat message select — identical in `listMessages` and
`sendMessage` — is now one constant (§128.5, for the fifth time).

Deliberately NOT aligned: posting a ticket message echoes a narrower shape than
the listing, and it stays that way. The attachments are stored after the
message's transaction commits, so selecting them there would reliably return an
empty list and read as a failed upload. It has its own DTO saying so.

### 128.33 Reference data, and a flag that is always true

The public category list publishes no `isLive`. Everything in it is live by
construction, and a field saying so invites a client to filter again on
something that cannot be false.

Its admin sibling publishes `effectivelyLive` — `isLive` ANDed with the parent's
— rather than leaving a console to work it out. A live type under a hidden
category is not reachable, and a screen showing it as "on" would be telling an
administrator the opposite of the truth (§100).

### 128.34 Five responses that change shape by viewer, not by data

By the end there were five, all the same pattern and all now published as
optional fields with the reason written beside them:

- a chat message's `sender.email` — hidden from a customer (§112.1)
- a ticket message's `isInternal` — hidden from a reporter
- a review's `customer` identity — only for the counterparty business and admins
- a payout destination's full `msisdn` — only for the OWNER (§48.5)
- a shopfront's `saved` — ABSENT for a signed-out reader, because there is no
  answer to "have you saved this" without a "you" (§120)

None is a `oneOf`, because in every case the discriminator is the caller's role,
which is not in the payload. A client cannot tell the variants apart from the
response alone, so a union would be a lie about what it can know.

### 128.35 `*-response.dto.ts` already meant something else

A near-miss worth recording. `src/reviews/dto/review-response.dto.ts` existed,
and it is a REQUEST body: the business's public reply to a review. I read the
filename as "HTTP response DTO" and overwrote it.

TypeScript caught it on the next compile, and git had the original. The response
DTOs live in `review-read.dto.ts` now. The lesson is small and general: a
filename is not a convention until it is one everywhere, and this repo has
exactly one file where `response` means something else.

### 128.36 Every rate is null, never zero

The analytics response has four of them — completion, cancellation, no-show, and
the average rating — and all four are null on an empty period. "No appointments"
and "0% completed" are different claims, and a dashboard that conflates them
tells a brand-new business it is failing (§28.5).

Both money totals that can be incomplete carry a `complete` flag AND a
sentence. A partial figure that does not announce itself is the number a
business acts on once and then stops trusting.

### 128.37 One column, two formats, on two endpoints

A schedule exception's `date` is a calendar day. The business's own endpoint
formats it `YYYY-MM-DD`; the public shopfront passes the row through, so the
same column arrives as a full ISO timestamp.

Both are now in the contract and visibly different, with the discrepancy written
on the DTO. **Left as it is deliberately** — either side is a breaking change
for a client already parsing it, and this is the §128.12 rule again: describing
a wart is not the same as having licence to fix it.

### 128.38 Two flattened admin views, for the same reason

`AdminReviewDto` and `AdminAppointmentDto` both lift names out of their
relations and put them side by side, rather than reusing the customer-facing
DTO. A moderation screen answers "who, about which branch of which business, and
can I still act on it" — and a console that had to walk three nested objects to
draw one row would be drawing it wrong.

Both also publish a `can…` flag mirroring exactly what the corresponding PATCH
would refuse, so the console can stop offering an action the server declines
(§118).

### 128.39 The ratchet reached zero

`KNOWN_HOLLOW_RESPONSES` started at twenty-three and came down with each slice.
Deleting the last entry broke the build — `new Set([])` infers `Set<never>` — in
exactly the way the comment above it had predicted: "Deleting the last entry
should be followed by deleting the list."

So the ratchet became what it was always meant to become: a flat rule, nothing
grandfathered, no list to go stale.

### 128.40 Two findings from deriving the last client types

Switching the remaining hand-written types over found two more:

- **`AdminPayoutDestinationDto` was missing `businessProfile`.** Mine, written
  the same day: the admin list joins the business's name and phone so an admin
  can ring to verify a number without opening another screen, and the console's
  page reads it. The DTO did not declare it. Four compile errors in a page I had
  not touched.
- **The hours form built synthetic rows without `locationId`.** Harmless, but it
  meant an unsaved day had a different shape from a saved one. Now identical.

### 128.41 "Has no properties" was the wrong test

Probing the hollow guard to prove it still fired revealed it did NOT, for an
annotation removed from `GET /notifications`: the plugin inferred the page shape
INLINE, with real properties, which passed a no-properties test while still
generating an anonymous type no client can name or re-use.

The rule is now the stronger one: every JSON response must name a DTO. A
`type: string` body — the one CSV export — is still allowed, being a real scalar
rather than an unnamed object.

### 128.42 The case every version of the guard had skipped

Then the strengthened guard still did not fire, and the reason is the most
instructive thing in this whole section.

Removing `@ApiOkResponse` does not leave a hollow schema behind. It leaves **no
schema at all** — a bare `200` with no content. And every version of this guard
looked only at schemas that EXISTED, so it skipped the commonest case entirely.
That is how 94 operations sat undescribed in a file a guard was watching.

The guard now refuses a 2xx with no body, and both cases were proved to fire.

Three times in this section a check looked right and did nothing: `implements`
without `NoExtraFields` (§128.16), `NoExtraFields` without depth (§128.30), and
this. Each time the only thing that found it was deliberately breaking something
to watch the build fail.

### 128.43 Done

**156 of 156 operations describe their responses.** 155 name a DTO; the
remaining one is the CSV export, a genuine `text/csv` string body.

Every client type is derived. Across the three apps, 122 distinct schema
references and **one** hand-written interface left — `Page<T>` in the console,
a generic helper over the derived types rather than a shape of its own.

**Six generator guards**, each written after the thing it catches had already
happened, and each proved to fail before being trusted:

1. §60 — named schemas with no properties (the plugin did not run)
2. §128.7 — two DTO classes sharing one global schema name
3. §128.14 → §128.41/42 — responses that do not name a DTO, including the ones
   that describe nothing at all
4. §128.26 — POSTs documented as 200 that answer 201
5. §128.27 — two response decorators on one route

**Twenty real findings**, not one of which a reader would have caught. The shape
of nearly all of them was the same: something that generated cleanly, read
plausibly, and was wrong in a direction nobody had run yet. Four were in the
checking machinery itself.

What is NOT done, and is deliberately left: request bodies and error responses
are still undescribed, and `/docs` is still the only description of either.

## 129. Failures are part of the contract too

§128 described what success looks like for all 156 operations and left failure
entirely undocumented — **not one 4xx between them**. That is the larger half
missing: a generated client has a type for the happy path and nothing at all for
the case it will handle most often.

### 129.1 The error shape is NOT uniform, and the docs would have said it was

Established by probing the booted application, because reading Nest's
documentation would have given the wrong answer:

| status | body |
|---|---|
| 401 | `{ statusCode, message }` — **no `error` field** |
| 403 | `{ statusCode, message, error }` |
| 404 | `{ statusCode, message, error }` |
| 400 | `{ statusCode, message: string[], error }` — an **array**, one per rule |
| 409 | `{ statusCode, message, error }` |

Two things follow, and both are now in the contract. `error` is **optional**,
because a 401 has never carried it — Nest omits it when the exception's
description equals the status text, and the guard throws
`UnauthorizedException` with no description. And `message` is
**`string | string[]`**: a sentence for a domain failure, an array for a
validation failure. A malformed UUID is a 400 with a *string*; a bad body is a
400 with an *array*. Same status, two shapes.

All three clients were already narrowing `message` correctly, and none read
`error`, so nothing was broken — but nothing was describing it either.

The probe was throwaway. `test/error-contract.spec.ts` is not: seven tests over
HTTP, pinning every shape above, because the thing that cost an hour in §125 was
a shape everybody *believed* they knew.

### 129.2 Decorate the controller, not the route

`@ApiErrors({ ... })` goes on the controller CLASS, which Swagger propagates to
every operation in it. Per-route would have meant roughly six hundred
decorators, and six hundred chances to forget one.

Every flag is opt-IN, because a documented failure that cannot happen is as
misleading as an undocumented one: no 404 on a route that takes no id, no 403
where there is no role guard. The flags were derived from each controller's
actual decorators — and getting that list right took **three attempts**:

1. The first scan searched the whole file, so a controller inherited the guards
   of its neighbours. `CategoriesController`, which is public, came out needing
   a 401.
2. The second walked upwards from the class and **stopped at a comment**, so
   `AppointmentsSharedController` — which has a comment between `@Controller`
   and `@UseGuards` — came out unguarded.
3. The third read the exact decorator block per class. That table was printed
   and checked by eye, and the flags written out explicitly rather than
   inferred, because by then the inference had been wrong twice.

`OptionalJwtAuthGuard` is the distinction that matters most: discovery,
availability and public reviews attach a user when there is one and allow
anonymous callers, so they document **no 401**. Two routes carry their guard on
the METHOD rather than the class — `GET /users/me` and `POST /threads/inquiry` —
and carry their own `@ApiErrors` beside it.

### 129.3 Four rules the document can check about itself

The guards added here need no knowledge of the controllers, only of the
generated document, which is what makes them enforceable rather than reviewable:

1. a path parameter implies a **404** — the id may not exist, or may not be
   yours, and §27.2 makes those deliberately indistinguishable
2. a request body implies a **400** — the ValidationPipe is global
3. a **403 implies a 401** — you cannot be forbidden without first being
   authenticated, so one without the other is incoherent
4. **no operation documents zero failures**, except `GET /categories` and
   `GET /places/provinces`, which are public, take no parameter and no body, and
   genuinely cannot fail with a 4xx

All four were proved to fire, separately: stripping the decorator from a
guarded controller, and removing `validation` from one that takes bodies.

### 129.4 Where this leaves the contract

- **156 of 156** operations describe their success response; 155 name a DTO and
  the last is a genuine CSV string body
- **577 documented failures** across those 156 operations — 400, 401, 403, 404,
  409 and 429, each pointing at a schema rather than at nothing
- **65 request bodies** all name a DTO; the other 20 write operations take no
  body, being actions on a path (`approve`, `resume`, `run`, `send`)
- **254 schemas**, every one reachable from an operation
- **ten generator guards**, each written after the thing it catches had already
  happened, and each proved to fail before being trusted

Still not described: 5xx. Deliberately — a 500 means something unforeseen
happened, and a contract that promises a shape for it is promising something the
code does not know how to keep.

## 130. A social layer for buyers — designed, costed, and NOT built (2026-10-04)

Asked for: buyers add each other as friends, see each other's favourites, chat
one-to-one and in groups, make voice and video calls, and **pin a shop or a
service to a conversation** so a group talking about a salon has that salon —
or one exact service in it, with its price — sitting at the top of the chat.

**Deferred out of the MVP by the owner, to be reconsidered after launch if it
turns out to matter.** Nothing was built. This section exists so the design work
is not repeated, and because three of the findings below outlive the feature.

### 130.1 The pin is a pattern this codebase already has

A customer↔business thread can be attached to a booking: `Thread.appointmentId`,
with `kind` derived as `APPOINTMENT` or `INQUIRY` (§21.1). The app shows that
booking at the top of the conversation. The requested pin is the same idea
aimed at a `Location` or a `ServiceLocation` instead of an `Appointment`.

One change it would need: **many pins per conversation, not one.** The booking
version allows exactly one, which is right for a booking — a thread is about a
booking or it is not. But a group comparing two salons needs both pinned, and
one-per-conversation forces a new conversation per shop, which is worse than no
pin at all.

Shape it would take: `ConversationPin` carrying `conversationId`, exactly one of
`locationId` / `serviceLocationId` (nullable pair plus a CHECK, the
`BillingAdjustment` pattern from §25.2), who pinned it, and when. Creating a
conversation *from* a shop makes the conversation and its first pin together.

### 130.2 Friend chat cannot reuse `Thread`

`Thread` is `businessProfileId` + `customerId` — one business, one customer, as
a pair. A friend chat has no business; a group has N members. Neither fits, and
widening `Thread` would break the tenant scoping and the per-viewer projection
(§112.1) that the business chat depends on.

The precedent is already set and already written down: support tickets
"deliberately NOT built on Chat's Thread/Message ... the participants are
different ... these tables borrow Chat's proven shapes without sharing its
models" (schema comment above `model Ticket`). A social layer would follow it —
its own `Conversation` / `ConversationMember` / `ConversationMessage`, reusing
the existing socket.io gateway and its rooms rather than its tables.

### 130.3 Sharing favourites must be opt-in, and off by default

Favourites are private today. Making them friend-visible would change the
meaning of rows people created under a different promise — the §119 reasoning
about what a person agreed to, applied to data rather than to terms. So: a
per-user setting, defaulting to **off**, and existing favourites stay private
until their owner says otherwise.

### 130.4 Friend DISCOVERY is the privacy problem, not friendship

Searching for a friend by email address would let any caller type any address
and learn whether that person has an account. That is exactly the leak
`POST /auth/otp/request` is written to avoid, by returning the same message
whether or not the address is registered (§3.2). Building a searchable directory
beside it would undo that.

So friends would be added by **share link or invite code** — the sender passes a
link, the recipient opens it, and that creates the request. No search, no
enumeration.

### 130.5 Calls are a project, not a feature — and Expo Go is the blocker

Signalling is the easy part: the existing `/chat` gateway already has
authenticated connections and rooms, and relaying offer/answer/ICE through them
is small work. The cost is everywhere else:

- **No WebRTC implementation runs in Expo Go.** `react-native-webrtc`, LiveKit,
  Daily and Agora all need a native build. The customer app is currently tested
  on a real phone *through Expo Go*, and there is no `eas.json`. Calls cannot be
  tried at all until the app is built properly, so the first step is not code.
- **One-to-one still needs a TURN relay.** A meaningful share of mobile-network
  pairs cannot connect directly. TURN is a hosted, monthly cost.
- **Group video needs an SFU.** Three or more participants cannot mesh —
  it exhausts uplink and battery. That is a media server, and the sane answer is
  to buy one rather than run it.

Recommended order if this is ever picked up: friends, then favourite sharing,
then conversations, then pins — all of which need nothing new — and calls as a
separate piece beginning with making the app installable.

## 131. The sidebars are grouped (2026-10-04)

Both consoles had **twelve flat links** in one list. Finding one meant reading
all twelve, and in the admin sidebar the three screens that have to be read
together to answer "did the money actually move" — Payouts, Payout destinations
and the ledger — were not even next to each other.

Now four or five named groups each. **No address changed.** The same twelve
links point at the same twelve routes, so a bookmark, or a link somebody was
sent, still works. Only the menu changed.

| Business | Admin |
|---|---|
| *Appointments* (ungrouped) | **Moderation** — Businesses, Reviews, Appointments |
| **Your shop** — Shopfront, Services, Branches & hours, Closures & breaks | **People** — Users, Support |
| **Customers** — Messages, Reviews | **Money** — Payouts, Payout destinations, Money |
| **Money** — Getting paid, How it is going | **Platform** — Categories, Places, Legal, Settings |
| **Manage account** — People, Legal, Help | |

### 131.1 Appointments sits above the headings

In the business sidebar it is the landing page — the first thing an owner sees
every morning. A heading above the first thing you look at is a heading nobody
reads, so that one link has no group. The admin sidebar has no such link:
Businesses is its landing page and belongs in Moderation on merit.

### 131.2 "Manage account", not "Settings"

Everything in the business app's last group is about the ACCOUNT rather than
about the shop — adding a colleague, reading the terms, asking for help. Calling
it "Settings" would have put it beside "Your shop", which is where an owner
would then look for opening hours.

The grouping is also the one place a long menu can carry meaning for free: the
three money screens being adjacent in the admin sidebar is itself the hint that
they are read together.

### 131.3 Verified by matching the menu against the routes

Regrouping twelve links by hand is exactly how a link gets dropped or pointed at
nothing, and there are no tests on either web app. So the check was mechanical:
every nav link resolves to a declared route, every declared route except
`/login` has a nav link, and nothing is listed twice — in both apps. Both also
typecheck and build.

## 132. Photos of a service (2026-10-05)

A business can now upload up to **eleven photos per service**, and a customer
sees them when choosing between services and again on the booking screen.

Hung off `Service`, not off `ServiceLocation`: a haircut looks the same at every
branch and only its PRICE differs, so photos on the per-branch join would make a
business upload the same eleven pictures once per branch.

A separate table from `location_media`, for the reason tickets are separate from
chat: the columns are alike, the subject is not, and one shared table would put a
"which kind is this" predicate in every query — which §123 had just finished
paying for.

### 132.1 Ownership is proved before the count is read

`upload` checks that the caller owns the service BEFORE counting its photos.
Reversed, a full service would answer "already has the maximum of 11 photos" to
a stranger probing its id, which tells a competitor exactly how full it is.

The ordering is now a test, and the test was proved: swapping the two lines fails
exactly one assertion — the one that uploads to a FULL foreign service and
requires a 404 rather than "full". The obvious test (upload to a foreign service,
expect 404) passes either way, which is why it was not enough.

The ownership check itself moved to `BusinessAccessService.requireOwnedService`,
beside `requireOwnedLocation`. It had been private on `ServicesService`, and
service photos needed the same predicate — two copies of an ownership check being
the §128.5 mistake applied to a `where` rather than to a `select`, where the one
that leaks is always the copy nobody remembered to change.

### 132.2 Photo moderation was never built, and a comment claimed it was

`MediaStatus` exists on `location_media` with a schema comment saying photos land
`PENDING` and an admin approves them. **Nothing in the codebase ever sets or
reads that column.** There is no approval route, no admin screen, and no
customer-facing filter — so every shop photo has always gone straight to
customers.

Worse, §128.31's `GalleryPhotoDto` carried a comment of mine asserting that
"customer-facing endpoints filter to APPROVED". They do not, and never did; I
took it from a comment in `GalleryService` instead of reading the query. The
comment is corrected rather than deleted, because the field is still published
and a reader deserves to know it means nothing yet.

`service_media` carries the same column for the same reason: if moderation is
ever built it should be built once, for both tables, rather than bolted onto one.
Service photos are therefore visible the moment they are uploaded — which is what
was asked for, and what shop photos already did.

### 132.3 Where the limit lives, and where it does not

Eleven is a constant in `ServiceImagesService`, published through the listing as
`limit` and `remaining`, and named in the refusal message. The business app shows
"3 of 11" and disables its button by reading those fields — it never hardcodes
the number, because a number duplicated in a client is a number that disagrees
with the server the first time either changes.

The file picker moved to `components/ImageButton` for the same reason: its
`accept` list mirrors the server's allow-list, and a second copy would be a
second thing to keep in step.

### 132.4 Two steps, not one

Creating a service is one JSON request; a photo is multipart. Rather than make
one endpoint be both, the business app creates the service and then uploads —
the same two steps the branch gallery already uses.

### 132.5 The test that matters is the cross-module one

A business can upload a photo, the row can exist, and the customer can still see
nothing because the customer-facing `select` never asked for it. That is §109
exactly. So the ordering and the visibility are asserted through
`DiscoveryService.findOne`, and deleting `images` from the shopfront select fails
three of them.

Those tests are declared LAST in `discovery.spec.ts` on purpose: they create
extra shops, and several tests above assert on the full set of locations the
database holds. Declared earlier, they silently broke five.

## 133. The customer app is redesigned (2026-10-05)

The phone app worked and looked like a form: one grey border, one blue, system
type, and four text links crammed into the header of one screen as its only
navigation. The owner supplied twenty-eight reference designs from other
booking apps and asked for the same standard, using what the app already has.

**No screen, link, button or sentence was added or renamed.** Every label is the
one it was. What changed is the design system under it, the navigation around
it, and a handful of bugs that only became visible once the app could be looked
at.

### 133.1 What the references agree on, and what was taken from them

Read together, the twenty-eight share five things, and those are what was built:

- a **floating tab bar** with the current tab opened into a labelled pill
- **picture-first cards** — photo on top, state and rating ON the photo, price below
- a **hero photo** the page rides up over as a rounded sheet
- **day pills and an even grid of times**, with one button pinned to the bottom
- one accent colour, generous corners, soft shadows, one strong typeface

Not copied: any one app's palette or layout. Coral on warm paper with near-black
ink, Plus Jakarta Sans, and a 4-point spacing scale — tokens in `src/theme.ts`,
whose original seven keys keep their names so nothing that read them broke.

### 133.2 A kit, because fourteen screens had fourteen buttons

`src/ui/` holds the pieces: `Button`, `Chip`, `IconButton`, `Pill`, `Cover`,
`Avatar`, `Segmented`, `Sheet`, `TopBar`, `EmptyState`, `Skeleton`, `Stars`,
`TabBar`, and the motion helpers. The same four style blocks had been pasted into
every screen and had already drifted — the Saved row showed no district where
the search row did. Both are now one `PlaceCard`.

### 133.3 The empty picture is the common case, so it is designed

Most shops will have uploaded no photo on the day they join. `Cover` draws a
gradient in the CATEGORY's colour with its icon on it, and fades the real photo
in over that when there is one. Ten shops with no photos look like ten different
shops, not ten grey boxes.

`coverImageUrl` was added to the discovery list and to saved places for this —
it was on the shop page only, so a card had no picture to lead with.

### 133.4 Motion, on the built-in driver

Press-scale on everything tappable, staggered fade-in for lists, a sliding
segmented control, a heart that pops, parallax on the shop photo, a pulse while
a payment waits on the customer's handset, skeletons instead of spinners.

All on React Native's own `Animated`, deliberately not Reanimated: it needs no
Babel plugin and no native configuration, and the app is tested in Expo Go on a
real phone where a mis-versioned worklet runtime is a red screen.

### 133.5 Tabs — and what staying mounted changes

Home, Bookings, Saved, Messages and Account are a `(tabs)` group. A group, so no
address changed: `/bookings` is still `/bookings`.

`Tabs` is imported from `expo-router/js-tabs`. The SDK 57 router marks the old
export deprecated and vendors react-navigation itself; this was read from the
installed package, not remembered — `AGENTS.md` warns that Expo's APIs move
between releases, and `StyleSheet.absoluteFillObject` had also gone.

### 133.6 Three things that broke because tabs stay alive

A stack screen is built fresh each time. A tab is built once. Three behaviours
depended on the first without saying so:

- **Signed-in state.** Screens read `tokens.access` during render, which React
  cannot see change. A Bookings tab that rendered "Sign in to see your
  bookings" would have gone on saying it after sign-in. `useSignedIn()` is a
  real subscription, and sign-in now invalidates every query.
- **The category hand-off.** Home took `categoryId` from the route in a
  `useState` initialiser, which runs once. It now follows the params.
- **Stacking.** `router.push('/')` from the category list put a SECOND Home on
  top of the first. `dismissTo` returns to the one already there. Verified by
  driving the app: one copy of Home in the page, filtered to "1 place".

### 133.7 The heart had never appeared

Found by looking at a signed-in screenshot and seeing no hearts. Search and the
shop page were requested with `anonymous: true`, which strips the token — so the
server never said which places were saved, and `SaveButton` hides itself when it
does not know. **Nobody could save a place from the app.** §120 shipped a
feature whose only entry point was invisible.

`optionalAuth` sends the token when there is one and never ends the session over
it. A stale token is refreshed first, because the server treats a bad one as no
one — the hearts would otherwise vanish every fifteen minutes.

### 133.8 Yesterday was offered as a day to book

The booking screen built its fourteen days with `toISOString()`, which is UTC.
Kigali is two hours ahead, so between midnight and 2am the first day offered was
yesterday. Found because the screenshots were taken at half past midnight. Built
from local date parts now.

### 133.9 The app can be looked at in a browser

`expo-secure-store` has no web implementation — its web module is an empty
object — so the app could not sign in under `expo start --web`. On the web only,
tokens fall back to `localStorage`, as the two web apps already do. The phone
build is unchanged.

This is what made the rest of the section possible: every screen was rendered in
headless Chrome at 320, 390 and 820 points and LOOKED at. §133.7 and §133.8 were
both found that way, and neither would have been found by a typecheck.

### 133.10 What was checked, and what was not

Checked: typecheck; the Android bundle builds; every screen rendered and viewed
at three widths, signed in and out; the category flow driven end to end; 1235
backend tests.

**Not checked: a real phone.** The web preview renders the same components, but
shadows, the keyboard, haptics, safe areas and the feel of the animations are
the phone's own. That is for the owner's Tecno.

### 133.11 Account returned before its hooks

The first thing the redesign did on a real phone was crash. Account's signed-out
early return sat above seven hooks — survivable while signed-in state was read
once per mount, fatal once §133.6 made it a live subscription: signing in or out
re-rendered the same component with a different number of hooks.

The previews never caught it, because each one started signed in or signed out
and never CHANGED while a screen was open. The return now comes after every
hook, and no other screen has the pattern.

## 134. The bell, the message count, and the MoMo mark (2026-10-05)

### 134.1 Notifications the phone had never shown

Every email the platform sends is also a stored row, with a read state and three
endpoints — and the customer app called none of them. A customer whose booking
was cancelled by the shop learned of it from their email or not at all.

Now a bell on the home screen with the unread count, and a screen behind it.
The text was written to be an email, so a row shows the subject and two folded
lines and opens to the full message on a tap. Tapping marks it read,
optimistically (the §120.2 reasoning); one about a booking offers the way to it.

A kind the app does not recognise gets the bell icon rather than nothing: the
server adds kinds, and an unknown one must still be readable.

### 134.2 Two counts, kept apart

Unread MESSAGES are a number on the Messages tab — it was a dot, which says
"something" where "3" says how much. Unread NOTIFICATIONS are the number on the
bell. One combined figure would send people to the wrong screen half the time,
so each number sits on the thing that clears it.

Both come from `useUnread`, which reuses the query keys the two screens already
read: opening either costs no second request, and a badge cannot disagree with
its list. Refreshed once a minute while the app is open.

### 134.3 The MTN mark is a file, not a drawing

A phone-number field on its own does not say whose mobile money it wants. The
payment card and "Numbers you pay from" now lead with the MTN logo.

It is the genuine current logo, from Wikimedia Commons (a public-domain file;
the mark itself remains MTN's trademark, used as a shop window shows the cards
it takes). Deliberately not redrawn in code: a hand-made lookalike of a payment
brand is exactly what a customer is right to distrust at the moment they are
asked for their number.

**Not found:** MTN's dedicated "MoMo" artwork, from any source that could be
verified. Replacing `assets/mtn-logo.jpg` with the file from MTN's brand kit
swaps it everywhere.

## 135. Home is a shop window: popular places as circles, services on shelves (2026-10-05)

Home was a column of tall place cards — one and a half shops per screen, and no
service or price until a shop was opened. It now shows who is here in one line
and spends the rest of the screen on what can be booked.

### 135.1 What "popular" means

`score = bookings × (rating ÷ 5)`, in `discovery/popularity.ts`, used for places
and services alike.

- **Bookings counted:** `BOOKED`, `IN_PROGRESS`, `COMPLETED`. Not cancelled, not
  no-shows, not unpaid holds — none of those is somebody choosing the shop.
- **No ratings yet counts as 3.5**, not as 0 and not as 5. Zero would bury every
  new shop under any shop with one bad review; five would put it above shops
  that earned theirs.
- **Ties:** rating, then number of ratings, then name — so the order never
  shuffles between two requests.

A service has no rating of its own (reviews are of a visit to a branch), so a
service is scored with ITS OWN bookings and its BRANCH's rating.

`sort=popular` is a new value of the existing sort, and every place now carries
`bookingCount`.

**Sorted in memory**, like the distance sort: the score is computed from a
count and an average that Postgres would need a hand-written query to order by.
Fine at hundreds of branches; the day it is not, the score becomes a stored
column refreshed when a booking or a review lands.

### 135.2 `GET /discover/services`

Services across every shop, one row per service-at-a-branch. It takes the SAME
query as `/discover/locations` and narrows branches through the same
`buildWhere`, so a branch that search hides (closed, suspended, unverified) can
never surface through one of its services. `q` and `maxPriceMinor` apply to the
service itself. Default order is popular.

### 135.3 The screen

- **Places** are a row of circles, most popular first: logo (else cover, else
  the category's tile), rating on the circle's edge, a green dot when open now,
  and the branch name underneath when two circles share a business.
- **Services** are small cards, two and a half across a phone — the half card
  at the edge is the "this scrolls" signal. Picture, duration, name, shop,
  price on its own line (a price is never cut short), then rating and
  "N booked".
- **Nothing narrowed:** one shelf of the whole catalogue in the chosen order,
  medals on the first three (only when the order is popularity and the service
  has been booked), then one shelf per category. A category with a single
  service gets no shelf. "See all" on a shelf does what its category tile does.
- **Searching or a category chosen:** the shelves give way to a grid of exactly
  that — two columns on a phone, three or four on wider screens.

One set of filters drives both lists. The sort chips are now switches: off
again is back to most popular, which is the default (~~was Best rated~~).

Tapping a service goes straight to booking it. Tapping a circle opens the shop.

**Gone from Home:** the heart on each place. Saving is on the shop's page and
the Saved tab, both unchanged; `PlaceCard` stays for Saved.

### 135.4 A service's photos fill the width

On the booking screen each photo was a fixed 220 wide, so a service with ONE
photo showed it beside an empty half of the screen. The photos now share the
width between them and never go below 220: one photo spans the screen, two fill
a tablet side by side, and a longer set stays at 220 each and scrolls.

### 135.5 The booking screen links to the shop

The home shelves (§135.3) take a customer straight to booking a service, past
the shop's own page — and the booking screen had no way to reach it. It now
always shows a row with the business's logo (its initial where there is no
logo), its name and the branch; tapping it opens the shop's page.

### 135.6 One circle per business

The places row showed one circle per BRANCH, so a business with two branches
appeared twice with the same name and logo. ~~The branch name under the circle
told them apart (§135.3).~~ The row now shows each business once: it is where a
customer browses businesses, and branches are a detail of one.

The circle opens the business's first branch in the chosen order — its most
popular, or its nearest when sorting by distance. Done in the app, over the
page of branches already fetched; the count beside "Places" is shown only when
that page holds every branch, because otherwise the number of businesses is not
known. Services are untouched: the same service at two branches is two
different things to book.

### 135.7 Tapping a service photo opens it properly

`src/ui/PhotoViewer.tsx`. The photo does not appear, it travels: it lifts out of
the thumbnail that was tapped and grows to the middle of a dimmed screen, and
goes back to the same spot on closing. The thumbnail's position is measured
from the thumbnail itself (`measureInWindow`), not worked out from the touch —
the touch's offsets are not reported the same way on every platform, and a
wrong origin silently cancelled the whole movement.

- The photo is shown whole, at its own shape, as large as the screen allows.
- Sideways moves between photos; a counter and a strip of small thumbnails say
  where you are, and the strip jumps to any photo.
- Three ways out: the cross, a tap on the dark, and dragging the photo down —
  it shrinks and the page shows through as it goes.
- After swiping to another photo there is no "right" thumbnail to return to, so
  it settles back and fades instead.

Built on the built-in `Animated` with the native driver, like the rest of the
app; no new package. **Not built:** pinch-to-zoom, which needs a gesture
library the app does not have.

### 135.8 Choosing Kigali showed nothing: the demo branches had no district

The place filter was working. A branch is matched to a place through its
district (§104.2), and **none of the nine demo branches had one** — `seed-demo`
never set it, although §104.2 describes Kigali Barbers as being in two
districts. So "Kigali" correctly matched zero branches and looked broken.

- `seed-demo.ts` now gives every branch its district (Gasabo, Kicukiro or
  Nyarugenge, by its address).
- The existing dev rows were given the same districts with one `UPDATE`,
  rather than re-running the seed, which wipes and recreates the demo
  businesses along with any photos and bookings added since.
- Verified against the running server: Kigali 7 branches / 16 services,
  Gasabo 4 / 8, Kicukiro 1 / 2, Nyarugenge 2 / 6; Northern and Western 0.

**The new-branch form now requires a district.** §104.2 left it optional
because branches that predate districts had to stay saveable; that reason does
not cover a branch being created today, and an optional field is exactly how a
real business would end up invisible the way the demo did. The API still
accepts a branch without one, and editing an old branch is unchanged.

## 136. Booking more than one (2026-10-05)

A booking was always one person, one service, one slot: a mother wanting
haircuts for herself and two children booked three times and paid three
deposits. A booking now carries a QUANTITY.

### 136.1 The service says what "three" means

*Superseded by §189: the service says nothing; three is three people, taking
three of the branch's places.*

~~`Service.quantityMode`, chosen by the business, because the same number means
different things:~~

| Mode | Example | Price | Time | Places in the shop |
|---|---|---|---|---|
| `SINGLE` (default) | every service before this | × 1 | as set | 1 |
| `PEOPLE` | 3 haircuts | × how many | see 136.2 | see 136.2 |
| `UNITS` | 3 passport photos | × how many | as set | 1 |

~~`Service.maxQuantity` is the most one booking may ask for: 1 for `SINGLE`,
2–20 otherwise. A CHECK constraint holds the two columns together and
`normaliseQuantityRule` makes them agree before a write. Every existing
service is `SINGLE`, so nothing changes until a business opts in.~~

### 136.2 People are served side by side, then in rounds

*Superseded by §189: side by side only. A group bigger than the branch is
refused; it is never served in rounds.*

~~`planQuantity`, in `appointments/quantity.ts`:~~

    places taken = min(people, branch capacity)
    rounds       = ceil(people / places taken)
    time         = rounds × the service's length

~~Three 30-minute haircuts are 30 minutes in a four-chair salon (3 places), 60
across two chairs, and 90 back to back in a one-chair barbershop. No business
configures which; it follows from the capacity they already set (§16.4).~~

~~**Rejected: refusing a group larger than the capacity.** Simpler, and it would
make every one-chair shop — most of them — unable to take a parent and a child
in one booking, which is the case that prompted this.~~ Chosen after all in
§189: the rounds made times vanish as the number went up, and nobody could
see why.

**Not built: quantity that lengthens a UNITS booking** ("2 hours of massage").
A business sells that today as a second, longer service.

### 136.3 Availability counts places

An appointment stores `capacityUnits`, the places it occupies. A slot is
offered while ~~`places already taken + places needed ≤ capacity`~~ the places
in use at the busiest moment of it, plus the places needed, are ≤ capacity
(§189); with one each that is exactly the old rule. `GET /locations/:id/availability` takes
`serviceId` and `quantity` and works out length and places ITSELF, with the
same function booking uses, so a client never computes them and the times
offered are the times accepted. The answer's `durationMinutes` is the whole
booking's length.

### 136.4 The money is the total

`servicePriceMinor` on an appointment is now the price of the WHOLE booking,
and the new `unitPriceMinor` is the price of one. Chosen that way round so
everything that already reads `servicePriceMinor` — the balance due at the
shop, the analytics sums — stays right without being touched. The deposit and
the platform fee are taken on the total, multiplied before the percentages so
three is never three separately rounded deposits.

`quantity`, `capacityUnits` and `unitPriceMinor` are snapshots, like the money:
a business changing its rule later does not rewrite a booking already made.

### 136.5 Screens

- ~~**Business:** the service form asks "Can a customer book more than one?" with
  the three answers in plain words, and "Most in one booking". Bookings show
  "· 3 people" or "× 3", and their real length.~~ Both questions are gone
  (§189); bookings show "· 3 people".
- **Customer:** the booking screen shows a − / + picker only where the service
  allows more than one, worded "How many people?" or "How many?". The total,
  the deposit, the length and the free times all follow it; changing it clears
  a chosen time, because a time free for two may not be free for three.

### 136.6 Left out, knowingly

- A half-written service saved as a DRAFT (§123) does not keep the quantity
  choice; it comes back as "one per booking".
- Emails and notifications do not mention the quantity.
- The demo "Haircut" was switched to several-people (max 5) in the dev
  database by hand, to have something to try; `seed-demo` is unchanged.

## 137. Checkout, a paid moment, and the reservation page (2026-10-05)

`/booking/:id` was one screen doing three jobs: the payment form, a small
"Confirmed" row that appeared inside it, and the booking's details, all stacked.
It is still ONE route — every link to a booking should land on whatever is true
of it now — with three faces (`src/booking/`):

| The booking is… | Face |
|---|---|
| not paid | `Checkout` |
| seen to be paid, just now | `PaidCelebration`, once |
| anything else | `Reservation` |

### 137.1 Checkout

Laid out as a checkout is everywhere, because familiarity is most of what makes
paying feel safe: what is being bought **with its photos** (tap to open them),
the sum line by line (total, what is left for the shop, what is paid now and
the percentage it is), the method shown as a chosen one, and the amount beside
the Pay button fixed at the bottom.

- **The photos** come from the shop, since an appointment carries a name and no
  picture. That read is allowed to fail: a shop closed since still has its
  bookings shown, with the category tile.
- **A real countdown.** An unpaid slot is released after five minutes
  (`PENDING_PAYMENT_TTL_MS`). The screen shows the clock rather than letting
  someone pay for a slot that has gone. The five minutes is repeated in the
  app (`HOLD_MS`); if the server's value changes, that constant must too.
- **The refund rule is stated before the money moves** (§25.1): no refund if
  the customer cancels, all of it back if the shop does.

### 137.2 The paid moment

A full screen with a growing tick, the amount, a short receipt and two ways on:
the reservation, or back to browsing. Shown only when the payment is SEEN to
succeed in this sitting; opening a booking paid last week goes straight to the
reservation.

### 137.3 The reservation page

Photo and status, the shop (tap to open it), the arrival code, then four round
actions — **Message, Directions, Get help, Cancel** (Review once the visit is
done) — then the details, the payment, and the cancelling rules in words.

- **Reservation number** is the first eight characters of the booking's own id,
  shown as `0440-A141`. Not a second identifier: support can find the booking
  from it and there is nothing to keep in step.
- **Directions** hands the shop's pin (or its address, without one) to the
  phone's own maps app.
- **"Balance at the shop"**, never "paid at the shop": nothing here records
  what happens at the till.

### 137.4 Help is a support ticket the customer can read

The ticket API (§17) had no customer screen. `/help/:appointmentId` writes one
tied to the booking, in three plain categories; `/ticket/:id` shows it as a
conversation, with support's replies and a box to say more. A ticket nobody can
read the answer to is a suggestion box.

It says on the form that this reaches the PLATFORM's support, and that the shop
is reached through Message — the two are easy to confuse and go to different
people.

**Left out:** attaching photos to a ticket (the API takes them), and a list of
all of a customer's tickets outside a booking.

## 138. The shop page's sections are tabs (2026-10-05)

"What they do", "Open hours" and "Reviews" were stacked, so a shop with a long
list of services pushed its hours and reviews a long scroll down. They are now
three tabs under the shop's header (the existing `Segmented` control), showing
one at a time; "What they do" is first. The review count sits on its tab.

Everything above the tabs — photo, name, address, rating, Message the shop,
the gallery — is unchanged and stays on screen for all three.

### 136.7 The demo services that suit it allow several people

Quantity is a choice each business makes per service, so after §136 exactly one
service showed the picker — the one switched on by hand to try it. `seed-demo`
now sets "several people, up to 5" on every demo service where that is natural
(barber, spa, nails, braiding, tailoring, training), and the dev rows were
updated to match. The garage's services stay one per booking: several cars each
need a bay, which is what the several-people rule does, but its picker asks
"How many people?".

## 139. How far away, and what is near (2026-10-05)

The server has measured the distance to every branch since §107, and the home
redesign (§135) stopped showing it anywhere.

- **Every card says how far.** Once a position is known it is sent with every
  search, not only a distance sort, so each shop circle and service card
  carries "1.2 km". Kilometres; under one reads as metres. ~~Still never with
  a radius — it measures and orders, it hides nothing (§107).~~ Superseded by
  §171.
- **"Near you"** is a shelf of the ten closest services, asked for in distance
  order, since the nearest are not necessarily among the most popular.
- **Not asked on open, still (§107.3).** Someone who has already allowed
  location gets their distances back without tapping anything — the app reads
  the permission that exists and never raises the prompt by itself. ~~Someone
  who has never been asked sees one quiet row, "See what is near you", and
  tapping it is what asks.~~ Superseded by §171: a card at the top of Home.
- Turning "Nearest" off now only changes the order back; the position is kept,
  because the distances are still wanted.

Nothing is stored: the position lives in the app while it is open. Where a
customer lives, for emails, is a separate thing they choose (§140).

## 140. Emails about services near a customer (2026-10-05)

One email a week, "Popular near you in Gasabo": the five most popular services
in the customer's own district, with photos and prices.

*(The setting was called ~~"Offers near me"~~; it is "Weekly offers by email"
since §172.)*

### 140.1 Nobody is sent one who did not ask

`users.offersOptInAt` is null for every account until its owner turns on
"Offers near me" in Account. It is a timestamp, not a flag, because "when did
this person agree" is the question a regulator asks (Rwanda's Law 058/2021
requires consent for marketing). The sentence beside the switch says how often,
about what, and that it can be undone — that sentence is the consent.

The weekly job reads only customers who are opted in, have a district, and are
not closed. Closing an account clears all of it.

### 140.2 "Near" is a district the customer names

> ~~"Not a position taken from the phone."~~ **Superseded in part by §169:** a
> customer may now also save an exact spot; the district stays as the
> alternative and the fallback.

`users.homeDistrictId`, chosen from the same list the place filter uses. **Not
a position taken from the phone** (§139 keeps that in the app and stores
nothing): a district is enough to choose the right shops and is not a record of
where somebody was. It is kept when they opt out, so coming back is one tap.

### 140.3 Leaving is one tap, with no password

Every email carries a link with a random token (`users.offersToken`):
`GET /offers/unsubscribe/:token` answers with a small page, and a POST to the
same address serves a mail app's own Unsubscribe button (the `List-Unsubscribe`
headers). It answers the same whether or not the token matched, so it reveals
nothing about who is subscribed. Opting in again makes a new token, so an old
email's link cannot undo a later choice. These two routes are deliberately not
in the API contract: a person opens them from an email.

### 140.4 What is sent, and when

- **Friday 09:00, Kigali time** (`OffersScheduler`). Never more than once in
  six days per person, whatever the schedule does (`offersLastSentAt`).
- Worked out once per district, through the PUBLIC service search — so an email
  can only show what a customer could find and book (§135.2).
- Fewer than three services in the district: the whole province, and the email
  says "Kigali" rather than "Gasabo".
- Nothing to show: nothing is sent, and nobody is marked as sent.
- A failed send is not marked either, so it is retried next run.

`npm run dev:send-offers` sends now, by the same rules, and refuses in
production.

### 140.5 Not done

- **No button into the app.** The app has no web address to link to, and mail
  apps strip links that open an app directly. The email says "Open the app".
  This wants a universal link once there is a domain.
- **Real delivery waits for deployment**: until then email goes to the local
  test inbox.
- The privacy policy text does not yet mention the district or these emails.
- Mailhog's header list does not show `List-Unsubscribe` (it drops folded
  headers); the raw message has it.

## 141. Terms of Use and Privacy Policy, written for Rwanda (2026-10-05)

The Terms were a 56-character placeholder and there was no Privacy Policy at
all. Both are now full drafts in `apps/backend/prisma/legal/`, published with
`npm run legal:publish` through the same draft-then-publish path the admin
screen uses (§122), so nothing is edited in place and everyone is asked to
accept the new version (§126). **They are drafts for a Rwandan lawyer to
review, not legal advice.**

### 141.1 What they were written against

- **Law n° 058/2021 of 13/10/2021** (personal data and privacy), supervised by
  the NCSA: lawful bases, the data subject rights, the 48-hour breach report,
  storage in Rwanda unless a registration certificate allows otherwise.
- **Law n° 011/2026 of 26/02/2026** (competition and consumer protection),
  gazetted 04/03/2026, which REPLACED Law n° 36/2012. Read from the Official
  Gazette text: Art. 42–43 (what an e-commerce enterprise and an online
  intermediary must disclose; complaints acknowledged within 72 hours and
  answered within 15 days; proof of purchase; marked advertising with a free
  unsubscribe), Art. 44 (a licence from the Regulatory Authority), Art. 47
  (cancel a distance contract within seven days of receiving the good or
  service; refund within 15 days), Art. 48 (30 days' notice before ceasing).
- Age of majority 18.

Every statement about what the product DOES was checked against the code
(the 5-minute hold, the deposit and fee, who sees what, what closing an account
removes). Two claims were removed because they were not true: that arrival
codes are stored protected (the customer's copy is kept readable, §54.2), and
that staff access is logged.

### 141.2 Things the research raised that are NOT solved by text

1. **The seven-day right to cancel (Art. 47) sits against the non-refundable
   deposit (§25.1).** The Terms keep the deposit rule and add that nothing in
   them removes a right the law gives. Whether Art. 47 reaches a booked
   appointment, and from when the seven days run, is a question for a lawyer —
   and the answer may mean changing the refund rule in the product.
2. **Art. 44: an e-commerce / online-intermediary licence** from RICA. Existing
   operators had six months from 04/03/2026.
3. **Registration with the NCSA** as a data controller, and **where the data is
   hosted**: outside Rwanda needs the certificate to say so.
4. **The platform holds customers' deposits before paying businesses**, which
   may need a view from the National Bank of Rwanda.

### 141.3 Placeholders

Company name, RDB code, address, contacts, complaints officer, licence and
certificate numbers, hosting and email providers, and two retention periods are
in `[SQUARE BRACKETS]`. The customer app highlights them, and the publish
script refuses to publish a text that still has one when
`NODE_ENV=production`.

### 141.4 How the text is drawn

Stored as plain text, as before. The customer app's `LegalText` reads the
conventions a plainly typed document already follows — numbered headings in
capitals, `4.2` clauses, `- ` bullets — and sets each properly. The web apps
still show it as typed.

**Not written:** the Seller Agreement, which is still a placeholder.

## 142. The legal screen is a reader, and agreeing is a moment (2026-10-05)

The two documents were cards stacked one above the other, each closed behind
"Read it", each with an ordinary button at the very end of its text.

- **Tabs on one line** (`Segmented`): Terms of Use | Privacy Policy. The chosen
  one is open in full; nothing to expand. It opens on the first document still
  waiting for an answer.
- **A reading line** under the tabs fills as the text is scrolled. It informs,
  it does not gate: the button works at any point, because forcing a scroll to
  the end proves scrolling, not reading.
- **The agreement is a bar fixed at the bottom**, naming the document and
  version being agreed to.
- **`AgreeButton`**: a light crosses it while it waits; pressed, it draws in to
  a circle and spins while the answer is saved; saved, it turns green with a
  tick and a ring, and the phone's success tap. A failed save opens it back
  out, so failure never looks like agreement. One small lift when the reader
  reaches the end.
- After agreeing, the screen moves straight to the next document still waiting,
  so two documents are two taps.
- "What changed" is shown only to someone who agreed to an earlier version.

## 143. Account is a profile (2026-10-05)

The Account tab was a column of white cards under the word "Account". It is now
laid out the way a profile is.

- **A dark header** carries the person: picture inside a coral-to-gold ring,
  name, email, and "With us since". It stretches when pulled and moves slower
  than the page; once it has scrolled away a small dark bar with the picture
  and name takes its place. The status bar turns light while this tab is
  showing and dark again on leaving it.
- **Three numbers lap over the header's edge**: Bookings (ever), To come
  (confirmed or happening, not unpaid holds or cancelled), Saved. Each counts
  up when it arrives and opens the tab that holds it. No new endpoint: they are
  the totals of lists the app already asks for.
- **Labelled groups of rows** — Profile, Payment, Offers, About, Your data —
  like a phone's own settings. "Add a number" opens its field only when
  tapped; saved numbers read as `0788 123 456`.
- Sign out is a red row; "Close my account" stays the quietest thing on the
  screen, on purpose (§119). The app's version is at the foot.

Nothing was removed and no wording about what things do was changed; the
Android "Crop is what sends it" note (§125.6) is kept, on Android only.

## 144. A data copy people can read, and a review name they can change (2026-10-05)

### 144.1 The export is a PDF

"Get a copy of my data" handed over a JSON file — complete, and to most people
who asked for it, indistinguishable from an error. It now hands over a PDF:
the same export set out as pages (account, bookings, reviews, messages, support
requests), built on the phone from the same response with `expo-print`.

- **Nothing is summarised away.** Every row of the export is in the document.
- **Built in the app, not on the server.** The server already answers with
  everything; a second "pretty" endpoint would be a second place to forget a
  field. Everything a customer typed is HTML-escaped on the way in.
- **The JSON is kept** as "Technical copy", because moving your data to another
  service (portability) wants a machine-readable file.

### 144.2 The name on reviews is set from the account

`PATCH /users/me/display-name` with `{ displayName: string | null }`.

§31.4 allowed the name to be set only while writing or editing a review,
because nothing wrote a User row then. That left a name that could not be
changed at all once a review's seven-day edit window had closed, and no way to
go BACK to Anonymous short of asking an admin.

- A name obeys the same rules as one set through a review (§31.5): same field,
  same validator.
- `null` means Anonymous, and is what is stored — the word still never is
  (§31.2).
- It changes on every review at once (§31.1) and marks none of them as edited.
- In the app it is a sheet with two plain choices: save a name, or "Show me as
  Anonymous". The sheet says that shops they book with still see their email,
  because "Anonymous" must not be mistaken for hidden from the shop.

## 145. "Browse all categories" is a wall of colour (2026-10-05)

It was a list of white rows, each with a small disc, a name and a "6 kinds"
link. It is now built to be looked at:

- **A staggered wall of tiles**, two heights in two columns (three or four on
  wider screens). Each tile is the category's own gradient (the colours it
  already wears on Home, §133) with its icon drawn twice — small in a white
  disc as a label, and very large, faint and tipped off the corner as the
  picture. They pop in one after another.
- **Each tile says what is in it**: "5 places · 6 kinds", or "Coming soon"
  where no shop has opened yet. The count is of branches, from one small
  search, and is shown only when that search returned every branch.
- **Tapping a tile lifts a sheet**: what the category covers, "See everything
  in …", and its kinds as chips. The wall stays clean and every subcategory is
  two taps away.
- **A search box** narrows the wall, and finds a KIND by name: typing "bar"
  offers "Barbershop — in Beauty & Personal Care" as a direct shortcut.

Where it leads is unchanged: back down to Home with the category (and kind)
applied (§133.6).

## 146. Service cards say where (2026-10-05)

A service card on Home named the business and not where it is, and the same
"Haircut · Kigali Barbers" is sold at two branches at two prices. Each card now
has a line with a pin: the branch's own name ("Kimironko", with a trailing
"Branch" dropped to fit), or its district when the branch is only named after
the business. The distance (§139) moved onto the same line, on the right.

## 147. The home screen says it is Rwanda (2026-10-06)

Nothing on the first screen said where the platform operates. Now the place
pill — the first thing on it — reads "Rwanda" beside the flag, and becomes
"Kigali" or "Gasabo" with the flag kept when a place is chosen. The place sheet
is titled "Where in Rwanda" and its first chip is "All of Rwanda" (~~was
"Anywhere"~~).

The flag is drawn (`src/ui/RwandaFlag.tsx`), not an emoji: the emoji is a
different picture on every phone and on some Android phones it is the letters
"RW". Official proportions, sun as a disc at this size.

**Rejected:** a banner, a country name in the title, or a flag on every card.
One quiet mark at the top, where a shop puts its city on the sign, says it
without turning the screen into a poster.

## 148. The shop's photos are a section, and they open (2026-10-06)

The branch's gallery was a strip of small pictures that did nothing when
tapped. It is now a "Photos" section with the count, "See all", the first six
in the strip (the sixth carries "+N" when there are more), and every one opens
the same viewer a service's photos open (§135.7) — so the two feel like one
thing.

## 149. Photos zoom (2026-10-06)

§135.7 left pinch-to-zoom out for want of a gesture library. It is in now, on
`PanResponder` and `Animated` like everything else: pinch to zoom (up to 4×),
drag to move around once zoomed, double-tap to jump in on the spot tapped or
back out. Let go below full size and it settles back; drag past an edge and it
springs back to the edge.

Nothing that worked before changed hands: a single finger on an unzoomed photo
still pages sideways or drags down to close, and a tap on the dark still
closes. Two fingers are never read as a drag, and while a photo is zoomed the
pager and the drag-to-close stand down.

## 150. A logo is shown only when the business added one (2026-10-06)

The shop circles on Home fell back from the logo to the cover photo and then
to the category's icon, so every circle looked as if it had a logo — including
businesses that had never uploaded one. Now a circle shows the logo, or the
business's initial on a plain disc (the `Avatar` the rest of the app uses),
which reads as "no logo yet". Service cards gained a small round logo badge on
the photo's corner, present only when the business has a logo; nothing stands
in for it.

## 151. No medals on the popular shelf (2026-10-06)

The "Most popular" shelf put a 1, 2, 3 on its first three cards. Removed, at
the user's request: the shelf's order already says it, and "4 booked" on the
card is the honest number. The logo badge (§150) takes the corner.

## 152. The gallery is a page (2026-10-06)

"See all" on a shop opened the first photo in the viewer — one at a time is not
all. `/gallery/:locationId` is the wall: the branch's own photos and every
service's photos together.

- **A lead photo**, large, with the shop's logo and name on it and what the
  photo is of.
- **A masonry** under it: two columns (three on wider screens), each tile at
  the photo's own shape, dropped into whichever column is shorter — nothing
  cropped square, no holes. Shapes are learnt as the images load
  (`Image.getSize`), so the wall starts at 4:3 and settles. Tiles pop in in
  order. Each carries a small tag saying which service it is.
- **Chips narrow the wall** to the place or to one service: "Haircut · 11",
  "Hair brading · 1".
- **Every tile opens the viewer** at that photo, and the viewer now shows the
  photo's label ("Oil change") beside its counter.
- A dark button at the foot leads back to the shop to book, because looking is
  for choosing.

The strip on the shop page stays, as a taste; "See all" goes here.

## 153. "No reviews yet" is gone (2026-10-06)

The shop page and the saved-places card said "No reviews yet" when a shop had
none. Removed at the user's request: it is not a fact about the shop, and it
read as a mark against it. The rating line simply appears once there is one.

## 154. The profile header changes sky every day (2026-10-06)

The dark header (§143) was the same gradient forever. `src/skies.ts` holds ten
— three gradient colours and two soft lights each, named for something in
Rwanda they are painted after (Lake Kivu, Volcanoes, Nyungwe, Savannah,
Coffee, Thousand hills, Imigongo, Akagera, Night market, Kigali at dusk). The
day of the phone's clock picks one, so it is the same for everyone that day
and new at local midnight; day eleven is day one again. No server, no setting,
no download. The sky's name sits in a small pill under the email, because a
page that changes should say so.

The one rule for a new sky: dark enough for white text. All ten were rendered
side by side and checked.

## 155. The quantity ceiling is 1000 (2026-10-06)

*Superseded by §189: "Most in one booking" no longer exists. 1000 survives
only as the bound on the number a booking or availability request may carry;
the real limit is the branch's places.*

"Most in one booking" was capped at 20 (§136.1). A business may sell a thing
by the hundred — prints, tickets, seats — so the ceiling is 1000 everywhere it
was 20: the CHECK constraint, `MAX_QUANTITY`, the service form, the booking
and availability DTOs. The floor stays at 2.

Past twenty the customer's − / + picker also lets the number be typed, clamped
to the range when the field is left; below it, two buttons are still all it
takes.

## 156. An empty today is the clock, not the shop (2026-10-06)

Opened after closing time, the booking screen showed today with "Nothing free
on this day" — which the owner read as the app giving the shop a day off. The
slots were right (every one had passed); the words were wrong.

- Today, with the shop closed by the clock: "Closed for today — the shop shuts
  at 17:00. Pick another day." Today, open but no slot left: "No times left
  today." Any other day with no slot: "Fully booked on this day." A day the
  shop does not open stays "Closed on this day."
- When today is already done, the screen moves on to tomorrow by itself —
  once, and only if the customer has not chosen a day.

## 157. Real roads, exact fixes, and the pin on a map (2026-10-06)

The list measured every branch as the crow flies (§107), with a rough GPS fix.
Right for sorting a list; wrong for "how long will it take me". Three changes:

### 157.1 Road distance and driving time, one branch at a time

`GET /locations/:id/route?lat&lng` (`src/routing/`) asks a routing service for
the real road and answers `{ distanceKm, minutes, by: 'road' }`. The service is
OSRM over HTTP (`ROUTING_BASE_URL`; the public instance by default, free and
fine for development; a self-hosted one or `""` to turn it off). Google's
Routes API would be a different URL and parser, not a different shape.

It never fails the caller: a slow or absent service (four-second limit)
answers with the straight line and `by: 'line'`, with no minutes — a time
nobody measured is not a time. Answers are kept ten minutes per start (to
about a hundred metres) and branch. Nothing about the customer is stored.

Shown on the shop page under the address ("8.5 km by road · about 14 min by
car") and on the reservation page as "Getting there", only once a position
is known — neither screen asks for the permission (§107.3). The list keeps the
straight line: a road route per card would be fifty requests per search.

### 157.2 The best fix the phone can give

`Accuracy.Highest` for the fresh position (the instant last-known one is used
first). A second or two slower and a little battery; the rough fix put a shop
across the street at "200 m".

### 157.3 The pin on a map, before it is saved

A seller who pastes the wrong link puts every distance on their branch out,
and nothing can tell. The business app now shows the pin on an OpenStreetMap
embed (no key) under the coordinates, on the new-branch form and when editing
a branch — which can now change its pin, by pasting a link or pressing "Use my
current position" (high accuracy) at the shop.

## 158. Saved services, beside saved places (2026-10-06)

A customer could save a shop (§120) but not the thing they actually wanted
from it. `service_favourites` keys on the service AT a branch — the same
"Haircut" is two prices at two branches, and the one saved is the one they can
walk to.

- `GET/POST /favourites/services`, `DELETE /favourites/services/:serviceId/:locationId`.
  Saving is refused (404) for anything the customer could not book right now.
- Every service card on Home and every service row on a shop page carries a
  heart, for a signed-in reader only (`saved` is absent otherwise, §120.2).
  Optimistic, put back on failure, patched across every list that shows it.
- The Saved tab has a Places | Services switch, each with its count. A saved
  service is a wide photo-first card: price and length on the picture, the
  shop's logo and name beneath, one dark "Book".

### 158.1 Gone for good, or just not now

Two kinds of "cannot book" (§120 kept everything and marked it; a service
needs the distinction):

- **Temporary** — branch closed, business paused or not approved, service
  paused at that branch — is kept, dimmed, and says "Not taking bookings right
  now" across its picture. It comes back on its own.
- **Gone** — the service retired by the business, or no longer sold at that
  branch at all — is taken off the list on the read that finds it, and the
  customer is told once: "One saved service is no longer offered and was taken
  off your list." A row that leads nowhere is worse than a shorter list.

A branch or service hard-deleted (which the app never does) cascades the save
away at the database.

## 159. Notifications, as an inbox (2026-10-06)

The list (§134) was rows that expanded in place, with no way to remove one.

- **Needs your attention** first: unread reminders, failed payments,
  cancellations and messages, each with a coral edge and the kind in a word
  ("Reminder", "Message"). Then everything by day — Today, Yesterday, This
  week, Earlier.
- **A card** is a coloured disc for the kind, the kind's word, the subject,
  the first line, the time, and a coral dot when unread. Tapping opens a sheet
  with the whole message, "Open the reservation" where there is one, and
  "Remove this notification".
- **Swipe left to remove**: the card slides, red with a bin shows behind, past
  a third of the way it goes; short of that it springs back. On
  `PanResponder`, like the photo zoom.
- **Removing marks, never deletes.** `notifications.dismissedAt`: the row is
  also the record of the email that was sent and the retry sweep reads it.
  `DELETE /notifications/:id`; `DELETE /notifications/read` clears every read
  one. A dismissed one leaves the inbox and the badge. Removing one someone
  else owns is "not found" without saying which.
- A filter (All | Unread · n), "Mark all as read" and "Clear read", each shown
  only while it would do something; an unread count badge in the heading.

**Left out on purpose:** undo (the server keeps the row, but a toast with an
undo was more than this list needs), per-kind settings, and grouping by
booking.

## 160. Undo after removing a notification (2026-10-06)

§159 left undo out; the user asked for it. `PATCH /notifications/:id/restore`
clears `dismissedAt` — the row was never deleted, so there is nothing to
recreate. It comes back as read (it was seen, or it would not have been swiped)
and in its old place.

In the app a dark bar rises at the bottom — "Removed · Undo" — with a thin
coral line that drains over five seconds, then sinks away. A second removal
replaces the first: the bar is for the last thing done. Undo puts it back and
refetches, so the server's answer decides what the list shows.

## 161. Read and unread are two weights of card (2026-10-06)

Unread was a bold subject and a dot on an otherwise identical card. Now an
unread card is white, raised, bold, with a coral "New" pill and dot; a read one
sits flat on the paper with a thin line for an edge, no shadow, its disc and
words faded, and a small double tick where the dot was. Same size either way,
so nothing jumps when one is opened.

## 162. Select several, and undo a clear (2026-10-06)

Long-pressing a notification did nothing; "Clear read" had no undo.

- **Long press starts selecting**, the way mail apps do it: the discs become
  tick circles, a tap selects or unselects, the header becomes a select bar —
  "3 selected", Select all / None, a cross to stop — with two actions: Mark
  read, Remove N. Swipe-to-remove is off while selecting, so a thumb cannot
  do two things at once. Selecting ends when an action is taken.
- **Bulk endpoints**: `DELETE /notifications` `{ids}`, `PATCH /notifications/restore`
  `{ids}`, `PATCH /notifications/read-many` `{ids}` — at most a hundred, only
  the caller's own rows move. `DELETE /notifications/read` now returns the ids
  it cleared.
- **Undo covers everything that removes**: one swipe, a selection, or Clear
  read. The bar says "Removed" or "8 removed" and puts back exactly those ids.

## 163. Lengths over an hour read as hours (2026-10-06)

"90 minutes" became "1 h 30 min" ("1 hour 30 minutes" in a sentence); under
an hour stays as minutes. One formatter (`src/duration.ts`) used on every card,
the shop page, the booking screen, checkout, the reservation, and the weekly
offers email.

## 164. Messages, as a chat app draws them (2026-10-06)

The list was plain rows; the thread was bubbles with a time on every one.

- **The list**: the shop's logo (added to `ThreadBusinessDto`) with a coral
  ring when something is waiting; a bold name; what the thread is about with a
  calendar glyph; the last line prefixed "You:" when it was the customer's, so
  nobody opens a thread to find out who is waiting on whom; the time the way
  chat lists say it (21:36, Yesterday, Thu, 6 Oct); an unread count, or a
  double tick when the last word was theirs. A search over shop, service and
  words said; an All | Unread filter; an unread total in the heading.
- **The thread**: a pill between days (Today, Yesterday, Monday); a run from
  one side within five minutes is one group — the corners square towards each
  other, the time and ticks only on the last; a photo opens in the viewer
  (§135.7); the booking it is about is a chip under the header, one tap to
  the reservation; the logo opens the shop.

**Left out:** read receipts (nothing records what the shop read), typing
indicators, swipe actions on the list, and archiving — a conversation about
a booking belongs where the booking is.

## 165. A new service is posted with its photos, in one go (2026-10-06)

Creating a service was "Save", which quietly made it live, and photos could
only be added afterwards from the list. Now the new-service form has a Photos
section — up to eleven, chosen as files, the first the cover, removable before
posting — and the button says **Post this service**, with "Goes live at 2
branches with 3 photos" beside it. Posting creates the service, then uploads
the photos in order while the button says which one is going. A photo that
fails after the service exists is reported with the service kept; it can be
added from Edit. Editing keeps its own button, "Save changes", and its own
photo manager.

Photos are not part of a DRAFT (§123): a draft is text, and a file needs a
service to belong to.

## 166. The keyboard no longer covers what is being typed (2026-10-06)

Every keyboard-avoiding view padded on iOS only; on Android it was left to
the system, which used to shrink the window for the keyboard. Android apps
from this Expo version draw edge-to-edge, and under that the window no longer
shrinks — so the message composer, the help form, the support reply, the
review box and the sign-in code all sat under the keyboard.

`behavior="padding"` on both platforms, in those five screens; the checkout
(the MoMo number field and the Pay bar) wrapped the same way; and the bottom
`Sheet` rises with the keyboard, which covers the review-name editor, the
"Offers near me" district picker and anything else that opens in one.

## 167. A question and a booking conversation look different (2026-10-06)

Both kinds of conversation (§21) looked alike. Now:

- **In the list** each carries a tag: coral **BOOKING** with the service and
  date, or blue **QUESTION** with "Asking before booking". Blue is new to the
  palette (`theme.ask`) and used only for this, so it stays a signal.
- **In a question thread** the header says "Asking before booking" in blue,
  and a blue banner under it says what the conversation is for — "Ask
  anything before you book" — with a **Book** button to the shop.
- **In a booking thread** nothing changed: the coral chip to the reservation.

`ThreadBusinessDto.locationId` (the business's first open branch) is what the
Book button and the logo open. The logo used to open `/shop/<business id>`,
which is not a branch and showed "not available" — fixed by the same field.

## 168. Every typing field stays above the keyboard (2026-10-07)

§166 fixed the screens whose field sits at the BOTTOM (the chat composer) but
not two other cases, and the user found them:

- **Bottom sheets** (the review-name editor). The sheet was absolutely
  positioned at the bottom, and an absolute child ignores its parent's
  padding — so the keyboard-avoiding view rose and the sheet stayed put. It is
  now laid out in the flow at the bottom of that view, and rises with it.
- **Fields in the middle of a scrolling page** (the MoMo number on Account and
  at checkout, the review and its name, the help form, the sign-in email and
  code, a typed quantity). Nothing scrolled them into view. `useKeyboardScroll`
  does what Android used to do by itself: when the keyboard opens, or a field
  is focused while it is open, it measures the focused field and scrolls the
  page by exactly the overlap. On a page not already inside a
  keyboard-avoiding view it also pads the bottom by the keyboard's height, so
  the page can scroll that far.

Fields at the top of a screen (the searches) need neither.

## 169. "Offers near me" can use an exact spot, measured by road (2026-10-07)

A district can be ten kilometres across, so "near you" from a district was a
guess. The user asked for the real distance from where the customer is.

- **"Use my exact location"** in the Offers sheet, above the district list:
  the phone's best GPS fix, named by the phone's own address lookup ("KG 11
  Ave, Kimironko") so the customer sees a street rather than numbers. Asked
  for only when pressed. "Update to here" and "Forget it". The row on Account
  says which is in use: "Exact spot · distances by road" or "Whole district".
- **Stored** as `users.homeLatitude/homeLongitude/homeLabel` (both or neither,
  by CHECK). Opt-in needs a district or a spot. Cleared on account close,
  included in the data export. Never shown to shops.
- **The email**, for someone with a spot: the most popular services within
  10 km, then 25 km, then their district's pick. Each line says how far by
  ROAD from the spot — one routing-table request per customer for all five
  shops (`RoutingService.fromPoint`), the straight line if the service does
  not answer. Subject "Popular near you", headline "near KG 11 Ave, Kimironko".
  Customers with only a district are picked per district, as before.
- **Privacy policy** rewritten for it (2.1, 2.3, 4.3, 6) and published as
  version 2, so signed-in customers are asked to accept it again. It also now
  says that road distances send map points — never a name or email — to a
  route-finding service.

**Not changed:** Home's distances still come from the phone's live position.
Using the saved spot there when location is off is possible but would show
distances from home while the customer is elsewhere.

## 170. Signed out, only what a visitor can use is shown (2026-10-07)

The user asked that someone who is not signed in should not see the icons and
buttons that only work with an account, and should get them after signing in.

- **Tabs.** Signed out, the bar shows Home and "Sign in" (the account tab, with
  a sign-in icon). Bookings, Saved and Messages are not drawn at all, and come
  back the moment the person signs in. Being signed out while on one of them
  (a session that ends) goes to Home.
- **Hidden:** the notifications bell on Home — until now shown to everyone
  (the code comment from §134 said so) and leading only to "sign in first" —
  and "Message the shop". Hearts were already hidden signed out.
- **Still shown:** browsing, shop pages, photos, times, distances. Booking a
  time stays open, because seeing the times is what persuades people; the
  button says "Sign in to book 10:00" with a sign-in icon, and signing in comes
  back to the same slot. This was a judgement call; the user can change it.
- **Account tab, signed out:** titled "Sign in", one card "One account for
  everything" that lists what an account opens, instead of each feature
  saying it separately.
- **Private pages behind a link** — one booking, a chat, writing a review, help,
  a help ticket — are wrapped in `requireSignIn` (`src/components/SignInWall`).
  Nothing signed-out links to them now, but an email, a notification or an
  expired session still can. Signed out they show what the page is and a
  "Sign in" button that returns to the same address, instead of failing
  requests. The check wraps the screen, so the screen's own hooks never run
  without an account.

Nothing changes on the server: every one of these was already refused
without an account. This is about not showing a door that will not open.

## 171. Home narrows to where the customer is right now (2026-10-07)

The user: *"focus on using the distance that comes from the phone's own
location at that moment, not from the account … filter services according to
their current location."* Proposed and agreed in three parts.

### 171.1 Within 2, 5, 10 or 25 km, or any distance

~~Once the app knows where the customer is,~~ Once "Nearest" is on (§175), Home shows a **Within** picker
(sliding, like Upcoming/Past) and searches with `radiusKm`. ~~It starts at
**10 km**.~~ It starts at **Any** (§173). The shelf says "within 10 km" once a
distance is picked; a green dot says "From where you are now".

- **It grows where shops are few.** A probe — the 50 nearest branches for the
  same filters, in distance order — says how far one has to go. The default
  grows to the next step until it holds **5 businesses**, and to every distance
  if none does, and says so under the picker: "Only 3 places within 10 km, so
  this shows up to 25 km." Checked from 17 km outside Kigali (grew to 25 km)
  and from Musanze (every distance). Early on, a strict 10 km would leave most
  of the country looking at an empty screen.
- **A distance the customer picks is kept exactly**, and grows only when there
  is nothing at all in it. Places close by with nothing to book get "Nothing to
  book within 2 km yet" and a "Look up to 5 km" button.
- **A named place and a distance replace each other.** Picking Musanze (or "All
  of Rwanda") sets the distance to any; picking a distance clears the place.
  Together they would match nothing.
- Branches with no pin cannot be inside a distance; they show under "Any".
- `nearReach.ts` holds the rule, apart from the screen.

### 171.2 Followed while the app is open

`useNearMe` is now one store for the whole app instead of one per screen, so
Home's cards and the shop page's road distance are measured from the same
fix. Once allowed:

- a new position every **~200 m** of movement (`watchPositionAsync`, High
  accuracy, at most every 20 s on Android), and a fresh Highest fix each time
  the app comes back to the front — which is also how turning location on in
  Settings takes effect without a tap;
- a new fix replaces the one in use only past **150 m**, or when it is at least
  twice as sharp, because each replacement re-asks the server for every list;
- following **stops** when the app goes to the background;
- while the lists re-ask after a move, the old answer stays on screen
  (`placeholderData`) and the pull-to-refresh spinner does not turn — moving is
  not refreshing. A change of filter still shows the grey placeholders.

Nothing is stored, here or on the server; the position goes only with a
search, as before. The phone's permission sentence now says "while the app is
open … never saved" (needs a new native build to show on iOS).

### 171.3 The question is asked where it is seen

The quiet row near the bottom of Home (§139) is now a card under the search
bar: a pin sending out rings, "See what is near you", **Use my location** and
**Not now**. Still never asked on open — the phone's prompt appears only when
the button (or "Nearest") is pressed. It also says what happened on every
answer: "Try again" after a no, **Open Settings** when the phone will not ask
again (`canAskAgain`), "Try again" when there was no signal. That replaces the
yellow notice under the chips. "Not now" is remembered on the phone; the card
still comes back to report the outcome if the customer later presses Nearest.

**Not changed:** "Offers near me" emails still use the saved home spot (§169).
They are sent while the app is closed, when the phone's position is not known
— asking for "always" location to fill that gap is what phones make hardest
and people trust least.

### ~~171.4 Slimmer controls (2026-10-07)~~ — superseded, reverted the same day

~~Asked for more room: the search field is 46 high instead of 54 (Messages'
search matched, from 48), and the Within picker uses a new `compact` size of
`Segmented` — 38 instead of 48, 13 px labels — with less space above it.~~

Tried and reverted at the user's request: *"revert the previous sizes they
were great."* Search 54 (Messages 48) and the full-size picker stand.

## 172. "Weekly offers by email", for an address the customer can type (2026-10-07)

Asked whether the setting was still needed now that Home uses where the phone
is (§171). Yes — it is an email, sent on Friday while the app is closed, when
nothing knows where the phone is. But its name, "Offers near me", now sounded
like the live location, so it was renamed, and the user asked that the address
it uses be stated right after the name, so a wrong one can be picked or
corrected.

- **Renamed** "Weekly offers by email" — on the card, in the email's footer, in
  the data export, and in the Terms (v5) and Privacy Policy (v3), published
  with the note *""Offers near me" is now called "Weekly offers by email", and
  you can type the address it is sent for."*
- **The address under the name.** "SENT FOR · KG 11 Ave, Kimironko", with
  "Change" beside the label so the address has the full width on a small phone,
  and "Saved address · measured by road" or "Whole district" under it. With
  none: a dashed "Add the address to send offers for".
- **Three ways to set it**, in one sheet, saved one shown at the top with
  "Forget it":
  1. **Type it and pick** from what the map finds — new.
  2. **Use where I am now** — the exact spot (§169), for someone standing at it.
  3. **A whole district** — choosing one now forgets a saved address, or the
     email would go on using the address.
- **The email footer says which address** it was sent for, and where to change
  it.
- **Consent stays explicit.** Choosing an address turns the emails on only when
  the sheet was opened from the switch; changing it otherwise leaves the switch
  as it was. (§169's "Use where I am now" used to turn it on regardless.)

### 172.1 Finding a typed address

*(The search service and its rules below are ~~Nominatim's~~ — replaced by
Photon in §174, for suggestions while typing.)*

`GET /addresses?q=` (`src/routing/address-search.*`), signed in only. It asks
**Nominatim**, OpenStreetMap's search — the same open map as the road distances
(§157) — for places in **Rwanda only**, and answers up to six
`{ label, detail, latitude, longitude }`, labelled the way a person says them
("Kimironko Market, KG 161 Street, Kimironko" · "City of Kigali").

The public server is free on conditions, all kept: callers name themselves
(`GEOCODING_USER_AGENT`), **one request a second** for the whole platform
(searches queue and wait their turn), and **no search-as-you-type** (the app
searches on "Find"). Same words are answered from memory for a day. Only the
typed words are sent, never who typed them; the Privacy Policy lists it as
[ADDRESS SEARCH SERVICE]. `GEOCODING_BASE_URL=""` turns it off.

It never fails the customer: a slow, refusing or absent service answers
`available: false`, and the app says search is not working and offers the
other two ways — different from "Nothing found for …". Eight tests, including
Rwanda-only and the spacing, both proven by breaking them.

### 172.2 The publish script asks what changed

`npm run legal:publish` always wrote "Rewritten in full for Rwandan law" as the
change note — right for v2, wrong for every update after, and customers are
shown it when asked to accept again. It now takes the sentence:
`npm run legal:publish -- "What changed."`, and refuses an update without one.

**1311 passing across 56 suites.**

## 173. Home's distance starts at "Any" (2026-10-07)

Asked: *"make the default to be 'any' instead '10km' on the home screen."*
`DEFAULT_WITHIN` is now `null`: once location is on, every shop is still
shown, each with its distance, until the customer picks 2, 5, 10 or 25 km.
That puts Home back in line with §106.2 — nothing narrows itself.

Picking a distance behaves as in §171.1: kept exactly, grown only when there
is nothing in it, with "Look up to 5 km" when nothing close is bookable. The
"grow to five places" rule for an unchosen distance stays in `nearReach.ts`
but no longer runs, since nothing is chosen for the customer; it is there if
a default distance comes back.

## 174. Addresses suggested while they are typed (2026-10-07)

Asked: *"make autocompletion of address possible so that the user doesn't
have to type everything."* Now three letters are enough: "kimir" offers
Kimironko, Kimironko Market, the taxi park; "KG 11" offers KG 11 Avenue first.

### 174.1 Photon, not Nominatim

Nominatim's public server, used in §172, **forbids search-as-you-type** in its
usage policy. Photon (photon.komoot.io) is the OpenStreetMap search built for
it — the same map data, prefix matching — and its public server is free for
fair use. Checked against Rwanda before switching: streets ("KG 11 Avenue"),
neighbourhoods, markets, malls and sectors all come back.

- Asked for Rwanda's box (`bbox`), then filtered to `countrycode: RW` — the box
  takes in parts of every neighbour (a "Nyamirama" in Uganda came back).
- Rivers, streams and hills (`waterway`, `natural`) are dropped; the same shop
  found as a shop and as a building is one choice; at most six.
- Said the way a person says it, the smallest place first — "Remera ·
  Ruheru, Nyaruguru District" — except Kigali, the one city with districts
  inside it: "Kigali Heights, KG 7 Avenue · Gasabo District, Kigali".
- Searches are spaced at least 250 ms apart platform-wide
  (`GEOCODING_SPACING_MS`), the same letters are answered from memory for a
  day (at most 5,000 remembered, oldest out), and only the letters are sent.
  **Before launch, self-host Photon for Rwanda** — one small server — and
  point `GEOCODING_BASE_URL` at it; the public one promises nothing.

### 174.2 In the app

- Asked when typing pauses (350 ms), not on every letter; a question overtaken
  by more letters is cancelled (`api()` now takes a `signal`). Return asks at
  once.
- The last suggestions stay, dimmed, while the next arrive — no blinking.
- The typed letters are picked out in each suggestion: **Kimir**onko Market.
- **While typing, the sheet shows only the field and its suggestions**, with
  "Cancel" — the sheet can be 82% of the screen, and the field has to stay
  above the keyboard. Clearing it or Cancel brings back "Use where I am now"
  and the districts.
- Under three letters: "Keep typing…"; nothing found, search down, and an
  error each say so differently, as in §172.

The Privacy Policy already says the address search receives "only the words
you typed", which is still true, so it is not republished.

Nine tests (one new: smallest-first). **1312 passing across 56 suites.**

## 175. The distance picker belongs to "Nearest" (2026-10-07)

Asked: *"display 'within from where you are now' only if the user clicks on
nearest filter so that we can use the space for something else."*

- The **Within** picker shows only while **Nearest** is on, fading in under
  the chips when it is tapped. The rest of the time that room is Home's.
- A distance narrows the lists **only while Nearest is on**. Turning Nearest
  off, or choosing Best rated, Cheapest or Newest, puts it back to Any — at
  once for the lists (it is derived, not waited for), and for next time. A
  list is never cut short by a control that is not on the screen.
- Distances on every card are unchanged: they still show whenever location is
  on, Nearest or not (§139).

## 176. Spotlights: a banner at the top of Home (2026-10-07)

Asked for an advertising-style banner at the top of Home showing different
things — most rated, near you, cheapest, newest, the best business — each in
its own colours and design, that disappears after a while and comes back.

### 176.1 What it shows

Up to six spotlights, from the same discovery search as the rest of Home, so
every one is a real service bookable now (`src/components/Spotlights.tsx`):

| Spotlight | Colours | Reason shown on the photo |
|---|---|---|
| Most booked | rose → coral, flame | "3 booked" |
| Top rated | plum → violet, star | "★ 5.0" |
| Near you (with location) | forest → emerald, rings | "2.6 km" |
| Best price | rust → amber, price tag | "RWF 5,000" |
| Just added | navy → blue, sparkles | "New" |
| Top business | black → slate, gold trophy | "★ 5.0", "Visit" |

**Labels stay true.** Most booked, best price, nearest and top business are
exactly the first answer. If that is something already shown — the most
booked haircut is also the cheapest — the spotlight is left out, not swapped
for something it is not. Only "Top rated" (anything 4.5★ and up) and "Just
added" may choose, and they prefer a business not shown yet. None is paid for.

### 176.2 How it looks and moves

A gradient card the width of the content, 172 high on a phone: kicker pill,
two-line title, one line of where, a white "Book now" in the deepest shade of
its colour; on the right the photo in a white frame tilted 5° over a tinted
card tilted the other way, the business's logo at its corner and the reason
on a chip. Behind it, two soft discs and the kind's own icon, huge and faint,
turning slowly ("Near you" has rings going out instead).

Arriving, the words rise in, the photo settles and drifts slowly closer, and
a light passes over it once. Under the card, the active dot is a small bar
that fills in the spotlight's colour while it is on screen. All transform
and opacity animation is native; "reduce motion" turns off the drift, sweep
and turning. On a tablet the photo turns landscape and the title grows.

### 176.3 When it shows

- ~~Each spotlight for 5.2 s, once round, then the banner **folds away** (height
  and fade, giving back the row gap so no band is left) and **comes back two
  minutes later** from the first. A banner that never leaves is wallpaper.~~
  Superseded by §178: once round, then it stops on the first and stays.
- Touching it holds it still; swiping moves through it; letting go starts the
  count again.
- Only while browsing: a search or a category is someone saying what they
  want, and the banner would push it down.
- The set is fixed for a whole round, taken once every search has answered
  and renewed only while folded: the searches land one by one, and a slide
  inserted ahead of the one being read moved it out from under the reader on
  the web.

`PressableScale` now passes `onPressIn`/`onPressOut` on as well as using them,
which the banner needs to hold still under a finger.

**Open question:** the user also listed "with commission". There is no
per-business commission or paid placement in the platform today — every
business pays the same platform fee — so it is not built; asked what it means.

## 177. The banner comes and goes in two steps (2026-10-07)

Asked for a better transition when the spotlights appear and disappear.

- **Arriving:** the room opens first (460 ms, ease-out) so the rows below ease
  down, and 170 ms later the banner rises 14 px into it, from 95% size and
  transparent, with a light spring.
- **Leaving:** the banner fades, shrinks and drops back first (260 ms, ease-in),
  THEN the room closes (420 ms, ease-in-out). Before, both happened at once,
  and the rows below slid up under a banner that was still visible.
- The room is height, so JS-driven; the banner is a separate inner view whose
  fade, rise and scale run natively. "Reduce motion" keeps the room's easing
  but drops the spring and the delay.

**Asked alongside:** whether folding away on a timer is professional. Answer
given: the large marketplaces keep a promotional banner in place, stop it
moving after a round, let the customer close it, and refresh it on the next
visit — content shifting on its own causes mis-taps (the "layout shift"
browsers score pages down for). ~~The timer stays until the user chooses.~~
The user chose that (§178).

## 178. The banner stays, stops, and can be closed (2026-10-07)

Offered the choice after §177, the user picked the recommended behaviour:

- **Stays in place.** No folding away on a timer, so nothing on Home moves on
  its own under a finger.
- ~~**Stops after one round.** Each spotlight for 5.2 s, then it glides back to
  the first and stays still, its bar full. Swiping still moves through it.~~
  *Superseded by §188: it keeps going round, slower.*
- **× to close**, top-right over the card (not in a slide, so it stays put),
  dark glass with a white edge so it reads on any photo. Closing uses §177's
  leave transition. It stays closed for the rest of the visit, even leaving
  Home and coming back.
- **Fresh on the next visit.** A cold start, or coming back after 30 minutes
  or more in the background, counts as a new visit: a closed banner returns,
  the set is taken afresh, and it ~~goes round once more~~ starts again from
  the first (§188).

The two-minute rest timer is gone.

## 179. The service page, rebuilt as the page that sells (2026-10-07)

The user: *"the service detail page … doesn't look really great like how
many card's detail page should look … this is the page that convinces the
user to purchase or not … look at how top professional pages design this
page and do better."* Studied the reference designs (§133) and the pages
that sell best — a listing on Airbnb, a service on Fresha or Booksy, an item
on a food app — and built `app/book/[id].tsx` again from the top, in the
order a person decides:

1. ~~**The photos**, edge to edge and a page at a time (`PhotoPager`), with
   dots and "2 / 5"; parallax at half speed and a stretch when pulled past
   the top, pinned to the top edge.~~ Superseded by §181: a mosaic, several
   at once. No photos: the shop's cover, then the category's tile. ~~Back,
   share and the heart float over it; a title bar fades in once the name has
   scrolled under it.~~ §181: a normal top bar, share and heart on its right.
   ~~A single photo fills the width (§135.4)~~ — superseded; there is no
   strip now.
2. **What it is**: category pill, "Open now", "Up to 5 people"; the name;
   how long and where.
3. **What it costs**, with the deposit DRAWN: the price per person, a bar
   showing the deposit's share, "Pay now" in coral and "At the shop" beside
   it, and a green line saying a 10% deposit holds the time. The two sums
   roll (`Ticker`) when "how many" changes.
4. **Why it is safe**: three tiles, each true of every booking — MTN MoMo,
   confirmed the moment you pay, refunded if the shop cancels (Terms 6.1).
   Nothing about free cancellation, which is not true (6.2).
5. **Who**: the business card — logo, name, branch, rating, "8.5 km · 14 min
   by car" from where the phone is (§157) — and, signed in, "Have a question?
   Message the shop" (§167).
6. **About this service**: the description, three lines and "Read more".
   It existed on the service and was never shown.
7. **What people say**: the rating large, the stars, up to two reviews with
   words (most recent, never cherry-picked), "See all N" to the shop's
   Reviews tab — which a link can now open directly (`?tab=reviews`).
8. **Choose a time**: how many (§136), the days with "Today", and the times
   grouped **Morning / Afternoon / Evening** with how many are free
   (`src/booking/periods.ts`) — thirty-five identical buttons were a wall.
9. **Your booking**, read back in a dark card the moment a time is chosen:
   day, start – end, how many, how long, the shop, total and pay-now. The
   page glides down to it.

**The bar at the bottom** is the running answer to "what will this cost me":
Total (rolling), "RWF 3,000 now", and ONE button that is never dead — with
no time chosen it is "Choose a time" and takes you to the times; then
"Book 11:00"; signed out, "Sign in to book" (§170). On a narrow phone the
price shrinks and the button shortens rather than anything wrapping.

*(The ORDER of sections 2–9 above is superseded by §181, which groups them
into one card and moves the place and the assurances after it.)*

Checked at 320, 390 and 820, with 2 and 11 photos and with none, signed in
and out, with a time chosen and with "how many" changed. Two demo services
were given descriptions so the About section could be seen. Nothing on the
server changed.

## 180. A description and "Before you come" on every service (2026-10-07)

Asked: *"allow sellers to add special instructions on a deal and also add
description for each service too and all should show up on the customer
app."* A "deal" here is a service.

- **The field.** `Service.instructions` (text, up to 600 characters — read on
  a phone the day before) beside the `description` that existed (2,000) and
  was never asked for in the seller's form. Both are trimmed, and a blank is
  stored as **nothing**, not "": in the DTO (`@Transform`) and again in
  `ServicesService` (`tidyWords`) for every caller that is not HTTP — a test
  caught the service path storing "". `ServiceDraft` carries both too, so a
  draft keeps what was written.
- **The seller writes them** in the service form (new and Edit), as two
  full-width text boxes under the prices with counters and a line saying
  where each appears; the list says "No description" / "No instructions" per
  service, so the gaps are seen at a glance. Both autosave into the draft.
- **The customer reads them** in three places: the description under "About
  this service" on the service page (§179, already built for it);
  instructions as a **"Before you come"** card — one component,
  `src/booking/BeforeYouCome.tsx`, so it is the same note in both places — on
  the service page between About and the reviews, and on the **reservation**,
  between the action buttons and the details, while the booking is still
  ahead (booked, in progress, or awaiting payment). The reservation reads it
  live from the service, so a change at the shop reaches bookings already
  made; `AppointmentServiceDto` gained the field, and the §32 test that pins
  that object's keys (so the live price can never leak) now lists it.
- Shopfront, seller list and bare-row DTOs declare it; the exactness guards
  caught the one that was missed. OpenAPI and the three `schema.d.ts` regenerated.

Three new tests (`service-instructions.spec.ts`). **1315 passing across 57
suites.** Demo: Full-body massage, Haircut and Hot-towel shave given notes.

## 181. The service page in four blocks, photos as a mosaic (2026-10-07)

The user, with a screenshot of the arrangement wanted: *"first attached
screenshot is how i need the images arranged … price, choose time, special
instructions, description should be on the same container and then link to
the place and assurance three boxes should follow last … to avoid confusing
the buyer."* §179's page re-ordered into four blocks, top to bottom:

1. **The photos as a mosaic** (`src/components/PhotoMosaic.tsx`, replacing
   `PhotoPager`): one large photo and beside it up to four small ones in a
   grid, the way the screenshot shows — so a buyer sees what there is without
   swiping. Two photos is big + one tall; three is big + two stacked; five or
   more is big + 2×2, the last tile saying "+6". Every tile opens the viewer
   at that photo (§135.7). On a tablet the big one takes half; on a phone 60%.
   Every tile is given its exact size: `PressableScale` draws its style on an
   inner view, so `flex` on a tile sized the inside and not the tile, and the
   grid rendered empty until it was done by arithmetic.
2. **The deal, in ONE card**, separated by thin rules: the pills, name, length
   and place; the price with the deposit drawn as a bar; **Choose a time**
   (how many, day, morning/afternoon/evening times, the dark "Your booking"
   read-back under them); ~~**Before you come** (§180); **About this
   service**~~ — moved out of the card, above it (§182).
3. **The place**: the business card (logo, rating, road distance, →) and
   "Have a question? Message the shop", ~~then **What people say**~~ —
   removed (§182).
4. ~~**The three assurances** last: MTN MoMo · Confirmed · Refunded if the shop
   cancels.~~ Redesigned as one "Safe to book" card (§182).

The hero's parallax and the floating buttons went with the edge-to-edge
photo; the page has an ordinary top bar again, with share and the heart on
its right, which also means the name is always visible. "Choose a time" in
the bar scrolls to that section inside the card, measured against the scroll
view's frame rather than the window, so the top bar's height is not
mis-counted.

Checked at 320, 390 and 820, with 2, 3 and 11 photos and with none.

## 182. The shop's words first, reviews off, "Safe to book" (2026-10-07)

The user: *"add the description as the first item and special instruction as
second just between the photos and the following container (not in the same
container as the price and the rest but just outside the containers), and
find a better way to design the three items … lastly remove the reviews from
that page too."*

The service page now reads, top to bottom:

1. The photo mosaic (§181).
2. **About this service**, then **Before you come** — on the page itself, no
   card, ~~each with a small coral icon disc beside its heading so the two read
   as a pair~~ (the icons removed at the user's request, §183). The description shows four lines and "Read more" past 200
   characters. Either is simply absent when the shop wrote nothing.
3. The deal card: name, price and deposit, how many, day, time, read-back.
4. ~~The place: the shop card and "Have a question? Message the shop".~~
   Moved up, made one slim line under the photos (§278).
5. ~~**Safe to book**, last.~~ Taken off this page (§278).

**Reviews are gone from this page** — the section, its request and its
components. The shop card keeps its one-line "★ 5.0 (1)" as a fact about the
place; the full reviews are a tap away on the shop's page, which still opens
on its Reviews tab with `?tab=reviews` (§179) for any link that wants it.

**"Safe to book"** replaces the three narrow tiles, whose words wrapped into
fragments ("the moment you / pay"). One card, a green shield and "Every
booking here comes with these", then three rows, each with its own mark and
colour and a full sentence:

- the real **MTN** mark (§134.3) — *Pay with MTN MoMo: you approve the deposit
  on your own phone; this app never asks for your PIN* (the PIN is typed into
  MoMo's own prompt, as checkout says);
- green lightning — *Confirmed the moment you pay*;
- blue arrow — *Refunded if the shop cancels: your whole deposit goes back to
  the number that paid* (Terms 6.1 and 6.6).

The row component is `Assurance`; it was first written as `Promise`, which
would have hidden JavaScript's own `Promise` in that file. (§278: it lives on
as `Pledge` in `src/booking/PayingPromises.tsx`.)

## 183. Signing in, redesigned (2026-10-07)

Asked, with five reference designs: *"think deeper about how our
authentication screens should look … great convincing and colored writings
… remember we just add email and verify with otp for both registered and
registering users … when users add their emails you check if it exist or
not … make the most prettiest ui out of this section."* Also: remove the
icons before "About this service" and "Before you come" — done, in both
places "Before you come" appears (service page and reservation), so it stays
one recognisable note.

### 183.1 The flow is the one the server already had

Nothing changed underneath (§50, §90.3, §126.2): one email box for everyone;
the code is asked for with no role; an address with an account gets a code at
once ("Welcome back"); an address without one is answered "no account yet",
which the screen treats as somebody new — a welcome, why an account is worth
having, an explicit tick for the Terms and Privacy Policy, and "Create my
account", which asks again with `CUSTOMER`. The same 6-digit code then signs
in or creates the account.

Two rough edges in it, fixed on the way:

- **"Please wait 47s"** after asking twice is no longer an error. A code sent
  under a minute ago still works, so the screen moves to the code step, says
  "We sent you a code a moment ago. Enter that one.", and counts the 47
  seconds down before offering a new one.
- **A business or admin account** signing in here used to be shown an error
  while its tokens stayed on the phone — the app was quietly signed in as a
  shop. It is now signed straight back out, and told to use another email.

### 183.2 How it looks (`app/sign-in.tsx`, `src/auth/`)

- **A living wall** (`AuthWall`): real service photos from the shops — the
  service's own photo, not the shop's cover, which is often a logo — in three
  columns (five on a tablet), drifting past each other, turned −10°, under
  night rising from the bottom and the app's coral from the top corner. Until
  six photos are known, the categories' own colour tiles stand in.
- **The headline**: "Book your next **haircut.**" in white, the last word in
  gold changing every 2.3 s — haircut, massage, braids, car service, photo
  shoot, workout — rising out and springing in (`RotatingWord`). "Real shops
  near you, booked in a few taps." under it; a glass "Made for Rwanda" pill
  with the flag and a glass close button above.
- **A white sheet** overlapping it with 32-point corners, one question per
  step, each title with its coloured words: **"One email. No password."**,
  **"Nice to meet you."**, **"Check your inbox."**, then **"You are in!"** or
  **"Welcome aboard!"** with a green tick popping in, before closing back to
  where the customer was (`next`).
- **The email field** lights coral when focused, ticks green when the address
  looks right, and offers **"Did you mean …@gmail.com?"** for the usual slips
  (`src/auth/email.ts`) — offered, never applied.
- **The new-account step** lists three reasons, each in its own colour (coral
  calendar, the real MTN mark, blue heart), above the tick card.
- **The code** (`CodeBoxes`): six boxes over one hidden field (paste and the
  phone's code suggestion still work); a digit pops in, the next box waits with
  a blinking coral caret, the row breathes while checking, shakes red when
  wrong (then clears for another try), turns green when right. Six digits
  verify by themselves; "Verify" stays for a slow connection. The email shows
  as a chip with "Change"; "Send a new one in 0:58" counts down the server's
  60 seconds; "each code works for 10 minutes".
- Errors in plain words, right under the thing they are about.
- **When the keyboard opens the wall folds** to a strip under the status bar
  and the headline fades, so the question and its button always fit;
  `KeyboardAvoidingView` padding as everywhere (§166). "Reduce motion" holds
  the wall and the word still (`useReducedMotion`, now shared in `Motion.tsx`).

### 183.3 The code email matches

`sendOtpEmail` was one plain sentence. It is now the app's paper and coral: a
coral band, "Here is your code", **the six digits in six coral boxes** like
the screen, "It works for 10 minutes, and only once", and a calm line for
anyone who did not ask. The code is also in the subject — "Your sign-in code:
481982" — so the notification alone is enough. Checked in Mailhog at 390 and
320 wide; the boxes were narrowed to fit a 320 phone.

Verified end to end in the preview with real codes read from the dev log: the
email step, the "gmial" hint, the new-account step, "Welcome back", a wrong
code, and a right one ("You are in!"). **1315 passing across 57 suites.**

## 184. One dialog for every question and message (2026-10-07)

Asked: *"redesign the popup messages like the sign out popup looks default
instead of custom design of our app … same for the popups like location turn
on request etc, make them have similar ui look to keep consistency."*

The customer app called the phone's own `Alert.alert` 29 times in 13 files —
a grey system box that looked like a different app each time. All 29 are gone.

### 184.1 `src/ui/Dialog.tsx`

One `DialogHost`, mounted once at the root beside `LegalPrompt`, and three
calls usable from anywhere — a screen, a hook, a mutation's `onError` — the way
`Alert.alert` was:

- `showDialog({ title, message, tone, icon, actions })`
- `showProblem(title, error)` — the server's own sentence when it sent one,
  "Please try again." otherwise (18 of the 29 were exactly this)
- `confirmDialog({ … }) → Promise<boolean>`

The look: a white card, 28-point corners, over a dimmed screen. At the top, a
coloured disc in a soft halo saying what kind of message it is — **red**
(danger) for what cannot be undone and for failures, **coral** (accent) for
the app's own questions, **green** (ok) for done, **blue** (info), **amber**
(warn). Then the title in the app's heavy face, the words centred, and
full-width pill buttons: the filled one in the tone's colour, the quiet one
grey. Two short labels sit side by side; longer ones stack, the primary on
top. It rises with a small spring and fades out; a warning or success
vibration matches the tone. The quiet button, Android's back and a tap
outside all mean "no". A button whose work takes a moment (Sign out) spins
until it is done, so it cannot be pressed twice. Dialogs queue, one at a time.

### 184.2 Where

Sign out (coral), Close your account (red), Cancel this booking (red),
"Sent" after a new arrival code (green), Account closed (green), Could not
open maps (amber), Photos are not allowed (amber), every "Not saved / Not sent
/ Could not …" (red).

### 184.3 Location

The phone's own "Allow location?" box is drawn by Android and iOS; **no app
can restyle it**. So the app now asks in its own dialog FIRST wherever the
tap does not already explain itself: **Nearest** on Home shows "See what is
near you?" — what location is for, only while the app is open, never saved —
and only "Use my location" goes on to the phone's box. When the phone will
not ask again, the same dialog offers **Open Settings** instead.
(`useNearMe().enable({ explain: true })`, which now resolves whether location
came on.) Home's "See what is near you" card does not repeat the question: the
card already says all of it.

In the offers sheet, "Use where I am now" no longer opens a pop-up over the
sheet: a problem is said in the sheet, under the button, with **Open
Settings** when only Settings can help.

The share sheet and the photo picker are the phone's own, on purpose.

## 185. A title for every service, under its photos (2026-10-08)

Asked: *"when creating a service, can you also add a title for the service
that will display first after the images in the customer app."*

A service already has a NAME ("Haircut") — the short label on cards, shelves,
bookings and receipts, which must stay short. The title is a separate,
optional headline for the service's own page: "Sharp fades and clean
line-ups".

- **`Service.title`** (and on `ServiceDraft`, so a draft keeps it), up to 100
  characters — one or two lines on a phone. Trimmed, and a blank stored as
  nothing, like the description and instructions (§180): `@Transform` in the
  DTO and `tidyWords` in `ServicesService`. On the seller's, bare-row,
  draft and shopfront DTOs; not on search cards or bookings.
- **The seller** writes it in the service form (new and Edit), the first of
  the three full-width word boxes — Title, Description, Special instructions —
  in the order the page shows them, with a line saying the name above stays
  the short label on cards. Autosaved into the draft. The list says
  "Title" / "No title" per service.
- **The customer** sees it right under the photo mosaic, before "About this
  service": 27-point extra-bold (24 on a narrow phone), on the page, no card.
  With no title, the page is as before.

A fourth test in `service-instructions.spec.ts` (the 100-character limit),
and the existing ones extended to trim the title and carry it to the
shopfront. **1316 passing across 57 suites.** Demo: Full-body massage and
Haircut given titles.

## 186. Sales: a shop puts a service on discount (2026-10-08)

Asked: *"can we add discount functionality too."* Built as the discount a
marketplace's sellers expect: the SHOP puts a service on sale. (Promo codes a
customer types at checkout are a different feature, and not built.)

### 186.1 The rule

- **A whole percentage, 1–90, off every branch's price**, optionally until a
  **last day** (in the platform's time zone, bookable all of that day), or
  until the shop ends it. `Service.discountPercent` and `discountEndsOn`
  (a DATE), with CHECKs for the range and for "a last day needs a
  percentage". On `ServiceDraft` too.
- **It applies to bookings MADE while it is on**, whatever day the visit is.
  The price the customer is shown is the price they agree to.
- **Taken off one unit, rounded half up to a whole unit, then multiplied**
  (§136): the price on the card times three is what three cost.
- **The deposit and the platform fee are shares of the price after the sale**,
  so the fee still fits inside the deposit and fee + business = deposit
  (§40). The sale costs the shop, not the platform: the platform's share
  shrinks in proportion.
- **The booking remembers it**: `Appointment.discountPercent` and
  `listPriceMinor` (the whole booking before the sale) beside the agreed
  `servicePriceMinor`. Ending or changing a sale never rewrites a booking.
- One helper, `src/business/discount.ts` (`liveDiscount`, `discountedPrice`,
  `priceFor`), used by booking, search, the shopfront and saved services, so
  every screen and the charge agree.

### 186.2 The seller

A **Sale** box in the service form (new and Edit, kept in the draft): percent
off, an optional last day (not before today), "End the sale", and — as it is
typed — what customers will pay at each branch ("customers pay RWF 6,800
instead of ~~RWF 8,000~~"). A sale that has ended starts the form empty and is
cleared on the next save; the server also accepts a stored past last day sent
back unchanged, so editing the name of a service whose sale ended is not
refused. The list shows "15% off · until Sun 12 Oct" in coral.

### 186.3 The customer

- Search, the shopfront and saved services send `priceMinor` as the price
  PAID today, and `discount: { percent, endsOn, listPriceMinor } | null`.
  Every existing price on every screen is therefore already right; the sale
  is drawn on top. "Cheapest" sorts by the price paid; `maxPriceMinor`
  filters by it.
- **Small cards**: "−20%" badge in the photo's top corner (the logo moves
  under it), price in deep coral. No crossed-out price there — a card that
  narrow cut one of the two prices short.
- **Shop rows**: the badge on the photo; the price with the old one crossed
  out beside it.
- **Saved services**: badge, and the old price crossed out on the photo.
- **The service page**: the price in coral with "per person"; then the badge,
  "Was ~~RWF 30,000~~ · sale until Mon 12 Oct" and "You save RWF 6,000" (on
  the whole booking, growing with "how many"); "Total · 20% off" in the bar;
  the saving in the dark "Your booking" card.
- **Checkout and the reservation**: a "Sale · 20% off" line, "−RWF 6,000",
  in green.
- **Home**: an **On sale** shelf (`onSale=true`: sales only, biggest first),
  and an **On sale** spotlight (§176) — plum to pink, price tags, "−20%",
  "now RWF 24,000, was RWF 30,000" — the biggest sale, picked exactly.
- **The weekly offers email** (§140) shows the sale price, the old one
  crossed out and "20% OFF".

**Not changed:** a place's "from" price (`fromPriceMinor`, §44) is the list
price; it is stored, and a sale ending would leave it stale without a nightly
job.

`service-discount.spec.ts`: eleven tests — the arithmetic, the last day,
booking at the sale price with the record kept, three units, a sale that has
ended, a sale changed after booking, what search/shopfront/saved show, the
on-sale filter and order, sorting by price paid, and the seller's limits.
Breaking the sale price on purpose fails five of them. **1327 passing across
58 suites.** Demo: Full-body massage 20% off for four days, Hot-towel shave
15% off with no end.

## 187. The seller chooses a service's cover photo (2026-10-08)

Asked: *"when adding images as well, there should be switching of cover
images for the service — the image that displays on the card in the buyer
app."* The cover was whichever photo was uploaded first, and the only way to
change it was to delete photos and upload them again in a different order.

- **`PATCH /business/services/:id/images/:imageId/cover`** (owner or manager)
  puts that photo first and renumbers the rest 1, 2, 3… in the order they
  already had, in one transaction, and answers with the new listing. Another
  shop's photo, or one from a different service, is a 404 and moves nothing.
- Every customer screen already leads with the first photo by
  `displayOrder` — the card on Home, the shop's row, the big photo of the
  service's page (§181), saved services, the spotlights — so they all follow.
  Checked live: making Haircut's second photo the cover changed its Home card;
  making the first the cover again put it back.
- **The seller**: each photo is a tile; the cover is framed in coral with
  "★ Cover" on the picture and "On the card" under it; every other photo
  offers **Make cover** and Remove. The same tile when creating a service,
  where "Make cover" moves the chosen file to the front, so it is uploaded
  first and becomes the cover when the service is posted.

Three tests in `service-images.spec.ts`. **1330 passing across 58 suites.**

## 188. The banner keeps sliding, slower (2026-10-08)

The user asked for the Home banner to **always** slide, at a slower pace.
This reverses §178's "stops after one round".

- **8 seconds a spotlight** (was 5.2 s): long enough to read the headline,
  the line under it and the button before it moves. The photo's slow drift
  and the dot's filling bar follow the same 8 s.
- **Round and round.** After the last spotlight it slides **forward** on to
  the first, not backwards across all the others. To do that the first
  spotlight is drawn once more at the end of the strip; the banner slides on
  to that copy like any other, then (0.52 s later, once the slide has
  landed) jumps back to the real first without animation. Both are showing
  the same thing in the same state, so the jump cannot be seen. The dots
  count only the real spotlights; on the copy the first dot is the lit one.
  A swipe from the last on to the copy wraps the same way.
- **Kept from §178:** the set is fixed for the visit (nothing is inserted
  while it is being read), touching or dragging holds it still and letting
  go starts the 8 s again, × puts it away for the visit, a new visit brings
  it back with a fresh set.
- **Reduce motion on: it does not move by itself.** The phone's
  accessibility setting asks for no movement on its own, so the banner
  waits on the first spotlight with its bar full and is moved by swiping.
- One spotlight only: nothing to go round to, so it stays.

Checked in the web build over 62 s: six spotlights, a move every 8 s,
6th → 1st forwards at 47 s, then on to the 2nd at 55 s.

## 189. How many people: the branch's places, and nothing else (2026-10-08)

The user found that pressing + on "How many people?" made times disappear,
and asked for one rule instead of three. A branch serves so many people at
once ("People served at once", on Branches & hours). That is the only number:

> If a time can serve 5 people at once and one booking takes 3, 2 are left at
> that time. When those 2 are booked, the time reads as booked.

### 189.1 What went

- **"Can a customer book more than one?"** (`Service.quantityMode`, with its
  SINGLE / PEOPLE / UNITS answers) and **"Most in one booking"**
  (`Service.maxQuantity`), with the CHECK constraint holding them together.
  Migration `places_only` drops both columns and the enum. The service form
  says instead: the price is for one person, and how many can come at once is
  set per branch, with a link to it.
- **Rounds.** A group bigger than the branch was served one after another and
  the booking grew longer (§136.2), which is what made times vanish: five
  people at a one-chair shop was a five-hour booking. Now a booking is always
  the service's own length.
- **"Several of the same for one customer"** (UNITS, "3 passport photos"). It
  took one place however many, which does not fit a rule made of places.
  Sold that way, it is now one person's booking; a shop can still price a
  pack as its own service.

### 189.2 The rule

- A booking for N people takes **N places, all at the same time**, for the
  service's own length. `capacityUnits` is N.
- The most one booking can be for is the branch's places. More is refused
  with the number in it: "This branch serves at most 4 people at once" /
  "This branch serves one person at a time." Every service at the branch
  shares the same places, as before (§16.4).
- **Places left at a time** = the branch's places minus the places in use at
  the **busiest moment** of that time — not minus every booking that touches
  it. Someone 10:00–11:00 and someone 11:00–12:00 never share a place, so an
  hour from 10:30 still has a place free at a two-place branch. The old rule
  added both and called it full.
- A branch serving one asks no "how many" at all.

### 189.3 What the customer sees

- Availability now answers with **every open time and its places left**
  (`times: [{ time, placesLeft }]`) besides the bookable `slots`. Times in
  the past or blocked off by the shop are not listed: they are not booked,
  they are not on offer.
- A time with **no places** is shown, flat grey, struck through, **"Booked"**.
  A time with **some places taken and five or fewer left** says **"2 left"**
  in amber. A time with fewer places than the group is grey and cannot be
  tapped, still saying how many it has. Morning / Afternoon count only the
  times the group can take.
- "How many people?" shows wherever the branch serves more than one, "Up to
  3, all at once", with the − / + capped at the branch's places. On a narrow
  phone the question sits above the − / +.
- A day where nothing has room says why: "Every time is booked on this day",
  or "No time has room for 4 people on this day. Try fewer people, or another
  day."
- Changing the number keeps the day's times on screen while the new answer
  comes, rather than flashing back to grey boxes.

### 189.4 Data

- Bookings already made keep their quantity, length and places.
- `seed-demo` gives the demo branches real place counts (barbers 4 and 2, spa
  3, nails 3, braiding 4, tailor 2, gym 5); the garage stays at 1, since its
  customers bring cars. In the dev database, only demo branches still at 1
  were changed to match; branches the user had set themselves (20, 45, 60,
  300…) were left alone.

Checked live: two test bookings at the demo spa (3 places) — 2 people at
10:00, 3 at 11:00 — showed "1 left" at 10:00 and "Booked" from 10:45 to
11:15 for one person; with two people the "1 left" times greyed out. Both
were cancelled afterwards. `booking-quantity.spec.ts` rewritten for the rule
(9 tests, including the busiest-moment case). **1326 passing across 58
suites.**

## 190. The business app, redesigned — the design system and the frame (2026-10-08)

The user asked for the business web app to get the customer app's treatment
(§133): "a 3 million dollar UI/UX that sellers love to visit, since this is
where orders, redemption etc. take place", built **piece by piece in the order
a seller uses it**, starting with the navigation. Reference shots were finance
and seller dashboards (Finexy, Steadi/Raxon, TRIVI, Mokopi, ShopSphere): warm
off-white canvas, big rounded white cards, an orange accent, black pills for
"you are here", round icon buttons, stat cards with trend chips. Patterns
learned, nothing copied; every page, link and wording kept.

The order of the pieces: **(1) design system + navigation**, (2) checking a
customer in, (3) a "Today" overview, (4) Appointments, then Services,
Branches & hours, Closures, Shopfront, Messages, Reviews, Getting paid, How it
is going, People, Legal, Help and signing in — each its own section below as
it lands.

### 190.1 One brand across both apps

`styles.css` is now a design system rather than "a deliberately plain internal
tool" (§70): the customer app's tokens (§133) — warm canvas `#F4F2ED`, white
panels, coral `#F0532D` ~~with a three-stop coral gradient for the one main
action on a screen, night `#15171C` for "selected" and the darkest buttons~~
(superseded by §218: flat `#D4401C` buttons, charcoal `#2C3039`),
ok/warn/danger/ask with their soft tints — and Plus Jakarta Sans, loaded from
Google Fonts. Radii 8–26, four shadow levels, one easing curve, and
`prefers-reduced-motion` honoured everywhere.

**Every class name the pages used was kept** (checked by listing them all
before rewriting), so the twelve pages took the new look at once — buttons,
inputs and selects (with a drawn chevron), the night-pill segmented tabs,
tables as rounded cards with a tinted header, status pills with a dot,
drawers that slide in with a blurred backdrop — before any page is rebuilt.

`src/ui/Icon.tsx` is the app's own line-icon set (~70 icons, Lucide-style
paths, `currentColor`): no icon package, for the same reason §70 gave for no
component library. `src/ui/Avatar.tsx` gives each customer — who reaches a
business only as an email — initials on a colour derived from the address, so
the same customer is the same colour everywhere.

### 190.2 The frame

- **Sidebar** (`src/shell/Sidebar.tsx`): a floating white panel. The shop's
  logo (or its initials on the coral gradient), name, role and a live dot at
  the top; §131's groups with an icon per link; the page you are on is ~~a night
  pill with a coral icon~~ (superseded by §218: a light highlight with an
  orange bar and icon). Badges: **customers still expected today** on
  Appointments, **unread messages** on Messages. At the foot, the shop's
  state — ~~"Your shop is live" (night card, pulsing green),~~ (removed by §218;
  shown only when not live) "paused", or
  §70.3's not-approved sentence word for word on amber — and who is signed
  in, with sign-out. It **folds to a rail of icons** (remembered per browser);
  a tablet (860–1199px) always gets the rail, with each label shown on hover
  in a fixed-position bubble so the rail can scroll on a short screen. On a
  short laptop the shop card shrinks to its heading, then goes, so no link is
  ever cut; the menu fades at its foot when it scrolls.
- **One list of pages** (`src/nav.ts`) feeds the sidebar, the phone menu, the
  top bar's title and the search. §131.3's promise holds: the same twelve
  addresses.
- **Top bar**: where you are (group › page, and today's date), a search pill,
  **Check in** (coral, with today's expected count), Messages with an unread
  dot, the notification bell, and the account menu (shopfront, people, legal,
  help, sign out). Frosted, sticky, and it gains an edge once the page
  scrolls under it.
- **Search, ⌘K / Ctrl K or "/"** (`CommandPalette.tsx`): finds any page by any
  word for it ("prices" → Services, "momo" → Getting paid, "holiday" →
  Closures) plus three actions (check in, add a service, take time off) and
  sign out last. Arrow keys, Enter, Esc. It only reaches what the app already
  does.
- **Notifications** drop down from the bell, each kind with its own icon and
  colour (a new booking blue, a cancellation red, a review gold, money green).
  Same behaviour as §96: opening one marks it read.
- **Phone (under 860px)**: the sidebar becomes a drawer; a floating night
  **tab bar** in thumb's reach (Bookings, Services, Messages, Menu) with
  **Check in as the raised coral button** in the middle — the customer app's
  bar (§133) in the seller's hands. The page's big title is the title; the
  top bar repeats it only once it has scrolled away. Tabs slide sideways
  instead of wrapping.

The legal banner (§126.3) is restyled as a card with an icon and a night
"Read and agree" button; its words are unchanged.

For now **Check in** opens Appointments, where each expected customer has
their code box; the next piece gives it its own flow.

Checked at 1440×900, 1024×768 and 390×844 against the live backend, with the
search, the account menu, the bell and the phone drawer each opened. Type-checks
and builds.

## 191. Checking a customer in, its own flow (2026-10-08)

The most frequent thing a seller does (§70.2) was a code box in a table row.
It is now a window of its own (`src/checkin/CheckIn.tsx`), opened from the
top bar's **Check in**, the phone's raised button, and the ⌘K search — from
any page, without leaving it.

1. **Who has arrived?** Every booking still expected (`BOOKED`), in three
   groups: **Today** (in time order, each with "Due now" pulsing coral, "in
   25 min" blue, or "10 min late" amber), **Coming up**, and **Earlier, not
   checked in**. A search box filters by email, service or branch. **With
   exactly one customer expected today, they are already chosen** and the
   window opens on the code; "Change" goes back to the list.
2. **Their code**: six boxes, the same shape as the code in the customer's
   email and app (§183). Typing moves on, Backspace steps back, a pasted or
   auto-filled code spreads across all six, and **the sixth digit checks them
   in** — no button needed, though there is one. A wrong code shakes the
   boxes red and shows the server's own message ("Incorrect verification
   code. 4 attempt(s) remaining."). **No code?** stays OWNER/MANAGER only
   (§54.3) and is now a written form in the window, with §70's words, the
   10-character minimum, and "recorded against your name and every
   administrator is told" — no more browser prompt.
3. **Checked in**: a drawn green tick, the service and time, the deposit paid,
   and **"Still to pay you at the shop"** (the price minus the deposit) — the
   one number the seller needs next. "Check in someone else" goes straight
   back to the list.

The booking must be chosen before the code is typed: the code is stored
hashed (§54.2), so there is no finding a booking from its code — and trying
it against each booking would spend the customers' attempts.

`src/ui/CodeBoxes.tsx` is the reusable six-box input. On a phone the window is
a sheet from the bottom. Every query it refreshes sits under `appointments`,
so the badges and lists update behind it.

Checked against the live list (one customer today, one coming up, one
earlier), with the server's replies to the check-in itself faked in the test
browser so no real booking changed: a wrong code (red, shaken, attempts
left) and a right one (tick, receipt, RWF 5,440 still to pay). The
Appointments rows keep their own code boxes until that page is rebuilt.

## 192. "Overview" — the seller's day on one page (2026-10-08)

The business app had no home: it opened on the Appointments table (§70.2). It
now opens on **Overview** (`/`, `src/pages/OverviewPage.tsx`), first in the
menu above Appointments (§131.1's ungrouped top now holds both). Unknown
addresses go to `/`; every old address still works. On the phone the tab bar
reads Today, Bookings, [Check in], Messages, Menu — Services moved into the
menu.

Laid out in the order the day is worked:

1. **Greeting** — "Good evening, *Kigali Barbers*" with the date and a live
   clock, and one plain sentence for the day ("1 customer still expected
   today, and 1 with you now"). Take time off and Add a service beside it.
2. **Four numbers**, each counting up when shown, each a link: **Still
   expected today** (the coral card, with "1 running late" / "next at 16:00"
   and its own Check in), **With you now**, **Bookings, last 7 days** (with
   a green/red trend chip against the 7 days before), **Your rating** (the
   branches' ratings weighted by their review counts, with half stars).
3. **Today's schedule** as a timeline: every booking today in time order,
   a coloured dot per state, a pulsing coral **Now** line at the current
   time, and the next action on the row itself — **Check in** (opens §191
   with that customer chosen) or **Mark done**. Late customers say "2 h 45
   min late" in amber.
4. **Next up**, a night card: today's first customer not yet checked in —
   late ones included, since a late customer can still walk in — or else
   the next booked; a countdown, when, where, what they still pay at the
   shop, and Check them in.
5. **Messages**: unread count and the three latest conversations.
6. **Bookings** chart: the last 14 days (night bars), today (coral), and the
   week ahead (hatched — booked, not yet happened), with hover counts.
7. **Busiest times**: the busiest weekday and hour in plain words, a week of
   bars and a 06:00–22:00 hour strip. Counted on the page from the last four
   weeks of real bookings (the analytics endpoint reports only the single
   peak, §96); the headline hour is read from the same working-day hours the
   strip shows.
8. **Money**: ready for the next payout, still settling, paid so far (the
   balance endpoint, §77), with a paused notice when payouts are paused. Not
   shown to someone the endpoint refuses.
9. **Latest reviews**: the three newest across branches, stars, words, and
   "Not replied yet" where the shop has not answered.

Every figure is the server's or counted from its list of bookings (four weeks
back to a week ahead, paged 100 at a time). "Real" bookings for the counts
are Booked, In progress, Done and No-show — not cancelled, not unpaid.

On a laptop two columns that end level (today, chart, money | next up,
messages, busiest) with reviews across the foot; on a tablet and phone one
flow, re-ordered so **Next up comes straight after the numbers**.

`src/lib/time.ts` holds the time words every screen shares; `src/ui/Stars.tsx`
draws ratings with halves. The status pill no longer capitalises every word
("2 h 45 min late", not "2 H 45 Min Late").

## 193. Appointments, rebuilt — and one dialog for the business app (2026-10-08)

### 193.1 The page

`src/pages/AppointmentsPage.tsx`, keeping every action and its wording:

- **Tabs with counts** — Expected, In progress, Awaiting payment, Done, All —
  each saying how many it holds. The tab is in the address
  (`/appointments?tab=in-progress`), so Overview's "With you now" lands on it.
- **Grouped by day.** The waiting tabs (expected, in progress, awaiting
  payment) are fetched whole and read **soonest first** — the list endpoint
  only sorts newest first (§96), which put next month above this afternoon.
  Expected customers from past days sit at the top under an amber **"Earlier —
  not checked in"**. The history tabs (Done, All) stay newest first, 25 at a
  time with **Show more** (there was no way past the first 25 before).
- ~~**Search** by email, service or branch, over what is loaded.~~ — superseded by
  §213.2 (search and branch filter on the server, over every booking).
- ~~Each row: time and length, the customer with "Deposit paid", the service
  (people count in coral), **You earn** with "of X — rest paid to you
  directly" (§29.2), the state (late ones amber, "2 h 53 min late")~~ — the
  row's columns superseded by §213.1 (Payment shows what is due at the shop),
  and the
  next step as a button: **Check in** (opens §191 with them chosen) or **Mark
  done**. The rarer steps — No code? (owner/manager), No-show, Cancel — are
  behind **⋯**. "Waiting for the customer to pay" for unpaid ones.
- **Clicking a row opens the details panel** (§96): the customer and state;
  when, service and branch; **What happened** as steps (booked, deposit paid,
  arrived, done / did not come / cancelled by whom, with the reason); the
  money with **To pay you at the shop**; the payment trail with a **Copy**
  button on the operator's reference; and the actions at its foot.

### 193.2 One dialog (`src/ui/Dialog.tsx`)

The business app's version of the customer app's §184: `confirmDialog`,
`promptDialog` (with a minimum length and a hint until it is met) and
`alertDialog`, awaited like the browser's, drawn by one `DialogHost` at the
root — tone-coloured icon, the dangerous choice in red, Esc to back out, a
sheet from the bottom on a phone. Appointments now uses it:

- **Cancel** asks for the reason with §70's words ("The customer is told this
  reason, and if they have paid a deposit it is refunded in full — including
  our fee"); "Keep it" / "Cancel the booking", disabled under 3 characters.
- **No-show** now asks first — it used to act on one click. The dialog says
  the deposit is not refunded (§25: a no-show forfeits it).
- **No code?** opens the check-in window straight on its written form (§191).

The other pages' browser pop-ups (Services, Hours, Shopfront, People) move to
the dialog as each page is rebuilt.

## 194. Services, a catalogue (2026-10-08)

`src/pages/ServicesPage.tsx`, every function and word kept, laid out the way
a seller thinks about what they sell:

- **Summary chips** under the heading: how many on sale, how many with a sale
  running, how many **without photos** (amber — the one thing most worth
  fixing), how many not on sale.
- **Unfinished** drafts (§123) as a strip of dashed cards — name, last saved,
  who started it — with **Carry on** and **Discard** (now a dialog, §193).
- **Each service is a card**: its cover as the customer's app shows it (or
  "Add a photo" on a striped tile), the sale on the picture ("−15%"), the
  photo count, the name and its title (or "No title yet"), length and deposit
  with "from RWF 1,000 up front", the sale line, then **each branch's price
  with an on/off switch** — the switch is §74's "Stop offering here" / "Put
  back on sale here", acting the moment it is flipped (those words are its
  label). A sale shows the new price with the old one struck through.
  Underneath, **Title · Description · Instructions** ticked or not, "2/3" — a
  glance shows which services still have nothing to say for themselves.
  Edit, Photos, and "⋯" for Stop offering everywhere.
- **Not on sale** below, the same cards greyed, each with Put back on sale
  (§76's two ways back unchanged).
- **Adding and editing happen in a panel from the right**, in four sections —
  Name and words, Price and time (each branch's price with the deposit it
  means worked out beside it), Sale (each branch's "customers pay X instead
  of Y" as it is typed), Photos (chosen ones for a new service; ~~the live
  manager for an existing one, "saved straight away"~~ — since §281 an
  existing one's wait for "Save changes" too) — with the action
  buttons fixed at the foot. Clicking a card's cover opens it on Photos.
- Photos are larger tiles with "★ Cover" on the picture; Make cover and
  Remove appear on hover (and always, on a touch screen — §281).
- Every browser pop-up on the page is now the dialog: pausing the last branch
  (the server's own message), stopping everywhere, discarding a draft,
  removing a photo, and the two form checks (a price somewhere; a sale of
  1–90%).

`src/ui/Switch.tsx` and `src/ui/MoreMenu.tsx` ("⋯", now shared with
Appointments) are new shared pieces. The old table/form styles were removed
from `styles.css` once nothing used them.

Testing note: opening "Add a service" starts a draft on the server (§123), so
the one the screenshot run made was deleted afterwards; the two older drafts
were left as they were.

## 195. Branches & hours, redesigned (2026-10-08)

`src/pages/HoursPage.tsx`, every rule and word kept:

- **Each branch is a card headed by a map of where it is** — a still picture
  drawn from OpenStreetMap's tiles (`src/components/StaticMap.tsx`, coral pin,
  "© OpenStreetMap contributors" kept on it as their terms ask) — with the
  name, the district, and **today's state** over it ("Today 08:00 – 19:00",
  green; "Closed today"; "Closed"). Edit details and Close / Reopen sit on
  the map. Below: address, cheapest service, rating with half stars, phone.
  The interactive map (MapPin, §157) stays where the pin is placed — in the
  add and edit forms — because that is where it must be checked.
- **The week**: Monday first (stored days unchanged, 0 = Sunday), a switch per
  day for open, the two times, and **a bar showing the open hours across the
  24-hour day**, so a short day or a typo ("19:00 to 09:00") is seen at a
  glance; today is marked. **"Mon's hours to every open day"** copies the
  first open day's times to the others — a change still to be saved, like
  any other. The foot says "You have changes that are not saved" until
  **Save the week** (still the whole week at once, §12.7).
- **People served at once** (§16.4, §189): a − / + stepper with the number
  large, a row of seats showing it (twelve, then "+33"), §189's explanation
  word for word, and Save.
- **Adding and editing a branch open in the side panel** (`src/ui/Panel.tsx`,
  now the shared panel): name and phone side by side, address, **Where it is**
  with "Use my current position" inside the field and the map underneath once
  a pin is found, district grouped by province, and §117's note that a new
  branch starts closed every day. The checks are unchanged — a new branch
  needs a name, an address, a district and a pin (§135.8).
- **Close this branch** is now the dialog (§193), with §89's words: nothing
  is deleted, and it can be reopened.

`NewBranchForm.tsx` now holds the shared `PlaceField` and `DistrictField` the
add and edit panels both use, and `NewBranchPanel`. On a phone the map is a
strip above the branch, and each day stacks its switch and times.

## 196. Closures & breaks, with a month calendar (2026-10-08)

`src/pages/ClosuresPage.tsx`. The two mechanisms stay apart (§102): **Whole
days** (closed, or open at different hours) and **Part of a day** (a break).
What is new is being able to SEE them:

- **A month calendar** for the chosen branch: a closed day is red, a day with
  different hours amber, each break a blue dot (up to three), and the days the
  branch is **usually closed** (its weekly hours, or no hours saved) hatched.
  Today is a coral circle. Hovering a marked day says what it is.
  ~~**Clicking a day fills in the date in both forms**, so "close the 20th" is
  a click on the 20th and Add this day.~~ — superseded by §207 (the day
  picked is the day the panel beside it changes; the forms have no date
  field). Previous / Today / Next months.
- Branches are pills at the top, not a dropdown.
- Each form sits on a tinted panel. "What happens" is two pill choices
  (Closed all day / Open, but different hours) — still one or the other, so
  the server's two refusals stay unreachable. The foot reads the choice back
  ("Thu, 8 Oct 2026 · 13:00 to 14:00") beside the button.
- ~~**What is already taken out** is listed under each form, coming up first,
  each with a coloured date block (clicking it shows that month on the
  calendar) and Remove;~~ — superseded by §207 (one "Coming up" list for
  both, each opening its day) — **past ones fold away** under "Past (n)".
- "Today" is now the seller's local date, not UTC's — the old default date
  could read as yesterday or tomorrow near midnight.

Checked with a test closure, a test short day and a test break on the demo
branch, all three removed afterwards.

## 197. Your shopfront, with a live preview (2026-10-08)

`src/pages/ProfilePage.tsx`, every action and word kept:

- **Open / paused stays first** (§119.3), now a strip with a switch: "Your
  shop is open" (green) or, paused, amber across the whole strip. Pausing
  asks first in the dialog (§193) with §119's words; reopening does not ask.
- **The shop window**: the cover full width with "Change cover" on it, the
  logo large and reaching up over the cover with a camera button to change
  it, then the name, category · type, and badges — Live / Paused, the rating
  with half stars and review count, how many branches.
- **"Make your shop window stand out"**: a progress ring and six checks — cover
  photo, logo, what you do (40+ characters), category and type, phone, photos
  at every open branch (from each branch's photo count). It counts only what
  a customer sees; nothing is required by it.
- **Details beside "How customers see you"**: the form on the left, and on
  the right ~~a phone showing the shop as the customer's app does — cover,
  logo, name, category, first branch with its rating, the tabs, the
  description~~ (superseded by §208: the app's real shop page, at its real
  size) — **changing as it is typed**. Save is enabled only when
  something changed, and the foot says the preview shows unsaved changes.
- **Photos per branch**: a fill bar of "n of 30", larger tiles that zoom on
  hover with a remove button (now the dialog), and an "Add a photo" tile in
  the grid. Adding or removing refreshes the checklist.

## 198. Messages, an inbox in two panes (2026-10-08)

`src/pages/MessagesPage.tsx`. The rules are unchanged — unread is per person
(§21.3), empty booking threads are hidden (§21.1), no "new message" button,
the socket for the open conversation (§22.2), replies say who sent them
(§14, §112.1). What changed is the shape:

- **Two panes**: conversations down the left — newest first, each with the
  customer's initials, what it is about (a booking, or "A question, before
  booking"), the last line, how long ago, and the unread count — and the open
  conversation on the right. A **search** box and **All / Unread** tabs sit
  above the list. With none open, the right side says how many are waiting.
- **The conversation**: a header with the customer, the subject and the
  booking's state; messages **grouped by day** with a date between days, and
  a run from one person drawn as one block with who-and-when once, under its
  last message. Ours are night bubbles on the right, the customer's light ones
  on the left, on a faint dotted page.
- **Replying**: one rounded box with a paperclip for a photo (shown as a
  thumbnail, removable, before sending) and a coral send button. **Enter sends,
  Shift + Enter is a new line.** The box grows with the text.
- **On a phone** the list is the page; a conversation opens over everything,
  full screen, with a back arrow — the reply box at the bottom, clear of the
  tab bar. It is drawn at the top of the page so nothing around it can clip
  it.

Testing note: opening a conversation marks it read for whoever opens it, as it
always has — so the screenshots run as the demo owner read one demo
conversation (2 messages).

## 199. Reviews, with a summary and filters (2026-10-08)

`src/pages/ReviewsPage.tsx`; who may reply, the one reply per review, the
seven-day edit window and its explanation (§92) are unchanged.

- **Summary**: the branch's rating large with half stars and its count; a
  **bar for each of 5 to 1 stars** (counted from the reviews loaded — "Counted
  from the latest 50" when there are more), each bar a filter; and a night
  card **"3 waiting for a reply"** with a ring of how many are answered and
  **Show them**.
- **Filters**: All, Waiting for a reply, or one star rating.
- **Each review is a card** with a coloured edge (gold 4–5, amber 3, red
  1–2), the reviewer's initials, the stars and the number, and the words.
  **Your reply sits under it as an answer from the shop** (its logo, "Your
  reply", how long ago, Edit reply while it can be). With no reply yet, the
  reply box is the card's foot, marked "Waiting for your reply", with §92's
  two placeholders (a calm one for low ratings, "Thank them, briefly" for
  good ones) and a reminder that everyone who reads the review sees it.
- Branches are pills with each branch's rating (`src/ui/BranchPills.tsx`,
  now shared with Closures & breaks).

## 200. Getting paid, as a wallet (2026-10-08)

`src/pages/PayoutsPage.tsx`, every figure, note and rule kept (§48, §77):

- **The wallet**: a dark card with **Ready to send** large, "Goes out on the
  next payout run", and at its foot paid so far, how many payouts, and the
  last three digits of the number it goes to.
- **Where your money goes** beside it: the mobile money number large, its
  state as a coloured panel (green confirmed, amber waiting on an
  administrator, red refused), §48's warning that changing it pauses payouts,
  and Change the number — owner only, as before.
- **Your money** as four steps in the order money moves — **Not yours yet →
  Still held → Ready to send → Paid to you so far** — each with §77's note,
  the ready step in green; then §29.2's line that these are deposits only.
- **Payments to you** as a list: amount, run date, state (paid, pending,
  processing, failed with its reason), when paid, the reference once there
  is one.
- The paused notice (§48.3) sits above everything when payouts are paused.

## 201. How it is going, as charts (2026-10-08)

`src/pages/AnalyticsPage.tsx`; every figure is still the server's (§96), and
partial totals still say so.

- **Period** as three pills (7 / 30 / 90 days) and **branches** as pills with
  "All branches" first.
- **Bookings**: the total large, with a green/red chip comparing it to the
  same length of time just before (a second call to the same endpoint), and
  **a bar for each day** — customers who came or were expected, counted from
  the bookings list, today in night. A caption says what the bars count,
  since the total above includes cancelled ones.
- **How bookings ended**: a ring split into turned up, did not turn up,
  cancelled, and still to come or unpaid, with the turned-up rate in the
  middle and each rate and count listed. A rate the server leaves empty
  (nothing to divide by) shows "—".
- **Money**: deposits taken with a bar splitting your share from platform
  fees, and "Owed by customers — paid to you directly, not through us" in a
  night card.
- Rating (half stars), busiest day and busiest hour as three tiles.

`src/lib/bookings.ts` now holds the paged bookings fetch that Overview and
this page share.

## 202. People, Legal and Help, redesigned (2026-10-08)

The last three pages, rules and words unchanged.

- **People** (`StaffPage.tsx`): the team as rows with initials, "you", and a
  role badge (Owner night with a key, Manager blue, Staff grey); an owner
  switches a member between Staff and Manager with a two-way pill and removes
  them with an icon button (now the dialog, §193, with §14's words). Beside
  the list: **Add someone** (email, Staff / Manager as pills with what the
  chosen role means) — owner only, as before — and **What each role can do**,
  all three roles with their meanings. Invitations show an envelope and
  Cancel invitation; people no longer here stay listed, faded, as the record.
- **Legal** (`LegalPage.tsx`): a card per document with an icon, a line on
  what it covers, its state (Agreed / Changed / Not agreed yet), version and
  date, what changed, **Read it** (the whole text in the side panel, with
  I agree at its foot) and **I agree to this**. A green "You are up to date"
  when nothing is outstanding. Agreeing now also refreshes the banner over
  every page (§126.3) — before, it stayed until the next reload.
- **Help** (`SupportPage.tsx`): a night "How can we help?" header with the five
  topics as buttons — each opens the request form with that topic already
  chosen. Requests are grouped Open / Finished, each with its topic's icon,
  reference, last activity and §80's status words. The form and the open
  request use the side panel; the conversation is drawn as bubbles (yours
  night, support's light).

**No browser pop-up is left in the business app** — every confirm, prompt and
alert is the designed dialog (§193).

## 203. Signing in to the business app, redesigned (2026-10-08)

`src/auth/LoginPage.tsx`. The rules are §50's and §90.3's, unchanged: no role
is sent to sign in; a missing account becomes the offer to create a business
account (the only place a role is sent); a non-business account is told so.

- **Two halves.** On the left, a night panel showing what the app is for:
  four floating cards of the kind a seller sees inside (next customer, money
  ready to send, a new review, a check-in) — illustrations, not anyone's
  data — and "Your bookings, your customers and your money — in one place"
  with three plain points. On the right, the form, one step at a time, with
  two step marks.
- **Email** in a large field with an envelope; **Send code**.
- **New here?** — §90.3's words, Create a business account, Use a different
  email.
- **Check your inbox** — the same six code boxes as checking a customer in
  (§191), so **the sixth digit signs in**; a wrong code shakes the boxes and
  shows the server's words. **Send a new code** added (it asks the same way
  the first request did, with the role only when registering), and Use a
  different address.
- Server messages (wrong code, "Please wait 15s before requesting another
  code") sit in a red strip under the form.
- After signing in it opens **Overview** (§192), the new home.
- On a phone the left panel shrinks to its words above the form.

## 204. "For you" — adverts, ideas and tips down the right (2026-10-08)

The user asked for room on the right of the whole business app for adverts,
"as beautiful as the customer app's": the business's own best performers,
the platform's own adverts ("you can become a buyer — get our app"), nudges
to finish the profile (detecting what is missing), what is trending at other
businesses, and teaching the app's features.

### 204.1 Where it sits

- **Wide screens (1280px and up)**: a third column, "For you", beside every
  page (`src/ads/AdRail.tsx`); the page moves left to make room. It **folds**
  to a slim strip with a coral spark and a count of things left to add
  (remembered per browser); unfolding gives it back.
- ~~**Narrower (tablet, phone)**: no column; the banner sits at the top of
  Overview instead, under the greeting.~~ — superseded by §205.4 (the
  banner, live tiles and "How it works" at the top of Overview, with "See
  all" for the rest).
- Beside the column, the top bar's search shrinks to its icon until the
  screen is 1680px wide or the column is folded.

### 204.2 What is in it

1. **The banner** (`AdCarousel.tsx`): one advert at a time, **8 seconds each,
   round and round, forward from the last to the first** (the customer app's
   §188), paused while the mouse is over it, ~~dots with a filling bar to jump
   to any one~~, nothing moving with "reduce motion" on. Each advert has its
   own colour, a photo where there is one (drifting slowly closer) ~~or a large
   faint icon with slow rings~~, a corner number, and one button — the look
   superseded by §210 (layered, animated cards with story bars). In priority
   order (`slides.ts`), each only when it applies:
   - **Get paid** (owner only, §48): no payout number, refused, or being
     checked.
   - **Your best seller**: the most booked service of the last 30 days, with
     its cover photo and count — "Put it on sale" if it is not.
   - **Trending in [your type] / on the app**: the most popular service at
     another business, its photo and bookings.
   - **Make your shop stand out**: how complete the shop is, and the first
     missing thing, with a button straight to where it is added.
   - **Customers are waiting**: reviews without a reply.
   - **From us · You can book too**: the customer app. A business account
     cannot book (bookings are CUSTOMER-only, one email is one kind of
     account, §50), so it says to sign up there with a personal email. There
     is no store or web link yet, so it says it is "coming to the app
     stores"; setting **`VITE_CUSTOMER_APP_URL`** turns it into a "Get the
     app" button.
   - **How customers find you**: popular shops are shown first, ranked by
     bookings weighted by rating (§135.1) — true, and the reason the rest of
     the column matters.
   - **Run a sale this week** (when nothing is on sale): what a sale shows
     customers (§186).
   - ~~**Press ⌘K to jump anywhere**.~~ — superseded by §205.5 ("Jump to
     anything", worded for the screen it is on).
2. **Your shop** (`useAdData.ts`): a score ring and what is missing, each a
   link to where it is fixed — cover, logo, a description of 40+ characters,
   category and type, phone; per open branch: gallery photos, opening hours,
   district and pin; services on sale without a photo or a description; a
   confirmed payout number; at least one service.
3. **Trending on the app — what customers are booking**: the top four from
   the public popular list (§135), in the shop's own type and "Everywhere",
   never its own, and only ones actually booked — photo, sale badge, price,
   rating, bookings, with how the list is ranked.
4. **Did you know?** — a tip about the page being looked at (`tips.ts`).

Nothing in it is paid for, and it says so at its foot. Every figure is the
server's or counted from the shop's own bookings; no claim is made that the
app cannot back.

### 204.3 Pages size by their own room

With a third column, the same page is narrower on the same screen, so page
layouts now switch on **the width of the page area** (a CSS container,
`.content`) instead of the window. Each page's thresholds were re-chosen
(Overview goes to one column under 980px of room, Appointments' rows go
compact under 1000px, and so on). A container holds fixed-position layers
inside it, so every panel and drawer a page opens is now drawn at the end of
`<body>` (`src/ui/Portal.tsx`); their own phone rules stay window-based.

### 204.4 Not built

- Adverts managed by an administrator (the platform's own campaigns) — today
  they are written in `slides.ts`.
- Paid placement for businesses.

## 205. "For you" explains how it all works, and shows what just happened (2026-10-08)

The user asked for the "For you" space to be informative as well as
advertising: explain how cancellations, discounts, good photos and so on
work; show new messages, notifications and orders; go through the code and
add anything that fits; on a phone put it at the top like the customer app,
on a big screen down the right.

### 205.1 "How it works" — the rules, in plain words

`src/ads/guide.ts` holds eleven topics, each a one-line summary and three to
five points, written from what the code does (the section each comes from is
noted beside it in the file). The fee is read from the shop's own latest
booking (`platformFeePercentage`), never written in.

| Topic | What it says (source) |
|---|---|
| Deposits and fees | deposit % per service, fee out of the deposit, rest paid at the shop, deposit never below the fee (§2, §16.3, §25, §40) |
| Cancellations and refunds | customer cancels → no refund, share still paid; shop cancels → full refund incl. fee, mobile money charge is the shop's, reason required; only not-started bookings (§25, §33, §36) |
| When a customer does not come | No-show keeps the deposit; automatic no-show / done 24 h after the end (§16.2, §20, §25) |
| Bookings waiting for payment | held 5 minutes, then released; only paid ones are "Expected" (§17.4) |
| Checking customers in | 6-digit code, sixth digit checks in, locked after 5 wrong tries, owner/manager override is recorded and every admin told (§16.2, §54.3, §191) |
| Sales and discounts | 1–90%, every branch, last day inclusive or open, deposit on sale price, existing bookings keep their price, Friday email (§186, §140) |
| Photos that get booked | 11 per service, 30 per branch, JPEG/PNG/WebP up to 15 MB, cover choice, what a good photo is (§132, §165, §187) |
| Getting paid | when a share is earned, the waiting period, daily run, confirmed number, a changed number pauses payouts (§46, §48, §77) |
| Reviews and ranking | only done bookings, one reply editable 7 days, popularity = bookings weighted by rating (§92, §135.1) |
| Places, pausing and closing | people served at once, pausing hides every branch, a branch with bookings to come cannot close (§16.4, §189, §89, §119) |
| Messages | customers write first, the team sees who replied, a shop cannot start a conversation (§21, §112) |

On a wide screen each topic is a fold-open row in the column
(`<details id="guide-<key>">`); on a phone each is a chip that opens it in a
side panel.

### 205.2 "Right now" — orders, messages and alerts

~~A dark card near the top of the column: three counters (expected today,
unread messages, unread notifications), up to two unread conversations, and
the latest notifications (five, "Show more" for ten). Pressing a
notification marks it read and opens the page it is about.~~ — superseded by
§206.1 (removed; one "Just in" advert instead). Each kind of notification's
icon, colour and page now live in one place, `src/lib/notificationLook.ts`,
shared with the bell in the top bar so the two always match.

### 205.3 News and lessons in the banner

The banner (§204.2) gains, in priority order after "Get paid":

- ~~**Just in** — a booking or a paid deposit from the last 24 hours. The
  title is the notification's subject; the text says what it means and what
  happens next (not the e-mail body, which is far too long).~~
- ~~**New message** — the newest unread conversation, its first words, and why
  a quick reply matters.~~ — both superseded by §206.1 (one "Just in", of any
  kind).
- **How it works · Cancellations** and **How it works · Photos** — the two
  rules sellers most often learn the hard way; "Read more" opens the topic.

At most eleven adverts. A slide is now *at least* its old height and grows
with a long title (every slide stretches to the tallest, so the banner does
not jump); a title is cut at three lines.

### 205.4 On a phone or tablet: at the top of Overview

Below 1280px there is no column, so Overview starts with "For you"
(`src/ads/ForYouTop.tsx`), the way the customer app starts Home with its
spotlights (§176):

1. the banner, smaller;
2. ~~tiles to swipe — expected today, unread messages, alerts, and how
   complete the shop is;~~ — superseded by §206.1 (removed);
3. "How it works" chips;
4. "See all", opening everything the wide column holds in a side panel.

A banner button that points at a part of the column ("Read more", "See what
is trending") opens that topic, or "See all" scrolled to that part, since
there is no column to scroll to.

### 205.5 Smaller

- The search tip says "Tap the magnifying glass at the top" on a touch
  screen and "Press ⌘ K" / "Ctrl K" on a computer.
- The tip's icon is white again (a rule meant for its text was colouring it).

### 205.6 Not built

- ~~"For you" on phones appears on Overview only, not on every page.~~ —
  superseded by §221 (a slim banner on every other page).
- The guide is written in the app; an administrator cannot edit it.

## 206. "For you" shows the one thing that just came in; more than one shop (2026-10-08)

The user, on §205: they did not want a new section listing notifications,
messages and orders — the notifications already hold all of those. What they
meant was that "For you" shows **the one** message, notification or order
that **just** arrived, so the seller sees it. They kept "The rules, in plain
words" and "What customers are booking", and asked for adverts and a guide
topic saying a seller can add branches, even in other places.

### 206.1 One "Just in" advert, not a feed

- **Removed**: the "Right now" card (§205.2), and on phones the row of
  count tiles (§205.4).
- **The banner's first advert is "Just in"**: the single newest thing of the
  last 24 hours — a notification of **any** kind (booking, paid deposit,
  cancellation, no-show, review, shop approved, payout number confirmed…) or
  a customer's message still unread, whichever is newer. A message is shown
  as the message (who wrote and their first words, "Reply") rather than as
  its notification. The title is the notice's subject; the text says what it
  means and what happens next (`MEANING` in `slides.ts`); the colour, icon and
  button come from `notificationLook.ts`, so it matches the bell.
- Older things, and everything after the newest, stay where they were: the
  bell and Messages.
- The folded column's badge counts things left to add to the shop again
  (§204.1), not unread messages and alerts.

### 206.2 More than one shop

- **Advert** (owners and managers — the only roles that can add a branch):
  "Have another shop? Add it as a branch" — another street, district or
  town, each with its own page, hours, photos and prices, found on its own
  by customers near it. With no branch yet it says to add the first. Its
  button opens Branches & hours with the new-branch form already open
  (`/hours?add=1`; the address is tidied afterwards so a reload does not
  reopen it).
- **"How it works" topic — More than one shop**, written from the code: an
  owner or a manager adds one (`POST /business/locations`); each branch has
  its own address and pin, district, hours, photos, closures and breaks,
  people served at once (Location model); customers find each branch on its
  own, nearest first, and each has its own reviews and rating (§43, §104);
  services are shared, each offered at chosen branches at that branch's
  price (§72); a new branch starts closed and offers nothing until its hours
  and services are set; one team, one payout number and one money page cover
  every branch (memberships and payout numbers belong to the business).

## 207. Closures & breaks: pick a day, then change that day (2026-10-08)

The user: the month calendar sat above the two forms and "looks like it has
its own function", not like the way to choose the date the forms below act
on.

- **One planner card.** The month on the left (**1 · Pick a day**) and, beside
  it in the same card, **the day picked (2 · Change that day)** with a chip
  pointing back at the calendar ("← The day you picked"; "↑" when stacked).
  Under ~700px of room the day sits directly under the month, still in the
  same card, and picking a day brings it into view.
- **The day panel** shows a coral date tile matching the coral ring on the
  picked day, what the branch usually does that weekday ("Usually open
  08:00 – 19:00" / "Usually closed on Saturdays"), what is already changed on
  it (a closure or the day's breaks, each with Remove, or "Nothing changed"),
  then the two ways to change it as tabs — **The whole day** (closed, or
  different hours) and **Part of the day** (a break). **Neither form has a
  date field any more**: the date is the calendar's.
- A day that already has a closure says "This replaces what is set for this
  day now" and the button reads **Change this day** — the server keeps one
  exception per date and saving again replaces it (upsert, §102). A past day
  cannot be changed from here.
- **Coming up at <branch>**: closures and breaks in one list under the
  planner, by date; clicking one opens its day above (the calendar turns to
  its month), Remove beside it, past ones folded.

Checked by closing a test day (20 Oct, "Staff training"), opening it from the
list and removing it. A closure on 20 Oct with no reason, added from the
user's own browser while this was being built, was left as it is.

## 208. "How customers see you" is the customer app's real shop page (2026-10-08)

The user asked for the preview on Your shopfront to look exactly like the
customer app.

- `src/shopfront/CustomerPhone.tsx` draws `app/shop/[id].tsx` at its **real
  size, a 390 × 844 phone**, with the app's own numbers (theme.ts, Pill,
  Segmented, Button "soft", IconButton, SaveButton, SaleBadge, Stars, Avatar
  tints, Cover's category colours), then scales the whole phone with CSS
  `zoom` (0.8) so nothing drifts. The **icons are the app's Ionicons**, their
  outlines taken from the font the app ships (`src/shopfront/ionicons.ts`, 23
  glyphs, MIT licence). A change to the app's shop page should be made here
  too.
- It reads the branch from the **same public address the app reads**
  (`GET /discover/locations/:id` and its reviews, anonymously): open now,
  the subcategory pill, address and district, rating, photos strip, services
  at that branch's prices with sale badge, struck-out price and "pay … now",
  open hours with "Coming up", and reviews with replies. The name,
  description, type and category picture being edited are laid over it, so
  unsaved words show where customers will read them; an empty description
  shows a dashed hint (the app shows nothing).
- It behaves like the app: the inside scrolls, the cover moves at half speed,
  the name bar fades in, the three tabs switch with the sliding thumb. With
  more than one branch, pills above the phone pick which one.
- When customers cannot see the shop (paused, not approved — the public
  address 404s), it is drawn from the shop's own records instead — services
  offered at that branch, cheapest first, sale price worked out as the server
  does (rounded half up), approved photos — and says so under the phone.
- Its classes are `csp-*`: the command palette already owns `cp-*`, and the
  first version picked up its white panel.

### 208.1 Fixed while comparing: "Invalid Date" in the customer app

The shop page's "Coming up" closures read **Invalid Date** in the real app.
The public shop answer sent each closure's date as UTC midnight
(`2026-10-20T00:00:00.000Z`) while the app — and the business API —
treat it as a calendar day. `DiscoveryService.findOne` now sends
`YYYY-MM-DD` (`formatCalendarDate`), as the business API always has; a test
pins it.

## 209. Page headers stay pinned, frosted, under the top bar (2026-10-08)

The user: make every page's header fixed and translucent, so the page is seen
moving beneath it — "for all headers".

- **Every page** wraps its header in `.page-top` (styles.css): Overview,
  Appointments, Services, Branches & hours, Closures & breaks, Your
  shopfront, Messages, Reviews, Getting paid, How it is going, People, Legal,
  Help. It is `position: sticky` right under the top bar (whose height the
  frame measures into `--tb-h`), runs edge to edge of the page area, and is
  the **same frosted glass as the bar** (warm canvas at 80%, blur 18px —
  both nudged up from 72%/16px so dark cards sliding under stay readable).
  Bar and header read as one sheet: the edge shadow moves from the bar to the
  header.
- **What is pinned with the title** is the row that controls the page: the
  booking tabs on Appointments, the branch pills on Reviews, Closures and How
  it is going (kept to one sliding row there, never wrapping taller), the
  period pills, the search, and the page's main button.
- ~~**Folding.** Once the page has moved (24px), the header folds: the title
  drops to 22px, the line under it is put away, title and buttons share one
  line, branch pills slim to 36px. Back near the top (8px) it unfolds. It only
  folds on a page with enough to scroll (more than 180px), so the fold
  shortening the page can never unfold it again — no flicker.~~ — superseded
  by §214 (a header never changes size; a tall one partly scrolls away).
- **On a phone** (under 860px) the bar already shows the page's name once the
  page moves (§190), and height is scarce, so ~~the folded header keeps only its
  tabs or branch pills; title, search and buttons return at the top~~ only the
  tabs or branch pills stay pinned — the rest scrolls away (§214).
- **Help** keeps its dark "How can we help?" card (§202) as the page's first
  block — now an h2 under a slim pinned "Help" header like every other page;
  pinning the whole card would cover half the screen.
- Content padding became `--pad-l` / `--pad-r` on `.content` so the pinned
  glass can reach the page area's edges at every width.

## 210. The "For you" cards, rebuilt to be the best thing on the screen (2026-10-08)

The user: the advert cards still lacked proper animation and design — they
asked for waves, glitter, better colours and transitions, "a million dollar
card", better than the customer app's. Built in code (CSS, SVG and a canvas)
rather than with generated pictures: it moves, stays sharp at any size, and
adds only about 5 KB to download once compressed.

Each card (`AdCarousel.tsx`, `Sparkles.tsx`, `ads.css`) is layers, back to
front:

1. **Colour with depth** — each look is three stops (light, main, deep) and
   three lights, richer than before (coral into magenta, night as an indigo
   aurora with violet, coral and cyan, emerald with lime, gold into burnt
   orange, cobalt with cyan and lilac, violet with pink and aqua, amber with
   rose). The three lights are blurred glows drifting slowly through the card
   (13–21 s), over a fine film grain.
2. **The picture** — a photo eases closer (Ken Burns) washed in the card's
   colour; without one, a **frosted glass tile** with the icon floats (bobbing
   and turning slightly) in front of a **morphing glow**, on a dashed **orbit**
   with a glowing dot going round, and the icon drawn huge and faint behind.
   A card's big number (bookings, % complete) takes the glass tile's place,
   and **counts up** as the card arrives.
3. ~~**Waves** — three layered waves along the foot, each its own height and
   pace, tinted by the card's own lights (they glow rather than fog).~~
4. ~~**Glitter** — a canvas of twinkling four-pointed stars and specks rising
   slowly, drawn with additive light, and every couple of seconds a **glint**
   that flares and fades by the art. Quieter over the words. Only on the card
   being shown, only while it can be seen, asleep in a hidden tab.~~ — 3 and 4
   superseded by §212 (each card has its own effect; waves and glitter are
   two of them).
5. **Sheen** — a band of light sweeps across now and then; the white button
   carries its own small glint, in the card's colour.
6. **The words** — label as a glass pill; the **title rises word by word out
   of a blur**; text and button follow.

Around it: the frame's **edge has light running round it** (a rotating conic
gradient); on a computer the card **tilts towards the pointer** with a
**glare that follows it**. Cards **hand over cinematically** — the next
sharpens out of a blur from the side it comes from while the last recedes —
instead of sliding as a strip. ~~**Story bars** inside the top replace the
dots: time left on this card, the ones seen filled, any one a jump.~~ —
superseded by §212 (the dots are back under the card). On a
phone, **swipe**; with a keyboard, the arrow keys. Everything stops with
"reduce motion" on, and nothing advances by itself then (as before).

## 211. Each booking shows its service's photo (2026-10-08)

The user asked for each order on Appointments to show its cover image, so the
seller can tell bookings apart.

Each row now leads with the **service's cover photo** (54px, rounded), with
the customer's initials pinned to its corner where the avatar used to be;
the booking panel shows the same at 72px. A booking carries the service's
id but not its pictures, so the photo comes from the services list (shared
with the Services page under `['services']`, usually already loaded),
first photo = cover (§132). A service without photos shows a soft coral tile
with a tag. Nothing changed on the server.

## 212. Each "For you" card has its own effect, and the dots are back (2026-10-08)

The user: not every card should glitter — glitter was only an example — be
creative with other beautiful effects; and put the steps back below the card
as before.

`src/ads/Effects.tsx` holds thirteen effects; each slide names one in
`slides.ts` (`effect`), chosen for what it says:

| Card | Effect |
|---|---|
| Just in | **ping** — rounded rings pulse out of the glass tile |
| Get paid | **coins** — gold coins tumbling down, flashing as they turn |
| Your best seller | **confetti** — paper confetti fluttering and flipping |
| Trending | **streaks** — light shooting upward |
| Make your shop stand out | **constellation** — points of light joined into a network |
| Reviews waiting | **rising stars** — gold and white five-pointed stars |
| Grow · Branches | **waves** along the foot |
| You can book too | **bubbles** with a glint on each |
| How customers find you | **sun rays** turning behind the art |
| Run a sale | **glitter** with glints |
| How it works · Cancellations | **aurora** ribbons rippling across |
| How it works · Photos | **bokeh** — soft out-of-focus lights |
| Tip | **shooting stars** over a faint star field |

The canvas ones run only on the card being shown, while it can be seen, and
sleep in a hidden tab; the CSS ones pause off-screen. All of them are quieter
over the words. The layers of §210 stay (aurora colour, glass art, sheen,
shimmering edge, tilt, blur hand-over, swipe).

**The dots are back under the card**, as in §204: the one shown is wider and
fills with coral over its eight seconds; any dot jumps there.

## 213. Appointments as a professional work list (2026-10-08)

The user: the most important page; rows had no column headings (verify,
action, customer…), and items did not line up vertically. Asked for a
redemption-page standard of layout.

The cause of the misalignment: at the commonest desktop width (1440 with
"For you" open, ~770px of page) the old layout fell into its compact form —
headings hidden, cells wrapping onto a second line at different offsets.

### 213.1 The page

- **Pinned head**, one card with the list (§209): title, search and a
  **branch filter**; **today at a glance** — to come today (with "next at" or
  "n running late"), with you now, done today, and **to collect today** (the
  balance still to be paid at the shop by today's expected and checked-in
  customers) — which folds away as the page scrolls; then underline **tabs
  with counts**, an **Export** button, and the **column headings**, all
  staying on screen while rows slide under them.
- **One grid for headings and every row**, so nothing drifts: **Time ·
  Customer · Service · Payment · Status · Action** (≥1000px of page); at
  700–1000px the customer moves under the service in one **Booking**
  column; below that each booking is a card with the same parts in fixed
  places. Every cell is one or two single lines, cut with "…" rather than
  wrapped.
- **Each row**: a status-coloured stripe at the left edge (blue expected,
  amber late or with you, green done, red cancelled or no-show, grey
  unpaid); time and length; the customer with their **reservation number**
  (`No. 3F2A-1C9B` — the same number the customer's app shows them, the
  first eight characters of the booking's id); the service's photo, name, "×3" for a group, and branch;
  **Payment** — what is due at the shop and whether the deposit is paid, or
  what the shop keeps (no-show, customer's cancellation), "Deposit
  refunded" (shop's cancellation), "No deposit"; **Status** — the pill and
  one line of timing ("In 25 min", "5 h 31 min late", "Arrived 14:05",
  "Finished 15:10", "By the customer", "Not paid in time"); **Action** — the
  one next step always in the same place (Check in / Mark done / Waiting /
  View) and "⋯" in every row (open details, copy the number, check in
  without a code, no-show, cancel).
- A **"Now" line** runs through today's list on the waiting tabs.
- ~~**Export** downloads what is shown as a spreadsheet (CSV): number, date,
  times, customer, service, people, branch, status, deposit and when paid,
  share, fee, full price, balance at the shop, who cancelled and why.~~ —
  superseded by §216.1 (it missed bookings not yet loaded, and showed a share
  on deposits never paid).
- The booking panel shows the service photo with the customer's initials,
  the status, and the reservation number to copy.

### 213.2 On the server: branch and search

`GET /appointments` takes **`locationId`** and **`q`**. Both narrow the
caller's own scope (a branch or customer of another business finds nothing).
`q` matches part of the customer's email, the service name or the branch
name, case-insensitively — or a reservation number, with or without its dash
(the id's first eight characters). So search and the branch filter reach
every booking, not only those already loaded, and the tab counts follow
them. Tested in `appointment-filters.spec.ts`.

### 213.3 Smaller

- ~~The header fold in the frame needs 280px of scroll (was 180px) so the
  tallest folding header — this one — cannot unfold itself.~~ — superseded by
  §214 (no fold).
- "Awaiting payment" shows as an **Unpaid** pill in the list (the tab keeps
  its name).

## 214. Pinned headers no longer fight the scroll (2026-10-08)

The user: scrolling — especially near the pinned headers — "blinks", pulling
the page back up and down against the scroll.

**Cause.** The headers folded as the page scrolled (§209): smaller title,
hidden line, and on Appointments the whole today strip collapsing. A pinned
header that shrinks makes the page shorter under the reader's eye, so the
browser moves the scroll position to keep the content in place; near the
top that moved it back above the fold line, the header unfolded, the page
grew, and round again — a loop the reader feels as the page jumping against
them, worst on Appointments, whose fold was ~200px.

**Fix: a header never changes size while the page scrolls.** Instead, a tall
header is pinned from a chosen row down, and the part above simply scrolls
away under the top bar like ordinary content:

- `.page-top`'s sticky offset is `top bar height − --pt-fold`. The frame
  measures `--pt-fold` (the distance from the header's top to its
  `.pin-from` row, less 10px of glass) with a ResizeObserver — on resize and
  on page change, never on scroll.
- **Appointments**: the title and the today tiles scroll away; the card with
  **search, branch and Export**, the **tabs** and the **column headings**
  stays pinned (search, branch and Export moved from beside the title into
  that card's first row).
- **Other pages**: the header is short and stays whole, as before, with its
  edge shadow once the page has moved (`.app.is-scrolled`).
- **On a phone**: only the row marked `.pin-phone` (Appointments' tabs), or
  else the first row after the title (tabs or branch pills), stays pinned;
  the page's name is in the top bar.
- The fold rules and the `is-condensed` state are gone.

Checked by scrolling four pages (Appointments, Overview, Reviews, Branches &
hours) down and back up in 30px steps at 1440, 1024 and 390 wide: the scroll
position never moved by itself, and each header kept one height throughout.

## 215. Reviews, built for a thousand (2026-10-08)

The user: every review is simply listed — what happens at 1,000?

**Before:** the page loaded the latest 50 and filtered and counted them in
the browser, so the star split and "waiting for a reply" were only ever
right up to 50, and nothing past them could be reached.

### 215.1 On the server

`GET /locations/:id/reviews` now takes **`rating`** (1–5), **`replied`**
(true/false), **`q`** (part of the words or of the reviewer's name, any
case) and **`sort`** (`newest` — the default — `oldest`, `lowest`,
`highest`; ties broken by date then id so pages never repeat or skip). Every
answer carries **`breakdown`**: how many visible reviews of each star, how
many replied and how many waiting — over the whole branch, whatever the
filter. Each review also says **`serviceName`** (what was booked). Hidden
reviews stay excluded everywhere. Tested in `review-filters.spec.ts`.

### 215.2 The page

- **Summary**: the rating, the split by star with counts and percentages
  (each a filter), and a dark card with the reply rate ring, "n waiting for a
  reply" and **Answer them**.
- **One card**, its top pinned (§214): **search** (the words or a name) and
  **order**; tabs **All · Waiting for a reply · Replied · 5★ … 1★**, each with
  its true count.
- **The list**: 20 at a time, the next 20 loading as the end comes near, and
  "Showing 40 of 1,000". Each review in one compact row — avatar, name, what
  was booked, date, stars; long words cut at four lines with **Read all**;
  search words marked. Your reply under it with **Edit** while the 7 days
  last ("Final" after). Without a reply, a small **Reply** button opens the
  composer with **two suggested starts** fitted to the rating (thanks for
  4–5, an invitation to do better for 3, an apology and an offer to put it
  right for 1–2), to edit before posting.
- "For you" (§204) counts reviews waiting for a reply from `breakdown`, so
  the number is true for any number of reviews.

Checked with the real branch and with a pretend 1,000-review answer.

## 216. Bottoms line up; the spreadsheet is exact; codes explained (2026-10-08)

### 216.1 The spreadsheet

The user asked whether the exported file was accurate. Compared row by row
with the ledger, it was not:

1. It held **25 of 33** bookings — only those loaded on the page.
2. On **12 bookings cancelled because the deposit was never paid**, it showed
   a share and a fee (RWF 500–1,800 each) that were never earned or charged.

Now Export fetches **every booking** in the tab, branch and search, a hundred
at a time. **Your share** and **Platform fee** are what was actually earned
and charged: nothing when the deposit was never paid, nothing when the shop
cancelled and refunded it (`earned()`), and a **Deposit refunded** column
says so. Dates are `YYYY-MM-DD`, times `HH:MM`, money plain numbers in major
units with a **Currency** column, so a spreadsheet can sort and add them.
"Balance at the shop" only for bookings still to happen. Re-checked: 33 of
33 rows, every share, fee, deposit and price equal to the ledger, shares
totalling RWF 22,580 both ways.

### 216.2 One bottom line

The page area ended 64px above the window while the sidebar and "For you"
end 14px above it, so at the end of every page the middle sat higher. Now:

- `.content` ends 14px above the window (phones keep their room for the tab
  bar), and fills the height on a short page.
- Where a page is short, its last card grows to the same line: the list on
  Appointments, Reviews, Closures' "Coming up", both columns on People, the
  documents on Legal (their "Read it" at the foot), the inbox on Messages,
  and on Help a new **Your questions** card that holds the tickets.
- **Shopfront**: the details form stretches to the phone preview's height,
  the room going to "What you do"; the two end on one line.
- **Branches & hours**: the week and "People served at once" are one height,
  and their Save buttons sit on one line.

Checked at the end of every page at 1440 and 1728 wide: content, sidebar and
"For you" all end on the same line.

### 216.3 The two codes

- `B785-525E` is the **booking number** — the first eight characters of the
  booking's id, the same number the customer's app shows them (now labelled
  "Booking no." in the panel, with a hint in the list).
- `demo-ref-b785525e` is the **mobile money reference** — the payment's own
  number at the operator. Real payments carry MTN's; the demo data's are made
  up by the seed script from the booking id, which is why the two look alike.
  The panel now says what it is and when to quote it.

## 217. Headers measured on every page; the shop's logo top right (2026-10-08)

### 217.1 The fix behind "too little room for reviews"

The user: on Reviews, the pinned area left only a sliver for the reviews,
and the summary should not be pinned.

The cause was a bug in §214: the frame measured how much of a header scrolls
away (`--pt-fold`) only for the page it first loaded. The page area is
replaced on every page change, so a page opened from the menu kept a fold of
zero and pinned its **whole** header — on Reviews the summary, the search
and the tabs together, 653px of a 900px window. (Checks that loaded each
page fresh did not see it.)

The frame now finds the page area and its header afresh: a MutationObserver
on the frame notices a new page or a header that appears once data arrives,
a ResizeObserver a header that changes height, and both are batched to one
measurement a frame and only write when the value changes. Opened from the
menu, Reviews now pins only its search and tabs (bottom at 191px), with the
summary scrolling away; scrolling down and up still never moves by itself.

### 217.2 Your shop, top right

The user asked for the business's logo at the top, designed so it is plain
this is their own business, and the same logo instead of the initials at the
foot of the sidebar.

- **`ui/ShopLogo`**: the logo filling a white tile (as at the top of the
  sidebar), the shop's initials on the brand colour when it has none, and a
  green dot when customers can book (grey when not).
- **Top bar**: the account button is now the shop — its logo, and where
  there is room (from 1600px, or 1920px beside "For you") its name and "Your
  shop · live". It opens a menu headed by a card with the logo, the name and
  "Live · taking bookings" (to Your shopfront), then who is signed in and
  their role, then the account's pages and Sign out.
- **Sidebar foot**: the logo replaces the person's initials beside their
  email and role.
- Phones show the logo alone in the top bar.

## 218. Calmer colour: charcoal, one flat orange, no "live" card (2026-10-08)

The user: the "Your shop is live" card is a gradient they do not like (and
the logo's dot already says it); full black buttons and the orange should be
softer — what is professional?

- **"Your shop is live" is gone.** A live shop needs no card: the green dot
  on its logo, top right (§217), says it. The card stays only when customers
  **cannot** see the shop (paused, or not approved), because then an empty
  bookings list is correct and would otherwise look broken.
- **Charcoal instead of black.** `--night` is `#2C3039` (was `#15171C`), with
  `#373C46` for hover. Everything dark — buttons, chosen pills, dark cards,
  tab bar — is still clearly dark (white words on it 13 : 1) but no longer
  heavy. Text stays near-black for reading.
- **One flat orange for actions.** Buttons and filled marks use `--primary`
  `#D4401C`, flat, darkening on hover (`#C13917`) and press (`#AC3214`), with
  a thin highlight and a small soft shadow instead of a three-colour gradient
  and a big orange glow. It is a little deeper than the brand orange so white
  words on it pass the 4.5 : 1 reading standard (4.62; the brand orange is
  3.51). The bright brand orange `#F0532D` stays for icons, dots, lines and
  the current-page bar. `--accent-grad` now points at the flat colour, so
  every button that used it changed at once; the "For you" adverts keep their
  own colours.
- **The page you are on**, in the sidebar: a light warm highlight, a short
  orange bar at its left edge and an orange icon, instead of a black pill.
- The greeting's shop name is solid orange, not gradient text.

The rule this sets: one strong colour, used only for what to press; dark
grey rather than black; gradients and glows saved for the few places meant
to stand out (the advert cards), not everyday buttons.

## 219. The mobile money network's own mark on Getting paid (2026-10-08)

The user asked for the MTN logo where the page shows where money goes —
logos give trust and say at a glance what a part means.

- `ui/NetworkMark.tsx` draws the network's mark as a vector: the MTN oval on
  MTN yellow, and Airtel's wordmark on Airtel red — sharp at any size, no
  file. They identify the network the money moves through, nothing more.
- **Wallet card**: the MTN mark sits where a bank card shows its network,
  replacing the gold chip; the foot reads "To MTN MoMo •••• 001".
- **Where your money goes**: the mark replaces the phone icon; the text says
  payouts are sent by MTN MoMo; the number box is labelled "MTN MoMo number"
  with a small mark. All follow the stored number's `provider`.
- **Typing a new number**: the form shows its network as it is typed, by the
  same prefixes as the server's `operator-routing.ts` (§58.1). An MTN number
  is confirmed; an **Airtel** number is warned against, because payouts are
  sent by MTN MoMo only — it is the one disbursement provider built — so an
  Airtel number could not receive them.

Noted, not changed: the business app sends only the number when saving it,
so the server stores every payout number as MTN MoMo (its default), Airtel
or not. The warning covers it until an Airtel payout provider exists.

## 220. Dropdowns close on any click; notifications as a flyout (2026-10-08)

The user: clicking anywhere should close dropdowns like the notifications;
on large screens, notifications should be a flyout rather than a dropdown.

- **Why the notifications did not close.** They drew an invisible full-screen
  layer to catch the outside click, but the frosted top bar's blur makes the
  bar the frame of any fixed layer inside it — so the layer covered only the
  bar, and clicks on the page went nowhere.
- **`ui/useDismiss`**: one rule for every menu — a press anywhere outside it
  (`pointerdown` on the document: mouse, pen or touch) or Esc closes it. The
  notifications, the shop/account menu and every "⋯" menu use it.
- **Large screens (1024px and up)**: the notifications open as a **flyout**
  down the right of the window — a floating panel the full height, the page
  dimmed and softly blurred behind, sliding in from the right — drawn at the
  end of the page (`Portal`) so nothing traps it. It closes on a click on the
  page, Esc, its ✕, or moving to another page. Same rows as before, room for
  many more, and a foot saying how many are unread and that it checks every
  minute.
- **Phones and small tablets** keep the dropdown under the bar, which now
  closes on a tap anywhere else.

Checked by script at 1440 and 390 wide: opens, closes on a click on the
page, closes on Esc; the account menu likewise.

## 221. The "For you" banner, slim, on every page without the column (2026-10-08)

The user: on phones, show the advert on the other pages too (Appointments
and the rest), shorter than Overview's.

- **`ads/AdStrip`**: wherever the "For you" column is not shown (under
  1280px — phones and tablets), every page but Overview opens with the banner
  in a **slim** size: 108px against Overview's 240px. Just the label and the
  title (two lines at most), the button as a round arrow on the right (its
  words kept for screen readers); no art, number or text paragraph. Each
  card's own effect (§212), colours, swipe and dots stay.
- It sits above the page's title and scrolls away with the page; the pinned
  tabs and filters (§214) are unaffected — checked by step-scrolling on a
  phone: nothing moved by itself.
- **Each page opens on its own advert** — by its place in the menu, so
  Appointments, Services, Branches & hours, Reviews… each start somewhere
  different instead of always on the first.
- Overview keeps its full block (banner, "How it works" chips, "See all");
  wide screens keep the column, with no strip.
- The "Read more" / "See what is trending" buttons open their topic or the
  "See all" panel from any page — that logic moved to
  `ads/useForYouPanels`, shared with Overview's block.

## 222. A lighter background in both apps: porcelain (2026-10-08)

The user: make the background of both apps lighter, more professional.

- Both apps' canvas is now **porcelain `#F9F8F6`** — near-white with a
  breath of warmth — instead of the beige `#F4F2ED` (business) and
  `#F6F4F0` (customer). Premium apps sit their white cards on an almost-white
  ground rather than a coloured one; the warmth keeps it from looking cold
  next to the brand orange, and the orange stays the one colour that speaks.
- Business: the token `--canvas`, a matching `--canvas-glass` for the frosted
  top bar and pinned headers, the faint corner light above the page softened
  (0.11 → 0.07, 0.05 → 0.03), and the browser's `theme-color`. White cards
  keep their hairline border and soft shadow, which is what separates them
  now.
- ~~Customer app: `theme.bg`, which every screen reads; and the shopfront
  preview in the business app (§208) follows it.~~ — reverted by §224: the
  user prefers the customer app's original `#F6F4F0`.
- Inside cards nothing changed: inputs, chips and quiet tiles keep their warm
  greys (`--sunken`, `theme.sunken`).

## 223. The slim banner can be closed until the next sign-in (2026-10-08)

The user: on mobile, give the advert on the pages other than Overview an ✕,
so a seller can remove it; it comes back at the next log-in. Not on Overview.

- The slim banner (§221) has a round **✕** on its top-right corner, clear of
  the card's own arrow button, with a larger invisible tap area.
- Pressing it folds the banner away and closes it **on every page** — not
  just the one it was pressed on — until the seller next signs in. A short
  note takes its place for five seconds: "Adverts hidden until you next sign
  in", with **Undo**.
- Remembered in the browser (`ads/stripHidden.ts`), so a reload keeps it
  closed; **signing in, signing out, or the session ending** clears it
  (`auth-context`).
- Overview's own "For you" block has no ✕; wide screens keep the column
  (which already folds, §204).

Checked on a phone: the ✕ shows; closing shows the note; Services and other
pages then open without it; a reload keeps it closed; Overview's block is
unaffected.

## 224. The customer app keeps its original background (2026-10-08)

The user prefers the customer app's original background, so §222 is undone
there: `theme.bg` is `#F6F4F0` again, and the shopfront preview in the
business app (§208), which copies the customer app, follows it. The business
app keeps porcelain `#F9F8F6`.

## 225. The slim banner says the point, in one short line (2026-10-08)

The user: the slim banner (§221) shows a label and a title but not what the
advert is about — "Tip · Jump to anything" without saying how. Use the
important words, like ⌘ K, so it can be read and understood.

Every advert now carries a **`gist`** — its point in one short line — shown
under the title on the slim banner only (the full banners keep their longer
text). Two lines at most, white on the card, rising in after the title. The
banner grows to 118px to hold it (Overview's is 240px). The lines:

- Tip — "Press ⌘ K, then type a word like "prices"" (on a touch screen:
  "Tap the magnifying glass at the top, then …")
- Your best seller — "18 bookings in 30 days · try a sale" / "· on sale now"
- Trending — "12 booked · Kimironko Spa"
- Make your shop stand out — "94% done · next: a description on 6 services"
- Reviews waiting — "Your reply shows under the review, for everyone"
- Branches — "Each gets its own page, hours and prices" (none yet: "Address,
  map pin, hours — then customers can book")
- You can book too — "Sign up in our customer app with your personal email"
- How customers find you — "Bookings × rating decide where you appear"
- Run a sale — "1–90% off · customers see a −% badge"
- Get paid — "Your share is held until you add one" / "Payouts start as soon
  as it is confirmed"
- How it works · Cancellations — "Customer cancels: deposit kept · You
  cancel: full refund"; · Photos — "Up to 11 per service · the first one is
  the cover"
- Just in — a message's first words; a notice's first sentence of meaning
  ("A customer has booked").

## 226. Signing out asks first (2026-10-08)

The user: the sign-out icon can be pressed by mistake — ask whether they
really want to sign out.

Every way out of the business app — the sidebar's icon, Sign out in the shop
menu, the phone's menu, and search — goes through the frame's `leave`, which
now asks first with the app's own dialog (§193.2): **"Sign out?"** — "You
will leave *Kigali Barbers* on this device. To come back, sign in with your
email and the new 6-digit code we send you." — **Stay signed in** / **Sign
out**. Esc, a click outside, or Stay signed in keeps them signed in. On a
phone it rises as a sheet from the bottom, as every dialog does.

The customer app already asked (account screen), so it is unchanged.

Checked: the dialog opens from the sidebar icon and from the phone's menu;
"Stay signed in" leaves the person on the same page, still signed in.

## 227. The app's own dropdown, everywhere (2026-10-08)

The user: the dropdowns open the computer's own menu (a grey macOS list) —
design them properly, across the app.

`ui/Select.tsx` replaces every `<select>` in the business app — five: the
branch filter on Appointments, the order on Reviews, Category and Type of
business on Your shopfront, and District in the branch form (new and edit).

- **On a computer**: a white card under the field (above it when there is no
  room below), the chosen option in orange with a ✓, the row under the
  pointer or the arrow keys highlighted, headings for grouped lists
  (districts under their province), and a search box when a list has more
  than ten options. It follows the field when the page scrolls.
- **On a phone** (600px and under): a sheet rising from the bottom, as the
  app's dialogs do, with a heading, a close button and 50px rows.
- **Keyboard**: ↓/↑/Enter/Space open it; ↓ ↑ Home End move; typing a letter
  jumps to it (or types in the search); Enter or Space chooses; Esc closes
  and returns to the field; Tab moves on. Screen readers hear a listbox with
  the chosen option marked.
- Closes on a press anywhere else. Two looks: `field` (like the app's inputs)
  and `bare` (filling a container already styled — the branch and order pills).

Checked: each opens; choosing by keyboard and by mouse changes the value
(Reviews re-orders highest / lowest / oldest correctly); Esc closes; the
phone sheet. The date and time fields (opening hours on Branches & hours,
the sale's last day on Services, Closures & breaks) still use the browser's
own pickers.

## 228. Branch addresses are suggested while they are typed (2026-10-08)

The user remembered address auto-completion working before and asked for it
in the business app. It had only ever been built for the customer app's
offers address (§174); the business app's branch forms never had it.

- **`components/AddressField`**, in both branch forms (Add a branch, Edit
  details): the same search as §174 (`GET /addresses`, Photon over
  OpenStreetMap, Rwanda only), asked when typing pauses for 350 ms from three
  letters, an earlier question cancelled when more letters come (`api()` now
  takes a `signal`), the last answers kept, dimmed, while the next arrive.
  Each suggestion: a pin, the name with the typed letters in bold, and where
  it is ("Gasabo District, Kigali"). ↓ ↑ Enter Esc work; a press elsewhere
  closes it; a line credits OpenStreetMap.
- **Choosing one does the rest**: it fills the address, **drops the pin**
  (the "Where it is" field and its map preview), and **chooses the district**
  when the place names one — matched against the platform's districts
  (`useDistrictFrom`). A green line says what was filled in and asks the
  seller to check the pin is on their shop. Pasting a Google Maps link and
  "Use my current position" still work as before.
- Under three letters, nothing found, search unavailable and a failed search
  each say so differently, as in §174.
- The endpoint already allowed any signed-in account; its comment now names
  the branch address as a use. Self-hosting Photon before launch (§174.1)
  matters a little more now that sellers use it too.

Checked: typing "kigali heights" offered three places; choosing "Kigali
Heights, KG 7 Avenue" filled the address, put the pin at -1.952708,
30.092776 and chose Gasabo; "kimir" in Edit details on a phone offered six.
Nothing was saved.

## 229. Appointments as a calendar too (2026-10-09)

The user: a calendar view of appointments beside the list, showing bookings
and free time, every status told apart; bookings at the same time drawn as a
**stack** that opens when hovered so each can be read without clicking; a
click on any opens its details as the flyout. "Make it better than I expected."

### 229.1 Where it lives

- A **List / Calendar** switch in the Appointments head. The choice is kept
  (`?view=calendar`, and remembered on the device); the search box and the
  branch filter work in both. Export stays with the list. Choosing a tab
  (Today, Coming up…) goes back to the list.
- The calendar's own state is in the address too — `?cal=day|week|month`
  and `?date=YYYY-MM-DD` — so a view can be shared or reloaded. Week is the
  default; a phone starts on Day and has no Week (seven columns do not fit).
- The page's pinned head (§209) carries the calendar's head instead of the
  list's tabs and column headings, so the dates stay on screen while the
  hours slide under them.

### 229.2 The head

- **‹ Today ›** and the date shown as a button that opens a small month
  to jump to any day; each day in it dotted by how busy it is.
- **How full** the time shown is ("62% booked") — booked place-minutes
  against open place-minutes, counting every place a branch has (its
  capacity) and leaving out breaks.
- **Day · Week · Month**.
- **Status chips** that are also the key: Expected, In progress, Unpaid,
  Done, No-show, Cancelled — each with its colour and count in the time
  shown; a press hides or shows that status (remembered). No-show and
  Cancelled start hidden so the calendar shows the day as it really runs.
  A key for Free, Closed and Break.
- Keys: ← → move, T today, D W M switch views — not while typing or with a
  panel open.
- On a phone, a **week strip** under the head (M T W T F S S, each with its
  booking count) to move between days with one tap; the date reads short
  ("Fri 9 Oct") so arrows, date and views share one row.

### 229.3 The time grid (Day and Week)

- Hours from the earliest opening or booking to the latest (8–18 when there
  is nothing), at least six hours; a red **now** line on today; the past
  greyed.
- **Closed time is hatched** — before opening, after closing, a whole day
  closed — with why ("Usually closed", "Closed — Public holiday"); a
  closure with its own hours shows those hours. **Breaks** (Closures &
  breaks) are their own band. These come from the same branch hours,
  closures and breaks the server uses to offer times.
- **Free time** — open, nothing booked, from now on, on the 15-minute grid
  customers book on, at least 30 minutes — is a dashed green block
  ("+ Free · 3 h"). Partly-full time is not called free; its stack says how
  many places are left.
- **One booking** is a card coloured by status: blue expected, amber late
  (expected but its time has passed) or in progress, grey dashed unpaid,
  green done, red striped no-show, crossed-out cancelled. Time, service
  ("×2" for a group), customer; in Day view, the service photo (§212).
- **Bookings that touch in time are one stack**: paper cards under the top
  one, the count, the time it spans, what is in it, a dot per booking in its
  status colour, and **"42 of 45 free" / "Full"** — the most places taken at
  once against the branch's capacity. In a wide Day column the stack lists
  each booking as a small chip ("09:30 Retired: dye").
- **Hover a stack and it fans open** beside it: a panel with every booking
  in it as a readable card — time, status, service photo and name,
  customer, reservation number, when it starts ("In 2 h"), what is due at
  the shop or the deposit — the cards flying out of the stack one after
  another. Moving into the panel keeps it open; it waits a moment before
  opening and closing so passing over does not flicker. A click pins it
  open. **Check in** and **Mark done** are on the cards for the bookings
  that can take them. **A click on any card opens that booking's details**
  as the flyout from the side, the same one the list opens.
- On a phone or tablet (no hover) a tap opens the stack as a **sheet from
  the bottom**.
- **Day view with All branches** on a computer: one column per branch, side
  by side, each with its own hours, breaks, free time and capacity. Week
  view with All branches merges them (open when any is open).
- Search on the calendar dims what does not match and rings what does.
- Narrow week columns drop what does not fit: "09:00" not "09:00–11:00",
  "42 free" not "42 of 45 free".

### 229.4 Month

Six weeks; each day with up to three bookings ("09:00 Haircut"), "+4
more", closed days hatched, today marked; dots in place of names on a
phone. A day opens in Day view.

### 229.5 On a wide screen

A side column: the small month, and **this week at a glance** — a ring of
how full it is, bookings, hours booked, open hours, and the busiest day.

### 229.6 How it is built

- `lib/bookingLook.tsx` — the status names and colours, reservation number,
  payment line, "In 2 h / Late", service photos — now shared by the list
  and the calendar, so they always agree.
- `pages/calendar/model.ts` — the sums, apart from the drawing: a branch's
  plan for a day (hours, closure, breaks), stacks, places taken minute by
  minute, free stretches, how full. The statuses that take a place are the
  server's (`CAPACITY_CONSUMING_STATUSES`: unpaid, expected, in progress,
  done), and a group booking takes one place per person.
- `pages/calendar/AppointmentCalendar.tsx` + `calendar.css` (`acal-`
  names — the plain `cal-` names were already taken by Closures & breaks).
- Bookings for the time shown come from the list endpoint (`from`, `to`,
  and now `locationId`), a hundred at a time, up to a thousand, refreshed
  every minute. Closures and breaks reuse the Closures page's queries.
- A booking that cannot be opened (deleted meanwhile) now says so in the
  flyout instead of showing an empty panel.

Checked at 1440, 1024 and 390 wide: week (one branch and all), day (one
branch, and a column per branch), month, the hover fan (3 bookings,
"3/45 places"), the phone sheet (4 bookings), search, and a real booking
opening its details with Check in, No-show and Cancel. The demo data has no
bookings at the same time, so the stacks were checked with made-up ones in
the test browser only; nothing was saved.

## 230. A message pressed on Overview opens that very chat (2026-10-09)

The user: pressing a message on the dashboard went to Messages but not to
the conversation pressed.

- The open conversation is now in the address: `/messages?thread=<id>`.
  Messages opens whichever chat it names — beside the list on a computer
  (its row highlighted and scrolled into view), full screen on a phone — and
  a reload keeps it open.
- Overview's three latest messages, and the "Just in" advert's **Reply**
  for a new message, link to their own chat.
- Moving between chats inside Messages replaces the address rather than
  adding to the history, so Back returns to where the seller came from, not
  through every chat they read. Closing a chat removes it from the address.
- The bell's message notifications do not open the chat yet: they carry the
  booking, not the conversation, and a question asked before booking has no
  booking at all. The bell rows do not lead anywhere today.

Checked at 1440 and 390 wide: pressing the third and second messages on
Overview opened those chats; switching chats in Messages updates the address.

## 231. The shop's own logo wherever a card is about the shop (2026-10-09)

The user: the "Your shop is open" card on Your shopfront showed a green play
button; use the business's logo there, and in places like it.

`ui/ShopLogo` (§217) now also draws a small **badge** on its corner — an
icon in a coloured circle — for what the news is, and an amber dot for
**paused**. It is used, in place of a plain icon, wherever a card or notice
is about the shop itself:

- **Your shop is open / paused** (Your shopfront): the logo with a green dot
  when customers can see the shop, grey when they cannot, an amber ⏸ badge
  when it is paused.
- **The sidebar's card** shown only when the shop is hidden (§218): the
  logo with ⏸ (paused), 🕒 (waiting for approval) or ⚠ (rejected or
  suspended), in place of the coloured dot.
- **The bell**: news about the shop — approved, reinstated, rejected,
  suspended (`ABOUT_THE_SHOP` in `lib/notificationLook`) — shows the logo
  with the news's own icon as the badge (✓ green, ⏸ red…). Other notices
  (bookings, reviews, payouts) keep their icons: they are about something
  else.

Left as they were, on purpose: the sidebar's "Your shopfront" link and the
account menu's (menu icons stay one set of line drawings, and the logo is
already at the top of both); the "Logo" step on the shopfront checklist
(it is the thing to add); the For you adverts' icon tiles.

Checked at 1440, 1024 and 390 wide: the card open and paused, the sidebar
card paused, the bell with an approved and a suspended notice (both made up
in the test browser only; nothing was saved).

## 232. "Mark done" asks first, and names the branch (2026-10-09)

The user: Mark done (on Overview and on Appointments) finished a booking at
once; ask first — and say which branch the booking is at, in bold, so a
shop with several branches does not mix them up.

- **Every Mark done now asks** — Overview's today list, the Appointments
  list, the booking's details panel, and the calendar's fanned-out cards:
  "Mark this booking as done?" with **Yes, mark done** (green) and **Not
  yet**. Finishing is for good on the server (only IN_PROGRESS → COMPLETED,
  and it releases the money, §34.3), so the question says it cannot be
  changed back, that the deposit becomes the shop's to be paid out, and
  that the customer can then rate the visit.
- **Which booking**, at the top of the question (`BookingInQuestion` in
  `lib/bookingLook`): the service's photo and name ("×2" for a group), the
  day and time, the customer and reservation number — and under a dashed
  line, the **branch in bold** with its address beside a pin.
- **Money still to collect** at the shop, when there is some, in an amber
  line ("Still to collect at the shop: RWF 5,600") — the last chance to
  remember it before the booking leaves the list.
- The same booking card heads the **No-show** and **Cancel** questions too:
  they also change a booking for good, and the branch confusion is the same.
- From the details panel, the panel closes only when the answer is yes; "Not
  yet" leaves it open where it was. `Actions.complete` now returns whether
  it went ahead.

Checked at 1440 (Overview) and 390 (Appointments, as a sheet from the
bottom), with a made-up booking in the test browser; nothing was marked done.

## 233. Rwanda's flag in the business app, as in the customer app (2026-10-09)

The user asked for the Rwandan flag "just like we did for the customer app"
(§147): one quiet mark at the top of home, and "Made for Rwanda" on sign-in.

- **`ui/RwandaFlag`** — drawn as a small picture (SVG), never an emoji (a
  different picture on every device, the letters "RW" on some). Official
  proportions, 3 by 2: blue the upper half, yellow and green a quarter each,
  the golden sun in the blue towards the fly with its 24 rays drawn as a
  star round a disc. A hairline edge keeps it from melting into a white or
  dark card.
- **Overview**, the first chip on the page: **[flag] Rwanda** | ☀ Friday 9
  October | 00:47 — the place first, as the customer app's home starts with
  its place pill. (Since §234, on a phone only.)
- **Sign-in**: a glass pill **[flag] Made for Rwanda** on the dark panel
  beside "For businesses", as on the customer app's sign-in. On a phone both
  stay on one line (checked at 390 and 360 wide).

~~Not added, as §147 decided for the customer app: a banner, the flag on every
page or in the top bar, or on cards.~~ Superseded in part by §234: the user
wants it in the top bar on every page on a wide screen. Still no banner, and
none on cards.

## 234. The flag in the top bar, on every page, on a wide screen (2026-10-09)

The user preferred the flag at the very top, just before "Your day ›
Overview / Friday 9 October", where it is on every page on a large screen —
and §233's design (the Overview chip) for the phone.

- **Wide screens (860px and up)**: the flag (32px wide, a hairline and a soft
  shadow) sits before the top bar's crumbs and date on every page, centred
  on their two lines. Hovering it says "Made for Rwanda". Overview's chip
  drops its "Rwanda" part there, so the flag is not shown twice.
- **Phones (under 860px)**: the top bar shows only the page title once it
  has scrolled, with no room for more — so the flag is not in the bar, and
  Overview's first chip keeps **[flag] Rwanda** (§233).
- Sign-in keeps "Made for Rwanda" (§233).

Checked at 1440 (Overview), 1024 (Appointments) and 390 (Overview).

## 235. Today's date once: the top bar has it, with a clock (2026-10-09)

The user noticed Overview said "Friday 9 October" twice on a wide screen —
in the top bar under "Your day › Overview", and in the chip just below it.

- **The top bar's second line** now reads **Friday 9 October · 00:52** on
  every page: the date and a clock, the clock in heavier type after a small
  dot. It ticks (every 15 s), so the date also turns over at midnight with
  the tab left open — it used to stay on the day the page was drawn.
- **Overview's chip** ([flag] Rwanda | ☀ date | clock) is now **for phones
  only** (under 860px), where the top bar has no date, flag or clock. On a
  wide screen everything it said is in the bar, so it is gone there and the
  greeting starts the page.

No other page repeats today's date: Closures & breaks shows the day picked,
and the calendar the day or week shown.

Checked at 1440, 1024 and 390 wide.

## 236. Trial: the top bar as dark, see-through glass on a wide screen (2026-10-09)

The user asked to try a black, blurry, see-through background at the top on
a large screen — "if bad we revert it". So this is a trial, kept in one
block at the end of `shell/shell.css` and in one commit, so it comes out
whole.

- **Wide screens (860px and up)**: the top bar is charcoal glass — ~~the
  app's `--night` at 74% with a 22px blur~~ (deeper since §237) — so the page
  shows through it as a soft dark smear as it scrolls under. Its bottom corners are rounded (24px)
  like the cards beside it, with a faint light line along the edge.
- Everything in it turns light to read on it: crumbs and date in soft white,
  page name and clock in white, the search box and round buttons (messages,
  bell, your shop) as faint glass with white icons. **Check in** keeps its
  orange; the flag and the shop logo get a thin light edge.
- **Phones are unchanged** (the light bar, as before).
- The pinned page headers under it (§209) stay light glass.

If it is reverted: delete the block marked §236 in `shell/shell.css`
(or revert this commit) and mark this section ~~superseded~~.

Checked at 1920, 1440 and 1024 wide, at the top of a page and scrolled; 390
unchanged.

## 237. The dark bar near-black with a warm glow; room under it (2026-10-09)

The user asked whether §236's colour was the best, and said "Good morning,
Kigali Barbers" sat too close to the bar.

- **The colour, honestly: it was not.** At 74% over the light page it came
  out a flat mid grey — not black, and not like anything else in the app.
  Now near-black (`rgba(22, 24, 30, 0.88)`, blur 24px) with the soft orange
  glow, top right, that the app's other dark cards carry ("To collect
  today", "Next up", the sign-in panel) — so the bar is one of that family.
  Still glass: a coloured card scrolling under it tints it.
- **Room under the bar** on a wide screen: the page area starts 18px lower
  (was 6px), so the first thing on every page — a title, or the slim For you
  banner on a tablet-width screen — no longer sits against the bar, and the
  banner's ✕ no longer touches it. It is space above the page, not inside
  its header: once a header pins (§209), it closes up under the bar as
  before and costs no height. Phones unchanged.

Checked at 1440 (Overview, Appointments at rest and scrolled — the step
scroll test found no jumps and one header height) and 1024 (Services with
the banner).

## 238. Signing in, the customer app's screen made for the web (2026-10-09)

The user: replicate the mobile app's sign-in (§183) as the web version for
the business app, "a million dollar UI/UX" — and on the moving images, never
pick one image twice.

### 238.1 The layout

- **A computer (1000px and up)**: the wall of shops' photos fills the left,
  the headline at its foot; a white sheet on the right (40% of the width,
  460–620px) with big rounded left corners, the wall running under them —
  the mobile hero and sheet, turned on their side. The wall stays put while
  a tall step scrolls the sheet.
- **A phone or a tablet standing up**: the customer app's screen — the wall
  on top (44% of the height), the sheet rising over it with rounded top
  corners, "Made for Rwanda" and "For businesses" as glass pills at the top.
  While typing on a phone (keyboard up), the wall folds to a strip so the
  question and its button fit, as in the app.

### 238.2 The wall — every photo once

- The photos are the services shops have put up, most booked first (the
  public `GET /discover/services`), the service's own photo only (§183), each
  address once. Today that is 17 different photos.
- **No photo is ever shown twice.** The app loops each column (drawn twice
  end to end) and repeats photos to fill columns, so the same picture could be
  in view twice. Here each column **glides one way and back**, never wrapping,
  so it only needs to be longer than the window it is seen through. A small
  planner picks the most columns that still cover the turned frame and have at
  least 140px to move (4 columns on a computer, 3 on a phone, today); with too
  few photos even for that, the wall holds still and each photo slowly
  breathes in place instead. Tiles go round the columns in order, so the most
  booked are across the top.
- As in the app: turned 10°, heights in a rhythm, neighbours moving opposite
  ways, under the coral-to-night shade. New on the web: each photo fades in as
  it arrives, a whisper of grain, and the wall leans a little away from the
  mouse. Fewer than six photos: the kinds of place stand in, in colour.
  "Reduce motion" holds it all still.

### 238.3 On the wall

- **"Grow your / barbershop."** — the last word changing every 2.3 s
  (barbershop, salon, spa, garage, nail studio, photo studio) in the app's
  gold, rising in with a small overshoot; under it "Customers book and pay a
  deposit. You check them in with a code."
- **Real shops, counted by the server**: "11 places already take bookings
  here" with four shops' logos (`GET /discover/locations`); left out under
  three. Wide screens only.
- **A seller's day, as notices**: New booking → Deposit paid (MTN mark) →
  Checked in → New review → Ready to send, one every 3.6 s, settling on a soft
  stack. Wide screens only; top right, or under the brand on a narrower one.

### 238.4 One question at a time (the app's steps and words, for a business)

- **Email**: "One email. No password." — a well that lights up, its icon
  tile turning coral; a green tick once the address looks right; "Did you mean
  …@gmail.com?" for the common slips, offered, never applied (the app's own
  list); Continue stays grey until the address looks right.
- **New here** (no account yet — or a colleague a business invited, §90.3):
  "Nice to meet you.", three reasons (get booked online; deposits to MTN
  MoMo; check in with a code), a line for invited colleagues, and **the tick**
  — "I have read and agree to the Terms of Use, the Privacy Policy and the
  Seller Agreement", each opening right there in a reading panel (the public
  `GET /legal`) before ticking. This was missing from the business screen:
  §126.2 asks for it, and the server records all three as the account is made
  (§126.1). The button stays grey until ticked.
- **Code**: "Welcome back" or "Creating your account"; "Check your inbox."
  with the address as a chip that goes back to change it; the six boxes
  answer back (a digit pops in, the waiting box glows with a coral caret, the
  row breathes while checked, shakes red when wrong, turns green when right);
  "Send a new one in 0:59" counting down with the server's own wait; "We sent
  you a code a moment ago. Enter that one." when asked again too soon; the
  server's sentences said plainly.
- **In**: a green ring and tick drawing itself, "You are in!" / "Welcome
  aboard!", a thin bar while it opens — then back to the page they were going
  to, or their day.
- The three documents are also at the foot of the sheet on every step.

### 238.5 Fixed on the way

- **A customer's code no longer leaves a session here.** Signing in with a
  customer's email kept their session in the business app under the error;
  now it is signed straight back out, and the error says whose account it is
  and to use the business email. A stray non-business session found on
  opening the page is closed too.
- Already signed in, `/login` goes straight to the dashboard.
- The code boxes (shared with check-in) take a `state`, and a digit's pop
  ending no longer cuts the "wrong code" shake short.

Files: `auth/LoginPage.tsx`, `AuthWall.tsx` (with the planner), `Moments.tsx`,
`RotatingWord.tsx`, `email.ts`, `login.css` (`au-` names); `api/business.ts`
(`wallServices`, `wallPlaces`, `publishedLegal`); `ui/CodeBoxes.tsx`; two
icons (lock, bulb).

Checked at 1920, 1440, 1280×720, 1024, 820, 390 and 360 wide: every photo on
the wall once (17 of 17); the new-business step with the reading panel; the
code step and "You are in!" with a real code from the local mail catcher; a
customer's email refused and signed out; the phone fold while typing. Codes
went only to the local mail catcher; no account was created.

## 239. The landing page: the hero, built to the picture (2026-10-09)

The user: the landing page is "the most attractive part that brings in
users"; replicate the given picture (a dark hero, a headline and a play
button on the left, a tilted stack of screenshots on the right, a sheet of
paper slanting up across the foot with a big number cut out of photos, then
four features and a dark "ready to import" grid) exactly, colours aside —
the hero first. The platform is named **BwanguReservations** for now
("bwangu": quick), with a given mark: a white tile, a "b" in dark green-black
ink and an orange check.

### 239.1 Where it lives

A new app, **`apps/website`** (Vite + React, port 5175, in `scripts/dev.sh`
and the README): its own small static site, apart from the business app, so
the first page a visitor ever sees carries no sign-in code and no data
library — it has to load in a blink on a phone in Kigali. `/api` is proxied
in development; `VITE_API_URL` in production, as in the other web apps.

### 239.2 The hero, piece by piece

- **Colours from the mark**: the ink's dark green-black for the hero (where
  the picture has dark grey), the brand's orange for the button and the play
  disc (where it has yellow), cream for the paper. Plus Jakarta Sans, as in
  the apps, so the site and the apps read as one product.
- **Top bar**: the mark and the name — "Bwangu" white, "Reservations"
  orange — a quiet "For businesses" link to the business sign-in, and the one
  button, "Get the app".
- **The words**: "Bwangu means quick." over "Book your next appointment,
  Easily!" (the picture's "We make it easy" / "Create a beautiful website,
  Easily!"), and the play button "Watch how to book in under a minute!".
- **The stack**: real screens of the two apps, taken from the running apps
  (`public/shots/`): the business app's Overview and its week calendar
  behind, the customer app's home and a shop's page in front, in phone
  frames, overlapping and running off the right edge, each drifting a little.
  When the apps change, the shots are retaken — never mocked up.
- **The paper**: three layers slanting up across the foot — two translucent
  cream bands fanning behind, the cream sheet in front — each a `clip-path`
  path computed in pixels (`sheet.ts`) with its rounded corner, so the angles
  stay true at every width instead of stretching with the box.
- **The number**: the places taking bookings, counted live by the server
  (`GET /discover/locations`), cut out of a mosaic of the shops' own photos
  (`public/collage.jpg`) — "11 Places you can book today." It grows by
  itself; it is never a boast. If the server cannot be reached, the block is
  left out rather than shown with a stale number.
- **The rail** on the right (get the app, how it works, for businesses,
  help) and the back-to-top button, as in the picture. The rail is off on
  phones.
- **Until the app is in the stores**, "Get the app" opens a small sheet that
  says so and points businesses to the web sign-in; the links come from the
  build (`VITE_APP_STORE_URL`, `VITE_PLAY_STORE_URL`, `VITE_CUSTOMER_APP_URL`,
  `VITE_BUSINESS_APP_URL`), so the page points at the real things once they
  exist. The play button opens "How booking works" — find a shop, hold it
  with a MoMo deposit, show the 6-digit code — until there is a video.
- **A phone**: the same, stacked — bar, words, play, the stack, the paper,
  the number. Checked at 390 and 360.

Not yet built (next): the four feature columns, the dark "shops you can book
today" grid with real services, the footer with the three documents and
contact details, the share preview image, and the walkthrough video.

Checked at 1920, 1440, 1024, 390 and 360 wide, and the two sheets.

## 240. The walkthrough video, made from the real app with a voice (2026-10-09)

The user asked whether a video could be made from screenshots with a good
voice-over explaining each step, and chose voice 1 of five samples
(Microsoft's neural "Asilia", Kenyan English). Also: the hero's opening
line "Bwangu means quick." was unprofessional — it now says the benefit,
"Your appointments, without the phone calls."

### 240.1 Made, not edited

`apps/website/video-tools/` makes the video from the running customer app,
so it can be made again with one command whenever the screens change and
never shows an app that no longer exists:

- **`rec.mjs` + `steps.js`** record the real booking on a phone-sized
  screen, frame by frame (Chrome's screencast), while a script taps through
  it as a person would — search "spa", open Kimironko Spa, choose the steam
  room, a day, a free time, Book, choose the saved MoMo number, Pay now —
  and waits for the MoMo **sandbox** to approve the deposit. Each tap is
  logged with its place, for a ripple in the video. `steps4.js` records the
  confirmed reservation with its six-digit code.
- **`voices.sh`**: six lines (intro, one per step, outro), plain words, a
  touch slower than the voice's default.
- **`compose.py`** draws every frame: the dark canvas with the mark, the
  phone in a frame on the right, "STEP n OF 4", the step's title and one
  line under it on the left, the four steps as bars along the foot filling
  as they pass, the tap ripple; an intro and an outro with the name and
  "Get the app". Each step's recording is slowed (to 0.62× at most) or held
  on its last frame so the voice fits; the lines are mixed in where their
  step begins. 1920×1080, 30 fps, H.264, 57 s, 2 MB.
- **`make.sh`** runs the three in order. Each run books and pays for one
  real steam room in the sandbox for the signed-in demo customer.

### 240.2 On the landing page

The play button ("Watch how to book in under a minute!") opens the video in
a wide window with the browser's own controls, a poster of step 1, and the
three steps written under it for anyone who would rather read. On a phone
the steps stack under the video.

Checked: the composed frames (contact sheet), each voice line landing at
its step (silence detection), the window at 1440 and 390. Three bookings
were made in the sandbox while recording (the demo customer's; nothing on a
real phone).

## 241. One ink: the logo's green-black, in every app (2026-10-09)

The user asked to use the landing page hero's background colour in the apps
too, "so that it becomes one of our colours", and what I thought.

**Yes — and as a replacement, not an addition.** The apps' dark was a cool,
blue-ish charcoal (`#15171c` text, `#2c3039` buttons and cards, blue-grey
secondary text); the landing page's is the warm green-black of the logo's
ink (`#1f2a1f`). Two darks across one brand would read as two products,
and a warm dark sits better beside the coral and orange than a cool one.
So the green-black is now the one ink of the platform, taken from the mark:

- **Text**: `#1f2a1f` (was `#15171c`) in both apps; secondary `#4a554a`,
  muted `#7d867d`, faint `#abb3ab` — greys that go with it, warm not blue,
  the same values the landing page uses.
- **Dark surfaces**: the business app's `--night` family becomes a lighter
  tint of the same green-black (`#2b352c` / `#364237` / `#424f43`), so dark
  buttons, chosen pills and dark cards keep §218's "not full black" weight.
  The darkest surfaces — the sign-in wall, the dark top bar's glass
  (§237, now `rgba(30, 38, 30, 0.88)`) — take the ink itself. The customer
  app's `theme.night` (tab bar, darkest buttons) is the ink.
- **Shadows and scrims**: every `rgba(21, 23, 28, …)` (142 in the business
  app, 11 in the customer app) is now `rgba(31, 42, 31, …)` — the ink at a
  strength, as before, so shadows carry the same warmth.
- Left alone: the customer app's "Kigali at dusk" sky palette (art, not
  brand), and the state colours.
- **Admin app**: still the old look with its own tokens; it takes the same
  ink when it is redesigned.

Not changed, and a question for the user: the apps' accent is the coral
`#f0532d` / `#d4401c`, the logo's check is orange `#fd7511`. They are close,
not the same. If the orange is to be the brand's one accent, that is a
second, larger swap (every button and link); the dark is done either way.

Checked: the business Overview (top bar, dark card, dark button, text), the
business sign-in, the customer home (tab bar) and sign-in (the wall's shade).

## 242. The admin console, redesigned — the outline, and piece 1: the design system and the frame (2026-10-09)

The user asked for the admin dashboard to get the treatment the customer
app (§133) and the business app (§190–§204) had: outlined, then built piece
by piece. ~~§61's "a deliberately plain internal tool"~~: the people who run
the platform spend their day here too, and it is the third face of one
product.

### 242.1 The outline — the pieces, in the order an administrator works

1. **The design system and the frame** (this section).
2. **Overview — "What needs you"**: a new home page. Every waiting queue
   with its count and how long the oldest has waited; the platform's pulse
   (bookings, deposits, fees, new shops, new customers — this week against
   last, a 14-day chart); money health (unsettled total, the MoMo wallets
   against the ledger, the exchange rate's age). One new server endpoint,
   `GET /admin/overview`, counts it in one call.
3. **Businesses — the approval desk**: the queue, oldest first, as a review
   workspace — the whole application in a side panel (logo, cover, branches
   on a map, services and prices, people), approve / reject / suspend /
   reinstate with reasons, counts on the tabs, search.
4. **Payout numbers**: the check queue with the networks' marks (§219), the
   number spelled clearly, verify with how it was confirmed, or reject.
5. **Payouts**: a wallet — unsettled money, run payouts, each payout a card
   with send / sent by hand / failed / export.
6. **Support**: an inbox in two panes like the business app's Messages
   (§198) — tickets left, conversation right, internal notes in amber,
   assign and status.
7. **Reviews**: moderation as cards with stars, the shop and the customer,
   hide and unhide with a reason, the hidden ones a filter.
8. **Appointments**: a work list like the business app's (§213), status
   colours and reservation numbers, and the one admin action — reclassifying
   a cancellation — as a careful flow.
9. **Users**: a directory with search and role filters, avatars, and the
   administrators with their invitations.
10. **Money**: the ledger with filters and plain-language entry types, the
    reconciliation, the adjustments.
11. **Categories and Places**: the taxonomy with each category's icon and
    colour; districts by province, with their switches.
12. **Legal and Settings**: the document editor with its versions; the four
    settings as cards, each saying plainly what it changes.
13. **Signing in**: the business sign-in's split screen (§238), for
    administrators — no new-account step, since administrators are invited
    (§99).

Each piece is checked at 1440, 1024 and 390 and recorded here as it lands.

### 242.2 Piece 1 — one brand across the three apps

- **`styles.css` is the business app's design system**, copied (tokens with
  §241's green-black ink, coral, porcelain, Plus Jakarta Sans; controls,
  buttons, tables as rounded cards, night-pill tabs, status pills with a
  dot, drawers, the switch, the app's own dropdown), plus a section for the
  thirty classes only the console uses (money as big tabular figures, the
  ledger's legend, the taxonomy cards, the old Toggle in the switch's look,
  amber internal notes on tickets, hidden reviews dashed). **Every class name
  the twelve pages use was kept**, so all twelve took the new look at once.
- **The UI pieces are the business app's**, copied into `src/ui/`: the icon
  set, the dialog, the dropdown, the avatar, the portal, `useDismiss`, the
  flag; and `src/ui/Logo.tsx` — the platform's own mark (§239).

### 242.3 The frame

- **Sidebar**: the platform's mark and **BwanguReservations** with "Admin
  console" under it; §131's four groups (Moderation, People, Money,
  Platform) with an icon per link; **a count on each queue's link** —
  shops waiting for approval, payout numbers to check, payouts to send, new
  support tickets — so the menu itself says where to go next; who is signed
  in at the foot. Folds to a rail (remembered); always the rail on a
  tablet, labels on hover; a drawer on a phone.
- **"Payout destinations" is "Payout numbers"** in the menu and the search:
  plain words for what they are. The address is unchanged.
- **Top bar** (the business app's, §234–§237, dark glass on a wide screen):
  the flag, where you are, the date and a clock; search (⌘K or "/") over
  every page, with actions — approve a shop, run payouts, invite an
  administrator; **"Waiting"** — the coral button that, in the business
  app, checks a customer in — with the sum of the four queues, opening on
  each queue and its count ("1 shop to approve", "2 payouts to send"), green
  "All clear" when every queue is empty; notifications (§220: a flyout on a
  large screen, a dropdown on a phone) where **a notice now opens the page
  that deals with it** (a new ticket opens Support, a number to check opens
  Payout numbers); the account menu with sign-out.
- **Signing out asks first** (§226).

### 242.4 The browser's own boxes are gone

All **24** `window.prompt` / `confirm` / `alert` calls across ten pages are
the app's dialog now (§193): each says what will happen in plain words,
names the business, number or amount in bold, marks the dangerous choice in
red, and keeps its button disabled until a required reason is long enough —
so the "at least 3 characters" alert boxes went with them. The ledger's
optional reference allows blank but not one or two characters. The two
native dropdowns (the ledger's entry kind, the users' role) are the app's
own (§227).

Checked at 1440, 1024 and 390: Businesses, Payouts, Money, Support, Users,
the Waiting menu, the search, the reject / verify / send dialogs (opened,
not confirmed) and the sign-in. Phones show tables scrolling sideways until
each page's own piece turns them into cards. Nothing was approved,
verified, sent or changed.

## 243. Admin piece 2 — the Overview: "What needs you" (2026-10-09)

The console had no home: an administrator landed on the approval queue and
had to visit four pages to learn what was waiting. Now `/` is an Overview
(first in the menu, where signing in lands) — the business app's Overview
(§192), for the people who run the platform.

### 243.1 One request: `GET /admin/overview`

A new read-only endpoint (`analytics/admin-overview.*`, admins only, the role
asserted again in the service, §27.1) counts, in one round trip:

- **The four queues**, each with when its oldest item arrived: applications
  waiting (§42), payout numbers to check (§48), payouts to send (§36) with
  what they add up to per currency, new support tickets (§24) and how many
  nobody has taken.
- **The last 14 days, in the platform's own time zone** (PLATFORM_TIMEZONE,
  Kigali): paid bookings, deposits, fees, new shops, new customers per day —
  grouped by the database (`AT TIME ZONE`, as §96's busiest hour), never by
  loading rows. **A booking counts on the day its deposit was paid**: an
  unpaid hold that lapses never counts. **Fees come from the ledger**, net of
  any handed back when a business cancelled (§25), so a refunded fee is not
  shown as earned.
- **This week and last**: the chart's two halves added up.
- **What customers can find**: approved, unpaused shops; their open
  branches; customer accounts not closed.

`test/admin-overview.spec.ts` (5 tests): admins only; each queue counted
with its oldest; fourteen days, today last, a booking on its deposit's day;
this week against last with a refunded fee taken off; the platform's size.

### 243.2 The page

- **"Good morning."** and one sentence: "7 things are waiting for you; the
  longest, a shop's application, for 5 days." — or "Nothing is waiting for
  you — every queue is clear." Quick actions: invite an administrator, run
  payouts.
- **What needs you**: a coral card per queue — the count, what it is, how
  long the oldest has waited (an amber chip after two days), why it matters
  in one line ("A shop is not paid until its number is checked"), the
  money for payouts, "2 not taken by anyone" for tickets. An empty queue is a
  quiet white card with a green tick and "All clear". Each opens its page.
- **The last seven days**: bookings paid, deposits taken, fees kept, and
  who joined (shops and customers), each against the week before ("+40%",
  "New" when last week had none).
- **Bookings, day by day**: the business app's bar chart over 14 days, the
  week before a step lighter, today in coral; each bar says its bookings and
  deposits.
- **Money — does it add up?**: what is held for shops and not yet paid out
  (§51), payouts ready to send, the wallet check (§87 — the MTN sandbox has
  no real wallet, said so), and whether the exchange rate needs updating
  (not needed while the platform takes and pays in RWF).
- **On the platform**: live shops, open branches, customers.

### 243.3 Counts that follow every action

Any successful action anywhere in the console (approve, verify, send,
answer…) now refreshes the menu's counts, "Waiting" and the Overview at
once (a mutation cache), rather than at the next minute.

Checked at 1440, 1024 and 390 with the demo data (25 paid bookings this
week, the four queues at 1 / 2 / 2 / 2).

## 244. Admin piece 3 — Businesses, the approval desk (2026-10-09)

The approval queue was a table: a name, a category, a date, two buttons, and
a read-only drawer (§117.2) beside it. Approving puts a shop in front of every
customer at once, so the page is now a desk built around that decision.

### 244.1 The server

- **`GET /admin/businesses?q=`** — a word to find a business by: part of its
  name (any case), its phone, or an active member's email. Searched by the
  database, with the status filter and the paging, so a long list is never
  loaded to be filtered in the browser (§216's rule).
- **The detail an approval rests on** (`GET /admin/businesses/:id`) now also
  carries each branch's **pin, district and province, open or closed, and up
  to six photos**; each service's **description and cover photo**; and the
  business's **latest payout number** with its network and whether it has
  been checked (§48).
- `test/admin-business-desk.spec.ts`: search by name, phone and a member's
  email, combined with a status; the pin, district, photos and payout number
  in the detail. The 61 approval tests (§42) still pass.

### 244.2 The page

- **Tabs with counts** (Awaiting review, Approved, Suspended, Rejected, All),
  the waiting count in coral; **search** that asks once typing pauses; tab,
  search and the open application kept in the address, so a link or a
  reload lands on the same view. Oldest first, as before (§42), 25 at a time
  with "Show more".
- **Each business a card**: its logo (or initials on a colour of its own —
  `ui/ShopMark`, squarer than a person's avatar, so a shop and a person are
  never confused), name, category, when it applied ("Waiting since 5 days
  ago" in amber on the queue, with an amber edge), its status, and the
  reason when rejected or suspended. A waiting one has **Reject / Approve /
  Review** on the card; the rest open their review.
- **The review panel** (the business app's side panel, §195), with the
  decision at its foot beside the evidence: the **cover and logo as a
  customer will see them**; **"Ready to go live?"** — a name (the only hard
  rule, §53), a description, a logo, an open branch, a branch on the map, a
  service with a price, a checked payout number — each missing one saying
  why it matters; the description; **each branch on a map** (the business
  app's still map, §195) with its address, district, capacity and photos;
  **each service** with its photo, length, deposit and **price at each
  branch** (§72); **the people** who act for it; **the number it is paid
  to** with the network's mark (§219) and whether it has been checked.
- **Every decision asks first**, in plain words: approving says customers
  can find and book it at once; rejecting and suspending ask for the reason
  they are sent; reinstating says payouts resume; a rejected shop can be
  **approved after all** — the appeal path §42 always allowed and the page
  never offered.
- On a phone the cards stack, the whole card opens the review, and the
  panel's decision buttons stay at its foot.

Checked at 1440 and 390: the queue, All, search ("kimir" → Kimironko Spa,
the counts following), an approved shop's review (three branches on maps
with photos, seven services), the waiting application's review (the logo
and payout number flagged). Nothing was approved or rejected.

## 245. Admin piece 4 — Payout numbers, each one a card with its check (2026-10-09)

The queue that decides whether shops get paid (§48) was a table with a raw
number in code type and the words UNVERIFIED / SUPERSEDED. A shop waiting
here is not being paid (§48.3), so each number is now a card with what the
check needs beside it.

### 245.1 The server

`GET /admin/payout-destinations` now also gives, per number: the **shop's
logo**; **who gave the number** (their email — the person to check it
with) and **who checked it**; and **`replaces`** — the number it came
after for the same business, so a changed number is read beside the old one.
(`replacedBy`, its forward pointer, was §78.) Two tests added to
`payout-destinations.spec.ts`; all 52 pass.

### 245.2 The page

- **Plain words**: To check · Checked · Refused · Replaced · All (was
  UNVERIFIED / VERIFIED / REJECTED / SUPERSEDED), with counts on the tabs;
  the tab is kept in the address.
- When numbers are waiting: "A shop waiting here is **not being paid**: an
  unchecked number pauses its payouts rather than skipping them quietly."
- **Each number a card**: the shop's logo and name, who gave it and how long
  it has waited (an amber strip along the top while waiting); **the number
  spelled in threes** (+250 788 100 004), large, beside the network's own
  mark (§219); then the facts the check rests on:
  - **does the prefix agree** with the network given (078/079 MTN, 072/073
    Airtel — §58.1's table, `networkOf`)? A mismatch is said in amber;
  - **is it the shop's own phone?** If not, the shop's phone is shown with
    **"call the shop"** (a `tel:` link) — calling the number on file is the
    usual way to confirm a new one;
  - **"Changes their number from +250 …"** when it replaces an earlier one —
    "worth a call before money goes elsewhere" when the old one was checked;
  - once checked: by whom, when, and the note of how (§48), quoted; once
    refused: the reason; once replaced: by what.
- **Mark as checked** (green) asks how it was confirmed — the only record of
  the decision once money has moved; **Refuse** asks for the reason the shop
  is sent.

Checked at 1440 (To check, All) and 390. Nothing was checked or refused.

## 246. Admin piece 5 — Payouts, as a wallet (2026-10-09)

The payouts page was a table, a grey "Unsettled" card, and a run result that
listed held-back shops by the first eight characters of their id. Now:

### 246.1 The server

- **A run names whom it held back**: each entry in `pausedBusinesses` now
  carries the shop's **name** beside its id and reason — a list of ids is not
  a list anyone can chase. The existing assertion was extended; the payout
  suites (99 tests) pass.
- **Each payout carries the shop's logo** (`businessProfile.logoUrl`).

### 246.2 The page

- **The wallet** — a dark card in the logo's ink with a warm glow: **held for
  shops, not yet paid out** (§51), large; beside it **ready to send** (the
  amount and the number of payouts, from §243's overview), **with the
  operator** (checked every minute, §64.3) and **sent so far**. Entries that
  cannot be paid (no settlement amount, §46.3) are said in amber on it.
- **Run payouts** asks first and says what it does in plain words: it works
  out what each shop is owed and makes one payout per shop — **no money moves
  yet**; shops that cannot be paid are held back and listed by name.
- **What the run did**: "3 payouts ready to send — RWF 28,400", how many shops
  were considered, then **the held-back shops by name**, each with why and a
  link to fix it (Suspended → that shop on Businesses; no checked payout
  number → Payout numbers), and how many were skipped for a zero or negative
  balance ("what they owe carries forward rather than being forgiven", §35.3).
- **Tabs in plain words with counts**: To send · With the operator · Sent ·
  Failed · All, kept in the address.
- **Each payout a row**: the shop's logo and name, **where the money goes**
  (the number in threes with the network's mark — or, in red, "No checked
  payout number — check one first", linking there, which is also why Send is
  off), **the amount** large, its status and when (run / handed over / sent),
  the reference or the failure reason, and **Export the run** for checking
  against the operator's statement; the coral edge marks one to send, red one
  that failed. **Send** asks first (real money, cannot be undone); **Sent by
  hand** asks for the reference; **Mark failed** asks why. A payout with the
  operator shows a pulsing "checked every minute".

Checked at 1440 (the run result with two shops held back, faked in the test
browser — no real run was made), 1024 and 390. Nothing was sent or marked.

## 247. Admin piece 6 — Support, as an inbox in two panes (2026-10-09)

Support was a table and a drawer: a ticket's reporter was an id, the latest
word was not shown, and "Take it" and "Start handling" sat side by side
although the server already makes the person who starts a ticket its owner
(§24.3). Now it is the business app's Messages (§198) for the people who
answer everyone else.

### 247.1 The server

- **Search** (`q` on `GET /admin/tickets`): a reference, the subject, the
  reporter's email or the shop's name, case-insensitive.
- **Each row says who and what was said last**: the reporter's email, the
  shop's name and logo for a shop's ticket, who has it, and the **latest
  message** (cut to 160 characters, with whether it was the reporter, an
  answer or an internal note) — so the list can be read without opening
  anything.
- **`GET /admin/tickets/:id` carries the booking** a ticket is about: its
  service, branch, time, status and deposit, plus the reporter, shop and
  holder. Three tests in "the console's inbox (§247)"; the suite (62) passes.

### 247.2 The page

- **Left, the tickets**, newest word first: who raised it (the shop's tile
  for a shop, initials for a customer), the subject, the latest words
  ("Support:" / "Note:" before ours), its status, reference and **"Nobody has
  it"** in amber or **"With you"**, and "Reopened ×n". A coral dot marks one
  waiting on us — new, or the reporter spoke last.
- **Filters on two rows**, the work still open over the finished: New ·
  Being handled · **Mine** / Resolved · Closed · All, each with its count.
  **Mine is what you are handling now** (being handled, held by you): a
  count of your finished tickets would read as work on your plate.
- **Right, the ticket**: category and reference, the subject, who raised it
  and when; **one next step** — *Start handling* on a new ticket ("it becomes
  yours, and they are told someone is on it"), *Mark resolved* (asks for the
  outcome the reporter is sent, §24.3), *Close* (asks first: nobody can reopen
  a closed ticket; left alone it closes 14 days after resolving, §24.4);
  *Take over* asks before taking a colleague's ticket.
- **The booking it is about**, as a card at the top of the conversation: the
  service and branch, the day and time, the reservation number the customer
  quotes (§213), the deposit, and its status in the business app's words
  (Expected, Done, No-show…) — `lib/bookingLook.ts`, which the Appointments
  piece will use. It links to the booking.
- **The conversation**: the reporter on the left, answers on the right in
  ink, **internal notes across the middle in amber with a dashed edge**, so
  nobody mistakes one for something the reporter was sent; attachments as
  chips ("Image · 180 KB"). The **outcome** sits in green above it once
  resolved.
- **Writing**: *Reply to the customer / the shop* or *Internal note*; the box
  turns amber for a note ("the reporter never sees a note"); ⌘ Enter sends.
- **On a phone** the open ticket is the whole screen, over the list: back on
  the left, its status on the right, the title under both.
- **A notice opens its ticket**: ticket notices carry no id, but name the
  reference, so they open `/tickets?ref=TKT-…`, which finds the ticket, picks
  its tab and opens it (as §230 did for the business app's messages).

### 247.3 The frame

- **"Checking…" until the queues have answered.** The top bar said "All
  clear" in green for the moment before the counts arrived, then turned coral
  — a claim it could not yet make. It is neutral until all four counts are in.

Checked at 1440, 1024 and 390, open and closed, with a conversation of a
reply, a note and an attachment faked in the test browser. No ticket was
started, answered or closed.

## 248. Admin piece 7 — Reviews, the business app's page from the moderator's side (2026-10-09)

Reviews was a list of boxes with "★★★☆☆" in text, a checkbox for low
ratings and up to 100 reviews with no search. Now it is the business app's
Reviews (§199, §215) turned around: there, each review is about *your* shop
and the job is to answer it; here, each is someone writing about *a* shop,
and the job is to decide whether customers may read it.

### 248.1 The server

`GET /admin/reviews` gains, beside its visibility and `maxRating` filters:

- **`q`** — the words, the reviewer's name or email, the shop's or branch's
  name, case-insensitive;
- **`rating`** — exactly this many stars (a bar of the breakdown);
- **`sort`** — newest, oldest, lowest or highest first, ties broken by date
  and id so a page boundary never repeats or skips one (as §215);
- per review: the **shop's logo**, the **booking** reviewed and its
  **service**, and when the shop's reply was edited;
- **`breakdown`**: the reviews customers can see, by star, how many are
  shown and hidden, and their average — **counted whatever the filter**, over
  one shop when the list is for one, else the platform. The average comes
  from the star counts already in hand (one decimal place; null, not zero,
  when nothing shows), not a separate `AVG()`.

Six tests in "the console's review desk (§248)"; the suite (107) passes.

### 248.2 The page

- **The summary**: the platform's score large, with stars; the split by star
  as bars (1–2 stars in coral — those are the disputed ones), **each bar a
  filter**; and a dark card for **what is hidden** — how many, the share of
  all reviews as an amber ring, what hiding does, and *See them*.
- **One card of reviews**, its top pinned: search, order, then *Showing ·
  Hidden · All* with counts, and a **1–2 ★ only** chip (a chosen bar shows as
  its own chip, with ×). The address keeps all of it.
- **Each review leads with who wrote it** — their name as shown (or
  Anonymous) and their email — then **about which shop** (its tile, name and
  branch), the service and the date, the stars as a pill (red at 1–2), the
  words (clamped, *Read all*), and the shop's reply under its own tile.
  Search words are marked where they appear.
- **Hide from customers** asks for the reason (kept against your name; the
  customer is told why, the shop that its rating changed — §93). **Show it
  again** asks first too, quoting why it was hidden. A hidden review stays
  in the list faded behind a light hatch, with an amber note of who hid it,
  when and why. *The booking →* links to the booking reviewed.
- Twenty at a time, the next page loading as the end comes into view.

Checked at 1440 (Showing; All with the hidden one), 1024 (a search) and 390
(the summary; Hidden). Nothing was hidden or shown again.

### 248.3 Housekeeping

The old page's styles (`.reviews`, `.review`, `.rating`, `.reply-shown`…)
and the old ticket drawer's (`.thread`, `.message`, `.reply`…) left
`styles.css`. An `eyeOff` icon joined the set for hiding.

## 249. Admin piece 8 — Appointments, every booking on the platform and each one's whole story (2026-10-09)

Appointments was a table of up to 100 rows behind an "only reclassifiable"
checkbox, a drawer that asked for a ticket by its raw id and an operator's
charge in "minor units", and no way to find a booking a customer quotes. Now
it is the business app's work list (§213) for the people who look bookings
up rather than run a day, with a panel that tells one booking's whole story.

### 249.1 The server

- **`q` on `GET /admin/appointments`** takes what people quote: the
  **reservation number** from the customer's app ("0440-A141", "0440A141" or
  "No. 0440-A141" — the first eight hex characters of the id, §213), part of
  the customer's email or name, or the shop's, branch's or service's name.
- **`sort`**: latest start first, or soonest (`AppointmentOrder`, §213), ties
  broken by id so pages never repeat or skip a row.
- **Each row says more**: when it was booked, how many people, the full
  price, when the deposit was paid, when the customer was checked in and how
  (code, or without one), when it was done or marked a no-show, the
  customer's name, the service's first photo, the shop's logo, the stars it
  was given and how many tickets are about it. One select and one mapper
  serve the list and the new read, so the two cannot drift.
- **`GET /admin/appointments/:id`** — one booking with everything a dispute
  turns on: the unit, list and discounted price; the branch's address and the
  number to call (the branch's own, else the shop's); the operator, its
  reference, when payment was asked for, what the operator charged and at
  which rate; who checked the customer in and their note when it was done
  without a code; who cancelled; the ticket a reclassification was decided
  on; **every ledger line written for it** (signed from the shop's side, and
  whether it has been paid out); the review; and the tickets about it.
- Five tests in "the console's bookings (§249)"; the suite (14) and the refund
  and ticket suites (107) pass.

### 249.2 The page

- **One card, its top pinned**: a search box that says what it takes ("No.
  like 0440-A141, an email, a shop…"), then tabs with counts — All, Expected,
  In progress, Unpaid, Done, No-show, Cancelled — in the business app's words
  and colours (`lib/bookingLook.ts`, §247). Under *Cancelled*, one chip:
  **Paid, then cancelled by the customer** — the only ones that can still be
  put on the shop — with its count.
- **Rows grouped by day**, the business app's columns: the time and length;
  the customer (name or email) with the reservation number; the service's
  photo, name and ×people, with the shop's tile, name and branch (the branch
  gives way before the shop's name when space runs out); the deposit and
  what it came to (paid, never paid, waiting, refunded in full); the status
  with a line of what matters — "Checked in 10:02 · no code", "Reviewed 4 ★",
  "Cancelled by the customer", "Not paid in time" (a booking released unpaid
  was not cancelled by anyone); and a coral flag when tickets are about it.
  The tabs still ahead read soonest first; the rest latest first.
- **One booking, in the panel**: its photo, status, the number to copy, the
  day and time; **the customer and the shop** side by side (email, address,
  the number to call, *Their bookings →*, *The shop →*); **the money** as
  tiles — full price, the deposit and when it landed, our fee, the shop's
  share, and in coral what is still to pay at the shop — then **what the
  ledger wrote for it**, line by line in plain words, signed, with *paid out*
  where it has been; **the payment** under the operator's own mark, with its
  reference to copy; **what happened** as steps (booked, paid, checked in —
  with or without a code, by whom — done, no-show or cancelled and why, and
  what is still to come); the review; the tickets, each opening in Support.
- **Putting a cancellation on the shop** stays the one change an
  administrator may make (§25, §95), offered only when the server would
  accept it. It opens in the same panel: in red, that it moves money and
  cannot be undone; then, in money, what each side gets — the customer back
  the whole deposit with our fee, the shop losing its share and carrying the
  operator's charge — and that both are told the reason. The form asks what
  happened, **which of this booking's tickets it was decided on** (picked,
  not pasted as an id), and the operator's charge **in the currency's own
  units**, converted with the server's exponent (§70.1). The button names the
  amount: *Refund RWF 1,400*. A booking already put on the shop says so in
  green, linking the ticket it was decided on.
- **Links in**: Support's booking card (§247) and each review (§248) open
  `/appointments?open=<id>`.

Checked at 1440 (the list; a booking with a ticket; a reviewed one; the
refund form, not sent), 1024 (a search) and 390 (the list; a booking). No
cancellation was put on a shop.

## 250. Admin piece 9 — Users, the person behind the bookings, reviews and tickets (2026-10-09)

Users was a table of up to 100 accounts with a role dropdown, and an
Administrators card on top of every view. Now it is one card of people with
a panel for each, and administrators are a tab.

### 250.1 The server

The directory row (`GET /admin/users`) gains:

- **their photo** (`imageUrl`), when they set one;
- **`closedAt`** — a closed account (§122) says so;
- **`lastSeenAt`** — when their app last renewed its session: sessions rotate
  on every renewal, so the newest refresh token's creation is the nearest
  thing to "last seen" the platform keeps, without adding a column that
  every request would have to write;
- **`homeArea`** — the district a customer set as home for offers (§186);
- **each shop's logo** beside where they work.

Two tests in "the console's people (§250)"; the suite (11) passes.

### 250.2 The page

- **Search** (email or name), a **Has a chosen name** filter (the names on
  reviews — the only ones that can be cleared; an icon on a phone), and
  tabs with counts: **Everyone · Customers · Shop accounts ·
  Administrators**, all kept in the address.
- **Each person a row**: their photo or initials; the name they chose over
  their email — or the email over "No name chosen", never a made-up name
  from the address; **what kind of account** as a coloured word (the primary
  administrator named as such, "You" on your own row, "Closed" in red);
  **where they work** (the shop's tile, its name and their role, "+1 more")
  or, for a customer, **the area they call home**; their bookings, reviews
  and tickets as three small counts; and **when they were last seen** and
  joined. A closed account is faded. On a phone the kind of account sits
  under the name.
- **One person in the panel**: the photo large, the name, the email to write
  to, joined, last seen and home; a red note if they closed their account;
  **three tiles that open their bookings, reviews and tickets**, already
  searched for them (§247–§249); the shops they work at; and **Decisions**:
  clearing the name on their reviews (asks for the reason they are told —
  there is still no editing someone else's name, §94), and, for the primary
  administrator, **removing another administrator's access** (asks first;
  it is said why it is not offered on your own row or the primary's).
- **Administrators**: the tab shows, above them, **inviting one** — what the
  invitee gets and that the address must have no account yet (§99) — and the
  **invitations not yet taken**, with who sent each, until when its link
  works or that it has expired, and *Cancel* (asks first). Anyone who is not
  the primary administrator sees one line saying only the primary can.

Checked at 1440 (Everyone; Administrators with an invitation faked in the
test browser — the demo administrator is not the primary, so for them the
section is read-only; a customer's panel), 1024 (a shop owner's panel) and
390. Nothing was invited, cleared or removed.

## 251. Admin piece 10 — Money: our figure beside the operator's, adjustments as decisions, the ledger with its context (2026-10-09)

The outline (§242.1) said "plain-language entry types". **That part was not
done, on purpose**: §85 renamed exactly these labels and was reversed at the
user's request — "plain words when I explain, the domain's words on screen".
The entry types keep their names (Deposit received, Platform fee, Deposit
refunded, Platform fee returned, Gateway fee, Manual adjustment), as do
*Adjustments*, *Ledger*, *Execute*, *held* and *available*; what a name cannot
say is the legend beside it (§86).

### 251.1 The server

- **Each ledger line carries its business** (name and logo) **and the booking
  it is for** (its service and day) — the page used to load a hundred
  businesses just to print names, and showed an id for the rest.
  `AdminLedgerEntryDto` extends the bare line and is checked against the
  query's own payload (`NoExtraFields`, §128), so the two cannot drift.
- **`q`** (part of a business's name) **and `from`/`to`** on
  `GET /admin/ledger/entries`; the totals still cover the whole filter.
- **Each adjustment carries its business, the ticket it was decided on and
  who recorded it**; **`state`** (outstanding / executed) filters it on the
  server, while `outstanding` still counts every one waiting.
- Three tests in "admin ledger reads (§53.3)"; the refund suite (48) and the
  other ledger, payout and reconciliation suites (264) pass.

### 251.2 The page

- **Our figure beside the operator's** (§87), one dark card: *Our ledger says*
  — what is held and not yet paid out, large; *MTN · Deposits land here* and
  *MTN · Payouts go out from here*, each its own answer or *No answer*; a
  *Sandbox* tag when it is; and **a verdict** — *They agree* in green, *Off
  by …* in amber with what that means, or *Not comparable now* with why
  (sandbox, a different currency, the deposit wallet not reported, nothing
  held) — and *Ask again*. Our figure never waits for theirs.
- **Adjustments** (the default, with how many are waiting) as rows: the
  business, the kind, the reason in its own words, who recorded it and on
  which ticket, the amount signed from the business's side (+ to them, − from
  them), and either *Execute* (asks for the provider's reference, says it
  cannot be undone) or *Executed* with when and the reference — or "netted
  against a payout". *Still to execute · Executed · All*, with counts.
- **Ledger**: search by business, *Any time · Today · Last 7 days · Last 30
  days*, the kinds of entry as chips (each with its meaning on hover), the
  count and **the total in view** with the rule that makes signs readable;
  then each line — when, the business, what happened and **for which booking**
  (opening it, §249), the signed amount (and the reporting figure when the
  currency differs), and whether it is *held*, *held until …*, *available* or
  *paid out*. Forty at a time, the next as the end comes into view; the
  legend under it.
- **Pinned**: the title and the operator's card scroll away; the
  *Adjustments / Ledger* switch stays.

### 251.3 A correction to §249

The booking panel's money had said "Our fee", "Our fee given back" and "The
operator's charge for the refund" — the renaming §85 reversed. The ledger's
words now live once, in `lib/ledgerWords.ts`, and both pages read them:
*Platform fee*, *Platform fee returned*, *Gateway fee*, with each line's
meaning on hover; the refund form says "the platform fee … included" and
names the gateway fee for what it is.

Checked at 1440 (adjustments; the ledger scrolled, with the switch pinned),
1024 and 390. Nothing was executed.

## 252. Admin piece 11 — Categories and Places, as the customer sees them and as a map of switches (2026-10-09)

Both pages were lists of grey cards with a switch and a *Rename* link per
line, and a category's mark was its raw `icon` word ("calendar-star") printed
before its name. No server change: what both need was already there.

### 252.1 Categories

- **Each category as the customer app draws it** (§133): its own pair of
  colours and its mark, from the same table and the same Ionicons glyphs the
  customer app ships — copied with the business app's shopfront subset
  (§208) into `ui/ionicons.ts` and drawn by `ui/CategoryMark.tsx`. The card's
  head is washed in the category's tint, so the page reads like the
  customer's home screen.
- Above them: **how many categories and types are offered** ("46 of 46 types
  a shop can pick" — a type under a retired category does not count) and how
  many shops are listed in them.
- Each card: the mark, the name, how many shops and what it covers; its
  switch (*Offered / Retired*, asks first, naming the shops that keep their
  listing, §98); a pencil that edits **the name, the description and the
  mark** in place; then its types, each with its shop count, its own switch
  and a rename that shows on hover — a type left on under a retired category
  says "Not offered while … is retired" and is struck through; and *Add a
  type* at the foot.
- **A new category** opens in a panel with a live preview ("as customers will
  see it") and a picker of the marks the apps can draw, instead of a free
  "icon key or emoji" box that produced marks no app knew.
- A retired category is drawn quietly: a dashed edge, a grey mark.

### 252.2 Places

- A line across the top: **"Open in 6 of 31 districts"**, the provinces and
  branches it covers, and a bar per province.
- **Each province a card** with a ring of how many of its districts are open,
  and **each district a tile**: open ones lit green with a pin, retired ones
  quiet, each with its branches ("· still listed" when retired with branches
  in it), its switch (asks first, §105, §98.1) and a rename on hover. *Add a
  district* is the last tile and becomes a small form (name and code).
- Nothing on either page deletes anything (§101).

The old `.taxonomy`, `.cat`, `.subs`, `.sub-add`, `.people` and `.filters`
styles left `styles.css`.

Checked at 1440 (both pages; the new-category panel), 1024 (editing a
category in place) and 390 (both pages). Nothing was switched, renamed or
added.

## 253. Admin piece 12 — Legal as a document desk, Settings as four cards (2026-10-09)

No server change.

### 253.1 Legal

- **The three documents on a shelf** — Terms of Use, Privacy Policy, Seller
  Agreement — each saying its live version and since when, how many people
  agreed to it, whether a draft is being written, and **how many [BLANKS]**
  are still in it (the published texts carry placeholders like "[COMPANY
  LEGAL NAME]"; 19 and 20 in the demo — something to fill before launch).
- **The live version read as a page** (`ui/LegalText.tsx`): the text stays
  plain (§122.4); only its shape is read — a line in capitals is a heading,
  "- " lines a list — and every [BLANK] is marked in amber. Beside it, **the
  versions** as a timeline (each with its date, how many agreed and what
  changed), any of which opens in the page; and *Write a new version*.
- **A draft is written beside its preview.** The preview marks, paragraph by
  paragraph, **what it changes from the live version** — taken out in red,
  struck through; added in green — with "+2 −1" in its pinned header, or
  shows it as it will read. Paragraphs, not words: the reader asking "what
  moved?" wants the clause. The editor shows whether it is saved, the word
  count and the blanks; *Publish* saves first and asks, saying how much
  changed, and warning when there is no note of what changed or blanks
  remain. A published version still cannot be edited (§122).
- The page's title is not pinned: a document is long, and its own headers
  stay in view instead.

### 253.2 Settings

**Four cards, each its value large** and what it means in money, each still
saved on its own (§96's reasoning stands):

- **Platform fee** — "10%", and "on a RWF 10,000 service, RWF 1,000 is the
  platform's"; future bookings only, when it last changed.
- **Payout hold** — "2 days", drawn as *Done → 2 days → Payable*.
- **Exchange rate** — "1 RWF = 1 RWF" with *No conversion is in use* when the
  platform collects in the currency it prices in (§69.1); otherwise the rate,
  a bar of its age against when administrators are warned (the threshold
  itself a link to change), and the stale warning.
- **Payment providers** — MTN MoMo and Airtel Money under their own marks,
  *Taking deposits* or *Not configured*; read-only, because it follows from
  credentials (§96).

A change opens in place (*Change* → the number, Save, Cancel); the fee, the
hold and the rate then **ask first**, saying the old and the new value and
what does not change (bookings already made keep their fee and rate; dates
already set stand). The server's refusals — a fee raise above a service's
deposit (§40) — are shown in its own words.

The `.setting`, `.card-list`, `.card-row`, `.legal-body` and `.legal-input`
styles left `styles.css`.

Checked at 1440 (Legal reading; a draft faked in the test browser with one
paragraph changed and one added — none was started; Settings with a change
open, not saved) and 390. Nothing was published or changed.

## 254. Admin piece 13 — Signing in to the console, and the redesign closed (2026-10-09)

### 254.1 The sign-in

The console's sign-in was a small centred card. Now it is the business app's
(§238), for the people who look after the platform — the same split screen,
copied rather than shared, as the rest of the console was (§242):

- **The wall**: the shops' own service photos gliding in turned columns,
  every photo shown once (`planWall`, §238), from the same public list the
  business app reads (`GET /discover/services`, added to the console's API
  with `/discover/locations`).
- **On it**: the platform's mark and name, *Admin console*, *Made for
  Rwanda*; the console's own notices arriving one at a time — a shop to
  approve, a payout number to check, a new ticket, payouts ready to send, a
  review to look at; and the headline **"Look after every shop. / booking. /
  payout. / review. / ticket."**, with "Approve shops, settle disputes and
  send payouts — the platform's back office" and how many places take
  bookings, with their logos.
- **The sheet**, one question at a time: *Administrators only* — "Sign in to
  the console." — the email you were invited at; then the code in six boxes
  (with the resend timer, the "we sent one a moment ago" case, the shake on a
  wrong code); then "You are in!" and on to what needs you.
- **No signing up.** This is the difference from §238: administrators are
  invited (§99). An invited address simply asks for a code — the invitation
  is what lets it go out, and the first code makes the account — so an
  address with no account here is not somebody new to welcome but somebody
  not invited. The sheet says so plainly: *Not invited* — "No account for
  this address", and how invitations work (the primary administrator sends
  one from Users; then sign in here; an old one may have run out). An
  account that is not an administrator's is signed straight back out, with
  why.
- No role is ever sent (§50).

### 254.2 Closing the redesign

`styles.css` was swept: every class it styles was checked against the whole
console, and the 55 rules styling nothing any more — the old sign-in card,
the drawer forms, the business app's gallery, file and switch pieces copied
in §242 and never used — left. Classes made at run time (the dropdown's
`sel-…` variants, `is-…` states, status pills) stayed. The earlier pages were
checked afterwards and look as they did.

That completes the outline of §242.1: all thirteen pieces are done (§242–§254).

Checked at 1440 (the email step; the not-invited step, reached with an
address that has no account — the server refuses before any code is made) and
390.

## 255. Going live: a shop gets ready, sends itself for review, and can send itself back (2026-10-09)

Asked: connect the landing page to the business app so sellers sign in or up
first; keep the approval step; guide new sellers through the vital details only
(the rest skippable, added later); tell administrators when a shop is ready;
refuse approval of a shop nobody could book; let a rejected shop fix things
and send itself back. Built as four pieces: the rules (§255), the business
app's onboarding (§256), the console (§257), the landing page (§258).

### 255.1 How it worked before

Signing up as a business created the account, an EMPTY shop (no name) in
`PENDING`, and its owner membership (§50, §90.3). The shop could set up
everything while PENDING, invisible and unbookable (`isPubliclyBookable`,
§119). Every PENDING shop was in the administrators' queue from the moment
of sign-up; nobody was told one had arrived; approval refused only a shop with
no name (§53.1); a rejection was final unless an administrator changed their
mind (the email said to raise a ticket).

### 255.2 What a shop needs — two levels (`business/readiness.ts`)

- **Ready for review** — what the wizard asks for and a shop must have to
  send itself: its **name**, **what kind of shop** (its type), a **phone**, a
  **branch customers can find** (active, with a map pin and a district —
  without them it is missing from the distance search and the area filter),
  **opening hours** there, and **one service** offered at an open branch.
  Its **logo** and a **payout number** are on the checklist but not required.
- **Able to go live** — what an administrator cannot approve without: a name,
  an open branch with hours, and a service offered there. Approving a shop
  missing its phone or type is an administrator's judgement; approving one no
  customer could book is not. Reinstatement is an approval and is held to the
  same. (The "no name" refusal keeps its words, §53.1.)

One select (`READINESS_SELECT`) and one function decide both, for the shop
(`GET /business/readiness`) and for the administrator (`readiness` on
`GET /admin/businesses/:id`), so the two can never disagree.

### 255.3 Sending for review

- `POST /business/submit` (owner or manager): refused while the shop is not
  ready, naming what is missing in words; refused when already waiting (409),
  live, or suspended (a suspension is talked through on a ticket). Sets
  `submittedAt` and tells every administrator (`BUSINESS_SUBMITTED`, in the
  app and by email).
- **After a rejection** the same call sends the shop **back**: `REJECTED →
  PENDING`, the rejection moved from `statusReason` (which describes the
  current status) to `lastRejectionReason`, which is kept so the next
  reviewer sees what was asked. This is the shop asking, not deciding, so it
  is not in `BUSINESS_STATUS_TRANSITIONS`, the table of what an administrator
  may decide. The rejection email now says to fix what it describes and send
  the shop back from the dashboard.
- **The queue is the shops that asked**: `submitted=true|false` on the
  administrators' list, oldest request first; the Overview's "shops to
  approve" and its "oldest waiting" count from `submittedAt`. A shop that
  signed up and stopped is "setting up", waiting on nobody.
- Migration `20261009120000_shop_onboarding`: the two columns, the
  notification type, and every existing shop with a name marked as having
  asked (under the old rule, signing up was applying); rejected shops keep
  their reason as `lastRejectionReason`. The test factory's complete shops are
  marked as asked too.

Eleven tests in `shop-onboarding.spec.ts`; two existing tests now build a
bookable shop to approve (business-approval, guard-chain); the full suite
(63 suites, 1,378 tests) passes.

## 256. Setting up a shop: four short steps, every one skippable, and where it stands after (2026-10-09)

The business app's half of §255: what a new seller sees after signing up, and
what every seller sees until their shop is live.

### 256.1 The wizard (`/welcome`, `src/onboarding/`)

Asked for: only the vital details, everything skippable, the rest added later
at the seller's own pace. So four short steps and a send-off, one at a time,
full screen outside the app's frame, in the order a seller thinks of it:

1. **Your shop** — name, what kind of shop (the customer app's category
   marks, then its types as chips), phone. Logo optional. A preview shows the
   name and type as customers will see them while they are typed.
2. **Where you are** — the first branch: name (the shop's, by default),
   address with suggestions that drop the pin (`AddressField`), the pin itself
   (`PlaceField`: a Maps link, coordinates or "use my position") and the
   district (`DistrictField`) — the same pieces as the branch panel (§117,
   §195). Opening hours from three common weeks (Monday–Saturday,
   every day, Monday–Friday) and one opening and closing time; split days and
   breaks are for Branches & hours, and the step says so.
3. **Your first service** — name (examples for the shop's type, one press
   each), price, how long (chips), deposit (20/30/50 %, 20 by default, with
   what the customer pays in money). Offered at every open branch.
4. **Getting paid — optional** — a MoMo or Airtel number, its network shown
   as it is typed. "Add it later" is the skip.
5. **Send for review** — the checklist (or one line, "Everything we need is
   in", once it is), the nice-to-haves with a way to each, and Send. Then a
   tick that draws itself and what happens next: we check (usually one working
   day, may call), you get an email, meanwhile add photos and services.

Every step has **Skip for now** (or Add it later) and **Save and continue**;
**Finish later** is always at the top. Each step reads what is saved, so a
step already done shows what it holds (the branch on the map, the service and
its price, the payout number) instead of asking again, and coming back opens
at the first required step still to do (`nextStep`). The rail on the left
(steps, ticks) folds into a "Step 2 of 4" line on narrower screens; on a phone
the main button is full width with Back and Skip beneath it. A live or
suspended shop has nothing to set up and is sent to the Overview; staff are
told the owner or a manager finishes it.

Left out on purpose — all in the app already, and none needed to go live:
description, cover and gallery photos, more branches, service photos and
descriptions, the team, time off, split hours.

### 256.2 Getting there

- Signing in (`auth/LoginPage.tsx`) asks for the shop's readiness once the
  code is right: an owner or manager whose shop is not yet sent and not yet
  ready goes to `/welcome`; everybody else to their day (or where they were
  going). A new account says "Let us set up your shop", and then does.
- `?start=signup` and `?start=signin` (the landing page's buttons, §258)
  change only the sign-in sheet's words ("Start selling. Free to join." /
  "Welcome back."); one email box still serves both and the server still
  decides who is new (§50).

### 256.3 Where the shop stands (`GoLiveCard` on the Overview, the frame)

Until the shop is live, a card at the top of the Overview says what its state
means and what to do, in the seller's words:

- **Setting up**: a ring of what is in (4/6), the checklist with a way into
  the wizard at each missing item, "Continue setting up" — or, once ready,
  only the nice-to-haves and **Send for review** right there.
- **Waiting**: "We are checking your shop", when it was sent, that we may
  call and that an email comes; set up → we check it → customers book, with
  the middle lit; and things to do meanwhile.
- **Sent back**: what we said, quoted, and **Send back for review** (plus
  Edit your shop).
- **Suspended**: why, and Talk to support.
- ~~**Just approved** (in the last week, once, closed for good on this device):
  "You are live!", with a little confetti.~~ *Superseded by §268: approved
  now shows "Post my shop"; "You are live!" follows the shop posting itself.*

The sidebar's card and the shop's state word follow the same words instead
of the raw status ("This business is PENDING"): Finish setting up (n things
left) / Ready to send / Waiting for review / Needs a change / Shop suspended /
Your shop is paused; under the shop's name, Setting up / In review / Needs a
change / Suspended / Paused / Live (`shopStateWord`), also on the shopfront
page. The frame asks for readiness once (`['readiness']`, shared with the
Overview and the wizard).

Tested end to end on a new account: signed up from "Start selling", landed in
the wizard, each step saved through the page, sent for review (the
administrator emailed), rejected with a reason, sent back (emailed again),
approved — at 1440, 1024 and 390 wide.

## 257. The console's side: the queue is the shops that asked (2026-10-09)

The admin console's half of §255 (`apps/admin-web`).

- **Businesses has two kinds of PENDING**, each with its own tab: **Awaiting
  review** (sent for review — the queue, oldest request first, the default
  tab and the one with the hot count) and **Setting up** (signed up, not sent;
  waiting on nobody). Then Approved, Suspended, Rejected, All. The tab is in
  the URL as before (`?status=SETTING_UP`); an old `?status=PENDING` link
  opens the queue, which is what it always meant. `listBusinesses` takes
  `submitted`. A row says "Waiting since" from when the shop asked, "Signed
  up" for one still setting up (no quick Approve/Reject on those), and "Sent
  back after a rejection" on a shop that came back.
- **The frame's count** ("shops to approve", the Waiting button, the sidebar
  badge) counts only shops that asked.
- **The review panel** checks the shop against the same checklist it worked
  through (`readiness` on the detail, §255) in the reviewer's words, plus a
  description as advice and whether the payout number has been checked. What
  approval cannot go without (`goLiveGaps`: a name, an open branch, hours
  there, a service offered there) is marked as a lock, said once at the top
  in what approval needs, and Approve / Approve after all / Reinstate are
  disabled with "Cannot go live yet" — the server would refuse anyway (§255).
  A shop that came back shows **"Sent back after a rejection — last time we
  said …"** (`lastRejectionReason`), so the reviewer can check it was done;
  the identity line says when it was sent for review, or that it has not been.
- **The notice** `BUSINESS_SUBMITTED` has its own mark (a shop) and opens
  Businesses searched for that shop (its name is the first words of the
  notice).

## 258. The landing page's door for sellers (2026-10-09)

`apps/website` had one hero and a "For businesses" link straight to the
business app's sign-in. Now there is a **For businesses** section under the
hero (`#businesses`; the top link and the side rail scroll to it):

- "Get booked while you work." — what the app does for a shop, in one
  sentence; three ticks (deposits to MTN MoMo, fewer no-shows, bookings,
  messages and money in one place); the business app's own Overview with two
  moments floating over it (a new booking; "You are live!").
- **Two doors**: **Start selling — it is free** → the sign-in page with
  `?start=signup`, **Sign in** → `?start=signin` (`businessStart` in
  `links.ts`). The sign-in page only changes its greeting (§256.2); one email
  box still serves both. "Get the app" offers Start selling too. With no
  `VITE_BUSINESS_APP_URL` in a production build the section says sign-ups
  open soon instead of linking nowhere (§239).
- **Live in three steps** — sign up with your email; set up your shop (about
  five minutes, skip anything); we check it, you go live (usually within one
  working day) — so nobody signs up expecting to take bookings the same
  minute, and the approval of §255 is part of the promise, not a surprise.

`apps/website/.env.example` documents the build's settings
(`VITE_API_URL`, `VITE_BUSINESS_APP_URL`, the store and app links).

## 259. The API moves off port 3000, to 4100 (2026-10-09)

Port 3000 is the default of nearly every web dev server (Next.js, Rails,
Express), and another project on this machine took it: while it ran, this
backend could not start there and the three web apps' `/api` proxies reached
the other project instead. The user asked for a port of our own.

- **4100**, everywhere it was 3000: the backend's default (`main.ts`) and
  `.env.example`; the default `APP_BASE_URL` in storage and offers; the `/api`
  (and `/socket.io`) proxy of business-web, admin-web and the website; the
  customer app's default `EXPO_PUBLIC_API_URL`; `scripts/dev.sh` (one
  `BACKEND_PORT` variable now, instead of the number in eight places); the
  READMEs, docs and `ws-smoke-test.js`. Tests are unaffected — the boot test
  listens on port 0. The web apps stay on 5173–5175, the phone app on 8081.
- **Links to uploaded files.** With local-disk storage the full URL, port
  included, is stored on the row at upload (§112.7), so moving the port would
  have broken every earlier image — as a new wifi address already did. New
  `apps/backend/prisma/local-upload-links.sql`, run by `dev.sh` on every start
  with the current address, moves every stored `http(s)://…/uploads/…` link
  (any text column, so new kinds of upload need nothing) to the current
  `APP_BASE_URL`. Development only: R2 links have no `/uploads/` path. Run
  once by hand this time; 95 links (logos, covers, branch and service photos,
  avatars, chat photos) moved to the new port and current address.
- Local `.env` files (not in git) were updated to match: `PORT="4100"` and
  `APP_BASE_URL` in the backend's, `EXPO_PUBLIC_API_URL` in the app's.

## 260. "Live in three steps", told with the app's real screens (2026-10-09)

Asked: any section that shows steps should use real screenshots of the app,
with better animation and a "million-dollar" finish — UI/UX is the measure.
The first is the landing page's "Live in three steps" (§258), three plain
cards until now. It is now its own section (`apps/website/src/Tour.tsx`):

- **Real screens, per device.** Each step shows the screen a seller meets at
  that moment, captured from the business app: the sign-up's code boxes, the
  setup wizard's first step filled in, the Overview's "You are live!" the
  moment a shop is approved. Captured at 1440×900 and 390×844, so a computer
  shows the computer's screens in a browser window and a phone shows the
  phone's in a phone frame (`<picture>`, with 2× versions for sharp screens;
  `public/shots/steps/`). Captured from a temporary shop, removed afterwards.
  The sign-in wall's photos were captured without five demo services' images
  — among them a celebrity's photo, a "Company — tagline goes here"
  placeholder, a stock photo carrying another brand's name and a forex chart
  under a barbershop — none of which belongs on a public page (they remain in the demo data and
  on the real sign-in wall until replaced there).
- **A short film, not a carousel.** The steps sit on the left; the lit one
  opens its words and fills a line over 6.5 s, then the next lights. The
  screen cross-fades to that step's screenshot, eases in towards the part
  that matters, and dims everything else around an orange ring (the code
  boxes; how customers see you; the "You are live!" card). A note floats in
  beside it ("Code sent — six digits, no password, ever"; "About five
  minutes — skip anything"; "Approved — usually within one working day").
  The line, the zoom and the ring share one switch: paused while the section
  is off screen or under the mouse, so nothing plays unseen. A press on any
  step jumps there. "Start selling" closes the column.
- **On a phone** the steps become story bars over the phone, the step's words
  sit under it, and the phone can be swiped.
- **Reduced motion**: plain tabs — no timer, no zoom, the ring shown at once.
- The window is flat: a tilted 3D frame was tried and made the real screens
  soft, and their being readable is the point.

## 261. Room under the top bar (2026-10-09)

The user found the top of the business app's pages cramped: on a computer the
page title sat about 22px under the dark top bar (18px of page padding, §237),
with a 40px title — the heading read as stuck to the bar.

- **Above the page**: `clamp(32px, 2.6vw, 44px)` instead of 18px on screens
  860px and wider — about the title's own height, growing with the screen
  (≈37px on a 1024 tablet, ≈44px on a 1284 laptop, up to 48px). One rule for
  every page, so titles start at the same distance below the bar everywhere.
  It is space above the page, not in its header, so it scrolls away and the
  pinned header costs no extra height (§237 still holds).
- **Pinned**: the header keeps 14px of glass above its title instead of 6px
  (taken from that room, so nothing moves at the top of the page), so a
  pinned title never touches the bar either. The pinned row of a tall header
  (`.pin-from`) does not move: its fold is measured from the header's own top
  (Layout).
- **Heading to first card** on Overview, How it is going, Shopfront, Getting
  paid and Help: 32px instead of 28px.
- Phones unchanged: their light top bar already leaves room.

## 262. Setting up a shop, redrawn: a panel over the shops' own photos (2026-10-09)

Asked: make the onboarding wizard far better than a plain form — moving
images behind, the wizard floating over them with the background a little
blurred; the containers held in place on the screen with only their content
scrolling; high-quality icons; "a million-dollar deal". The steps and rules of
§256 are unchanged; this is how they are drawn (`src/onboarding/`).

- **Behind**: the sign-in's photo wall (`AuthWall`, §238 — real service
  photos, gliding columns, never one photo twice), softened (2px blur) and
  dimmed under a coral-to-night shade with a little grain; it leans away
  from the mouse. Two glass "moments" (a MoMo deposit, a new booking) drift
  beside the panel on screens wide enough (≥1640px).
- **The panel**: fixed in the middle of the screen (`position: fixed`, the
  page itself never scrolls), white, in a frame of frosted glass, rising in
  on a spring. Left, the rail: the shop's name as it is saved, a progress
  card ("3 of 6 done", a filling bar with a sheen), the steps as badges with
  the wizard's own duotone icons (`StepIcons.tsx`: line over a soft fill,
  drawn for it), a pulsing ring on the current one, a tick that draws itself
  on each one done, dashed threads that turn green behind; a dark "Need a
  hand? Talk to us" card and the reminder that customers see nothing until
  approval. Right, the step: a head that stays (its icon, "Step 2 of 4",
  title, one line), a middle that scrolls (with shadows that appear only
  while there is more above or below), a foot that stays (Back · Skip ·
  Save and continue, which carries a slow light sweep when it is ready).
  Steps slide in from the right going forward and from the left going back.
- **Better controls**: inputs with their meaning drawn at the start; category
  tiles with a tick badge; opening hours as three common weeks *and* seven
  day toggles, the times side by side and the result in a sentence ("Open
  Monday to Saturday, 08:00–18:00"); the deposit as a bar splitting the price
  into what the customer pays on their phone and what is paid at the shop;
  getting paid as three cards (deposit → we hold it → your share is sent);
  the last step as a grid of what is in and what is not, each a way back.
- **Sent**: rings, a burst of confetti, a tick that draws itself, and three
  cards for what happens next.
- **Phone**: the photos are a band at the top with the brand and "Finish
  later"; the panel is a sheet rising over them (higher while typing), with
  four step bars in place of the rail and the main button full width.
- Short windows (≤860px tall) tighten the rail and the head so all of it
  fits a 1024×768 screen; reduced motion stops the photos and the effects
  (the app-wide rule).

## 263. One question to a screen, and the kinds of shop drawn (2026-10-09)

Asked, with a reference (a "for Business" setup with fine-line drawings for
each kind of service): draw the categories like that, in our own context;
make each step clear and uncrowded; make the fields easy to notice; keep it
clean. The panel, photos and rail of §262 stay; what is inside changes.

- **One question to a screen.** The four parts are asked as ten short
  screens (`SCREENS` in `steps.ts`): your shop — its name; what kind;
  which kind exactly; how to reach you (phone, logo optional) · where you
  are — the address; the hours · your first service — what it is and how
  long; what it costs and the deposit · getting paid (optional) · send for
  review. Each screen is one question as the title ("What's your shop
  called?", "When are you open?", "How much is gel nails?"), one line under
  it, the answer, and the way on. Answers saved together (the kind and its
  type; a service and its price) are carried between their two screens and
  saved on the second. The head says the part and "2 of 4" with small dots;
  the rail still shows the four parts. "Skip for now" jumps past questions
  that need the skipped answer (`SKIP_TO`); coming back opens on the first
  question still unanswered (`nextStep`); the Overview's checklist and the
  last step link to the question for each item.
- **Big, plain answer boxes**: 62px, 18px text (22px for money and the
  payout number), a firm border and a soft orange ring when in use, the
  meaning drawn at the start; everything in one centred column.
- **The kinds of shop, drawn** (`LineArt.tsx`): eight fine-line drawings in
  one ink line over a soft brush mark of the category's colour — a car with
  the air still moving behind it; scissors, a comb and a little shine; two
  glasses meeting in confetti; a heartbeat that grows into a sprout; a house
  and a wrench; a sitting cat; a camera with a flash; a laptop with a rising
  line and a coffee — plus a shopfront for any kind not drawn yet. All on
  one 200×100 sheet standing on one ground line, so the grid reads as a
  set. The brush mark settles and the line draws itself, card after card.
  Each card names the kind and a few of its types; the chosen one gets a
  ring and a tick. The next screen carries the chosen drawing with
  "Change", and the types as large radio options.
- **The address** shows the found place on a still map with "On the map —
  customers nearby will find you here" and "Move the pin"; pasting a map
  link or using where you are is one link away; the district appears once
  there is a place; the branch takes the shop's name unless renamed.
- **Hours**: the three common weeks as cards with their times, then the day
  toggles, the times and the sentence (§262); a week is "chosen" only while
  both its days and times still match.

## 264. One set of drawings for categories, in every app (2026-10-09)

Asked: use the fine-line drawings of §263 wherever categories are shown — the
customer app, the business app and the console — instead of icons.

- **One set, as data**: `src/ui/lineArtData.ts` holds each drawing as path
  data (`DRAWINGS`, keyed on the category's `icon` word, plus the shared
  brush mark), identical in business-web, admin-web and customer-app — copied,
  as the apps' other shared pieces are; change one, change all three. The web
  apps draw it with `<svg>` (`LineArt`), the phone app with react-native-svg
  (added: 15.15.4, the version Expo 57 ships in Expo Go).
- **Customer app**:
  - the home screen's category row is a row of small cards with the drawing
    and the name under it ("All" keeps its grid mark), the chosen one ringed
    in orange with a tick;
  - the "Browse all categories" wall is white cards — name, places and
    kinds on top, the drawing standing on the bottom edge, tall cards also
    naming what they cover — instead of colour tiles with a large icon;
  - a shop or service with no photo shows its category's drawing on a tint
    of the category's colour wherever the picture is 120px or wider; smaller
    thumbnails keep the icon, where a drawing could not be read.
  On a phone the line draws itself in; in a browser preview, and with
  reduce motion, it is simply shown.
- **Business app**: setting up already used them (§263); the shopfront
  preview's empty cover now matches the customer app's. The category cards
  in setting up now fit three or four to a row by the room there is, and
  their words no longer squeeze into a narrow column. The old icon mark
  (`ui/CategoryMark.tsx`) is gone.
- **Console**: Categories shows each category's drawing on its card; adding
  or editing one picks "its drawing" from the eight, by what they show (Car,
  Scissors and comb, Glasses and confetti, Heartbeat and sprout, House and
  wrench, Cat, Camera, Laptop and coffee), with a preview of the card a
  customer will see.
- Kept as icons on purpose: the tiny marks where a drawing cannot be read
  (a section title's dot, search shortcuts, service thumbnails), and the
  dark advert banners' faint motif. The landing page has no categories yet.

## 265. A shop can be more than one kind of place (2026-10-10)

Asked: let sellers choose more than one category, since a business may run
different kinds of place at different branches; and make a chosen day in the
hours picker readable when hovered.

- **Kinds**: new table `business_kinds` — one row per type a business offers
  (`subcategoryId`, its `categoryId` copied for lookups, `position`). The
  first (`position` 0) is the MAIN kind, and stays mirrored on
  `BusinessProfile.categoryId / subcategoryId`, so everything that shows "the"
  kind (cards, pictures, wording, readiness, the admin row) is unchanged.
  Migration `…_business_kinds` gives every shop that had a type that one
  kind.
- **Limits**: up to 4 categories (and 8 types) per shop — a few kinds of
  place, not every kind; the busiest booking apps cap it the same way. A type
  no longer offered may be kept by a shop that has it (retiring a type never
  takes it away, §98) but not newly chosen.
- **API**: `PUT /business/kinds { subcategoryIds }` (owner or manager)
  replaces the list, first = main. `PATCH /business/profile` with a category
  and type still works and keeps the list in step (the new main first, the
  old main gone, the others kept). `kinds` is on the profile, discovery's
  business, the shopfront, saved services and the admin business.
- **Discovery** finds a shop under ANY of its kinds — by category or by type
  (and still by the main columns, for a shop that chose a category but no
  type). Known limit: services carry no kind of their own, so filtering by
  "Health & Wellness" shows a salon-and-spa's every service, not only its
  massages. A per-service kind is the next step if that matters.
- **Setting up**: "What kind of shop is it?" takes up to four (the first
  chosen marked Main; the rest dimmed once four are chosen); "Which describe
  it best?" asks for at least one type in each, with "Make it the main one"
  on the others. **Shopfront page**: the kinds as a list — drawing, type,
  category, Main or "Make main", remove — with category-then-type to add
  another; Save sends only what changed.
- **Customer app**: a place counts in each of its categories on the
  categories wall; a shop's page shows every kind as a pill, the main one in
  colour. **Console**: a row reads "Beauty · Nail Salon + 2 more"; the review
  panel lists them all; a category's shop count counts each shop once,
  however many of its types it lists, and a type's count is its kinds.
- **Hover**: the app-wide button hover (styles.css, loaded after the page's
  own CSS) turned a chosen day grey under its white word. Each control in
  setting up now keeps its own hover at a weight that wins — the chosen day
  goes a deeper orange — and the same fixes "Finish later" on the photos,
  chosen chips, and the chosen card's border.

Seven tests in `business-kinds.spec.ts`.

## 266. Every kind of book-and-go place, with a drawing for each (2026-10-10)

Asked: put in the complete taxonomy now — the user's sheet (Beauty & Spa,
Wellness, Dining, Events tickets & Movies, Group Classes & Activities,
Services) and the kinds suggested here (dining, fitness, tutoring, clinics,
hotels, tailoring, tours) — everything a customer books and then goes to in
person, nothing delivered; administrators only switch off what is not wanted
at launch. And start the console's drawing picker on a neutral drawing, with
drawings for the new kinds.

- **16 categories, 122 types** (`prisma/seed.ts`), each ending with "Other":
  Automotive · Beauty & Spa · Dining (Dine-in, Pick-up, Private Dining) ·
  Event Services · Events, Tickets & Movies · Fashion & Tailoring · Fitness &
  Sports · Group Classes & Activities · Health & Medical · Home Services ·
  Hotels & Stays · Pet Services · Photography & Creative Services · Services ·
  Tours & Experiences · Wellness. The user's names are used as given; their
  "Other services" is "Other" like every other category.
- **Renamed and regrouped, not duplicated** (migration `…_taxonomy_v2`,
  keyed on the old names and a no-op on a fresh database): Beauty & Personal
  Care → Beauty & Spa (Hair Salon → Hair, Nail Salon → Nails, Makeup Artist →
  Make-up, Skincare & Facials → Facials); Health & Wellness → Wellness
  (Nutrition Coaching → Diet & Nutrition, Yoga & Pilates → Meditation & Yoga,
  Mental Wellness Coaching → Therapy); Massage Therapy moves to Beauty & Spa as
  Massage, and Personal Training to Services, as the user's sheet places them;
  Events → Event Services (planners, DJs, venues for your own event — "Events,
  Tickets & Movies" is going to one); Professional & Consulting → Services
  (Tutoring & Training → Tutoring). Every business's main category and kinds
  follow their type. The demo tailor, filed under carpentry for want of
  anything better, is now Fashion & Tailoring.
- **Scope**: medical and dental are in (§1 marked); catering and delivery stay
  out — Dining is dine-in or pick-up, and the seed says so.
- **"Other" last**: types are listed alphabetically with "Other" at the end
  (`categories/other-last.ts`, public and admin lists); the short summaries on
  cards leave it out.
- **Drawings**: eight more in the same hand (`lineArtData.ts`, identical in the
  three apps): plate and cutlery, ticket and popcorn, a group arms up,
  dumbbell and ball, cross and stethoscope, bed and moon, mountains and flag,
  shirt and tape measure — with their colours in the customer app, the
  console and the shopfront preview. The console's picker offers all 17 by
  what they show, a **new category starts on "General shop"** (a shopfront)
  rather than borrowing another kind's drawing, and an unknown `icon` still
  falls back to it. The console's old icon mark and its glyph file are gone.
- Setting up's "What can customers book first?" suggests services for the new
  types (a table for two, a day pass, a pitch for an hour, an eye test…).
- A new category or type added in the console appears in every app at once
  (the lists come from the server); a new DRAWING needs an app release.

## 267. "Other" — the shop writes what it is (2026-10-10)

Asked: when a shop picks "Other", what happens — can it type what it is in a
box that appears, and is there any harm in that, as long as it sits under one
of our categories? No harm, with three guards: it stays inside a category
(so it is still found and counted there), an administrator sees it, and a
common write-in can be turned into a real type.

- **The box**: picking a category's "Other" — in setting up's "Which describe
  it best?" or the Shopfront page's kinds — opens "What kind exactly?" (up to
  40 characters, an example to suit the category). Next and Save wait until
  it is filled. Stored on the kind (`business_kinds.otherLabel`), tidied of
  extra spaces; the server refuses one on a type that already has a name.
  `PUT /business/kinds` takes `otherLabels: [{ subcategoryId, label }]`.
- **Shown instead of "Other"** wherever a kind is named — the shop's pills
  and the booking screen in the customer app, the shopfront preview, the
  console's rows (in quotes) and its review panel ("written in under Beauty
  & Spa · Other"). A bare "Other" with nothing written is never shown as a
  pill.
- **Search** finds a shop by what it wrote, and now also by the name of any
  of its types (before, only its main ones).
- **Watched**: a shop still setting up is checked at review, where the
  write-in is in plain sight. A LIVE shop that writes in a new one or changes
  it sends administrators a notice ("A live shop wrote in what it is" — it is
  already showing to customers), which opens the shop.
- **Made a type**: the console's Categories page lists "Written in under
  Other" — each write-in once per category, whatever its capitals, with how
  many shops and which — and "Make it a type" names the new type (the
  write-in to start with), creates it (or uses the one already there, any
  capitals; never one called "Other"), and moves those shops' "Other" into
  it, main kind and all. A shop that already had that type simply loses the
  "Other". The write-in then leaves the list.

Five tests in `business-kinds.spec.ts`.

## 268. Approved is not posted: the shop posts itself, and setting up says what is ahead (2026-10-10)

Asked: (1) the two cards floating beside setting up — "Deposit paid · RWF
1,400 · MTN MoMo" and "New booking · Haircut · Saturday 10:30" — read as real
notices to someone whose shop does not exist yet; (2) does an approved shop
simply appear in the customer app? If so that is wrong: the seller should
press "post" themselves, with a confirmation.

It did appear: approval made a shop public at once (§42, §255), and a seller
learned they were live from their first booking. Now approval says a shop
**may** be listed, and the shop **posts** itself when it is ready.

- **The rule**: a shop is public when it is approved, **posted**, and not
  paused. `business_profiles.publishedAt` — set once, by the shop, never
  cleared; after that, hiding is a pause (the shop's, §119.3) or a suspension
  (ours). `isPubliclyBookable` takes it (required, like `pausedAt`) and
  `PUBLIC_BUSINESS` is the same rule as a `where`, used by search (all four
  of its filters), the shop page, booking, saving a place or service, and the
  console's "live shops" and "live branches" counts. The unused `TRADING`
  fragment, which checked only the pause, is gone.
- **Nobody disappears**: the migration (`…_shop_posts_itself`) marks every shop
  approved now — or suspended, having been approved before — as posted on the
  day of its last status change. A reinstated shop comes back as it was,
  without posting again. The demo seed posts its approved shops; the test
  factory's approved and suspended shops are posted.
- **`POST /business/publish`** (owner or manager, like sending for review):
  refused before approval ("We will email you as soon as it is"), while
  suspended, a second time (409), and when the shop has lost what approval
  needed since — its service, its hours (`goLiveGaps`) — which would post a
  listing nobody could book. A pause set before posting is lifted: posting
  means "show it". Readiness gains `publishedAt` and `canPublish`.
- **The business app**: the Overview's card has a new state — "Approved · not
  posted yet — Your shop is approved. Post it when you are ready", with **See
  it as customers will** (the Shopfront page) and **Post my shop**, which
  asks first: "Post *name* for customers? From now on customers can find it…
  Need a break later? Pause it on your Shopfront page." (Post my shop / Not
  yet). Anything lost since approval is named with a way to it. The track is
  now four stops: set up · we check it · **you post it** · customers book. The
  Shopfront page shows the same choice in place of the pause until it is
  posted. "You are live!" (with the confetti) now follows the posting. The
  sidebar says "Approved — post it", the state word "Not posted", the
  approval notice opens the Overview, and its email and in-app words say
  customers cannot see it yet.
- **Setting up** says it from the start: "Customers see nothing until we
  approve your shop and you post it"; the last step is "We check it, you
  post it"; what happens next adds "You post your shop — one button on your
  dashboard". The review screen's title is "Ready to send" (it was "Ready to
  go live", which it is not).
- **The floating cards** say what is ahead, never a notice: "Deposits by MoMo
  · Paid when they book" and "Bookings land here · Once your shop is posted".
  The sign-in wall's rotating "seller's day" is unchanged — it is seen before
  there is any shop, as a picture of the app.
- **The console**: an approved shop not yet posted is "Approved · not posted"
  (green, outlined only), and its panel says it was approved on that day and
  customers cannot see it yet. **Landing page**: the third step is "We check
  it, you post it".

Six tests in `shop-posting.spec.ts`; the approval test that booked straight
after approval now posts first. The full suite (65 suites, 1,396 tests) passes.

## 269. Saved, and seen to be: drafts that say so, and changes that are not lost (2026-10-10)

Asked: if a seller does not post straight away, does their work wait as a
draft — and if so, show the seller editing a service that their changes are
being saved, or give them a "save to drafts".

It does wait: an approved shop that is not posted (§268) keeps everything,
and nobody sees any of it until it is posted. A new service already saved
itself as a draft while it was written (§123) — but silently, so nothing told
the seller. And a service that already existed lost its changes, without a
word, when its panel was closed before "Save changes".

- **A new service says where it stands**, under the panel's title: "Saved as
  a draft while you type" before anything is typed, then "Saving draft…",
  then "Draft saved · 14:32". A failed save is still never an error box
  mid-sentence (§123), but it is no longer silent: "Not saved — trying
  again", and it tries again by itself every five seconds.
- **"Save as draft"** takes the place of "Close": it saves what is waiting at
  once (not in a moment), closes the panel, and the draft lights up under
  **Drafts** (was "Unfinished") as "Saved just now". Closing any other way
  saves what is waiting first too; if that fails, it asks before closing. A
  panel opened and never typed in leaves no empty "Untitled service" behind
  — the draft started for it is thrown away.
- **Drafts** says what they are: "Saved as you typed — customers never see a
  draft".
- **A service that exists** is still saved only by "Save changes" — typing
  into a live service must not change it under customers mid-word. The title
  line says "All changes saved", then "Unsaved changes" once anything differs
  from what is saved (back to the start, and it is clean again); "Saving…"
  while it goes. Leaving with unsaved changes — ✕, Escape, the backdrop or
  Cancel — asks "Leave without saving?" (Keep editing / Leave without
  saving). Its photos still save straight away, and say so.
- **Before the shop is live**, the new-service button says "Add this
  service", not "Post this service", and the note under it says when
  customers will see it: "Ready at 1 branch — customers see it once you post
  your shop" (or once it is live, or open again after a pause).
- The "approved, not posted" cards (§268) add: "No rush: everything you
  change is saved as you go."

Front end only; no server change. Tried in the app: a new service saved as
it was typed, "Save as draft" into Drafts, an edited service marked unsaved
and the question on leaving — at 1440 and 390 wide.

## 270. The page sits in the middle, whatever is folded (2026-10-10)

Asked: with the sidebar and "For you" both folded, a big gap was left on the
right — keep the page balanced in the middle, always.

The page has a widest size (1440px, §204), and it sat at the LEFT of the room
between the side columns: on a wide screen with both folded (e.g. 1920 wide:
98 + 82 of rails, 1740 of room) 300px piled up on the right, next to "For
you".

- **Centred**: the page (`.content`) takes the room it is given up to that
  widest size and is centred in it, so any room left over is shared on both
  sides. The widest size is one value on the frame (`--page-max`).
- **The top bar** still runs edge to edge between the side columns — it is
  the frame, not the page — but its padding grows with the spare room, so the
  breadcrumbs and the account button line up with the page's two edges
  instead of sitting far outside them.
- Nothing changes until the room is wider than the page can grow — every
  laptop with the sidebar open, and every screen with "For you" open — nor on
  a phone, whose own padding still wins.
- **Both** the business app and the admin console, which share the frame
  (§242). Tried at 1920 wide with everything folded in each.

## 271. A shop's words, formatted: the way professional editors do it, the way sellers already type (2026-10-10)

Asked: a better way to format what is written in descriptions and, above
all, special instructions — the tools professional apps use.

They were plain boxes: a seller's list was a wall of lines, and customers saw
it as typed. Now the shop's words have formatting a phone shows well, in a
proper editor, read the same in every app.

- **The editor**: **Tiptap** (3.31.3, on ProseMirror) — the editor much of
  the web's writing tools are built on — in the business app for a service's
  description and special instructions and the shop's own description ("What
  you do"). A bar inside the box: **bold**, *italic*, bulleted list, numbered
  list, with the count beside them. Nothing more on purpose: no headings,
  colours, sizes or links — they do not read well on a phone, and a link from
  a shop to a customer is a door to scams.
- **Typed the way sellers already type** — WhatsApp's marks: `*bold*`,
  `_italic_`; a line starting `- ` or `1. ` becomes a list; ⌘B / ⌘I too.
  Tab still moves to the next field (lists are one level). **Pasting** a
  WhatsApp message or a note keeps its lists and marks; pasting from a web
  page or a document keeps only bold, italic and lists.
- **Stored as plain text with those marks**, never HTML (`lib/richText.ts`):
  everything written before still reads exactly as it did (a stray `*` or a
  `snake_case` word stays as typed), any app can draw it, and nothing a shop
  types can become markup. What the editor writes is always tidy — no empty
  paragraphs, no runs of spaces, every mark the one way; italic on part of a
  word, which "_" cannot express, is dropped rather than stored as stray
  underscores. One copy of the rules in each app (business-web, admin-web,
  customer-app), identical — check with `cmp`, like the line drawings.
- **Read formatted everywhere**: the customer app (About this service — four
  lines with a soft fade, then "Read more" only when there is more; Before
  you come, on the service and on the reservation; the shop's description),
  with the app's own italic faces now loaded (Plus Jakarta Sans 400/500/700
  italic); the business app's shopfront preview; the console's review panel.
  Cards that show two lines of a description show its words without marks.
- **Limits** are counted on the stored text, as the server counts them
  (2000 / 600 / 2000). The box cannot stop typing at the limit as a plain one
  did, so it turns red with the count, and Save says what to shorten.
- **Size**: the editor is about 400 kB, loaded only when a page shows one of
  these boxes (`ui/RichTextBox.tsx`); every other page grows by 4 kB.
- A page's own `em` (the forms' small grey counters) no longer reaches the
  shop's italic words.

The rules were tried on 31 cases (marks, escapes, lists, old plain text, the
editor's document in and out); the editor typed into for real, a WhatsApp
message pasted, and the result read in the customer app, the preview and the
console — at 1440 and 390 wide.

### 271.1 Words that flickered on a phone

Reported: on a phone, a service's description and "before you come"
blinked and jumped up and down.

"Read more" measured the description INSIDE its shortened four-line box. A
browser measures text at its full height there; a phone measures it at the
height of the box it is in. So on a phone: shortened → "it fits, nothing
more" → opened → "there is more" → shortened … for as long as the screen was
open, with "Read more" and the fade blinking and everything below — "before
you come" — pushed up and down with it. The web preview never showed it.

The words are now measured positioned over a box of the height to show (not
inside it), so nothing ever holds them in while they are measured and the
answer cannot change with the box. Every collapsible `RichText` in the
customer app takes it; the rest of a page cannot be moved by it.

## 272. `npm run dev` gets itself past an unclean shutdown (2026-10-12)

Reported: `npm run dev` stopped at "Colima would not start", every time.

The Mac had shut down with Colima running, which left Colima's disk marked
"in use by colima" (`~/.colima/_lima/_disks/colima/in_use_by`) with nothing
using it, and every start then failed at once — but `dev.sh` hid Colima's
own words, so all it could say was that it would not start.

`dev.sh` now does what fixed it by hand: if Colima will not start, a forced
stop (it removes lock, pid and socket files only — the database's disk is
untouched; the data was all still there), then one more start; and if that
fails too, it shows the last lines of what Colima said instead of hiding
them.

## 273. The landing page, finished to the picture: four reasons, what can be booked, the foot, the share picture (2026-10-12)

The rest of §239's list, in the order of the user's picture (the XTRA page,
now kept outside the repo with the other references): four feature columns
under the big number, a dark slanted section with a grid, then — after the
business sections (§258, §260) — a footer, and the picture a shared link shows.

- **Four reasons** (`Features.tsx`), the picture's columns: a fine orange line
  drawing, a bold two-line title, a few plain grey words — *Real places,
  checked by us* · *Book in under a minute* · *A small deposit holds your
  time* · *Your code, not a queue*. Every claim is the apps' real rule: shops
  are checked before they are listed (§255); the deposit is part of the price
  and comes back in full **only when the shop cancels** — a customer who
  cancels does not get it back, so the page never says otherwise; the
  reminder comes the day before. The drawings draw themselves in, one after
  another, the first time the row is seen; the words follow.
- **What can be booked** (`Places.tsx`), the picture's dark "132 Ready to
  Import" section: the stacked-layers mark, "**24** services ready to
  **book** today." — counted by the server (`GET /discover/services`) — and
  "Find a place -> Pick a free time -> Show your code at the door." Six real
  services on photo cards: the shop's kind, its rating, a sale, the name, the
  shop and district, the price and what it takes to book. Cards with a photo
  come first, one card per service (a shop's "Haircut" at two branches is
  one), shops taking turns so the grid shows the range. A card opens that
  service in the customer app once `VITE_CUSTOMER_APP_URL` is set, and "Get
  the app" until then. The cream paper above ends in the picture's slant —
  down to the right, a rounded corner, steeply back up — drawn in pixels like
  the hero's paper, with a paler band behind. Left out if the server cannot
  be reached. On a phone the cards slide sideways.
- **The foot** (`Footer.tsx`), on cream after the dark steps card: the mark,
  one line of what this is, "Made for Rwanda"; for customers, for businesses,
  and **the three published documents read in a window right there** (`GET
  /legal/:kind`, open to anyone, §122; plain text, headings in capitals,
  never HTML); ~~contact details only when the build names them
  (`VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`)~~ — the phone is shown by
  default since §274; the email still only when set.
- **The share picture** (`public/og.jpg`, 1200×630) made from the real app
  screens (`og-image/og.html` remakes it), with Open Graph and X tags. Its
  address must be a full one for WhatsApp and Facebook to show it:
  `VITE_SITE_URL` fills it in at build time (`vite.config.ts`); development
  falls back to "/og.jpg". The page's description no longer explains the
  name (§240).
- Two small helpers learned to wait for a section that appears only after its
  data (`useInView`, `useSize` take `ready`): measured before it existed, the
  dark section had neither its slant nor its cards.

Checked at 1440, 1024 and 390 wide; the document window opened from the
footer. The published Terms and Privacy Policy still hold their blanks —
[COMPANY LEGAL NAME], [PLATFORM NAME], [PHYSICAL ADDRESS IN RWANDA] — and the
Seller Agreement is a placeholder; anyone can now read them on the landing
page, so they need filling in before launch.

## 274. The company's name and phone, filled in (2026-10-12)

The user: use **BwanguReservations** as the company name, and **0798972441**
as the phone.

- **Terms of Use and Privacy Policy** (`prisma/legal/*.txt`): every
  `[COMPANY LEGAL NAME]` and `[PLATFORM NAME]` is now BwanguReservations;
  the telephone and the after-sales/support line are **+250 798 972 441**
  (the number in its international form, as the documents and a `tel:` link
  need it); "Last updated" is 12 October 2026. Published through
  `npm run legal:publish` — the same path as the console, so these are new
  versions (locally Terms v7, Privacy v5; the first run left the old date, so
  it ran twice) and everyone is asked to accept them, with the note "We added
  our company name, BwanguReservations, and our phone number, +250 798 972
  441. Nothing else has changed."
- **Still blank, waiting on facts only the company has**: the support and
  privacy email, the physical address, the RDB company code and place of
  registration, the consumer-complaints officer (name, mobile, email), the
  data-protection officer, the RICA licence and NCSA certificate numbers,
  where data is stored, and the names of the hosting, email, address-search
  and route-finding providers. The publish script refuses to publish to
  production while any blank is left. The Seller Agreement is still a stub.
- **The landing page's footer** shows "Talk to us: +250 798 972 441" (a
  `tel:` link) by default; `VITE_CONTACT_PHONE` can change it.


## 275. The address, the email, and a Seller Agreement written for Rwanda (2026-10-12)

The user: the email is jokditakeerleek@gmail.com; the company is in
downtown Kigali; write the Seller Agreement, researched for Rwanda.

- **Terms and Privacy Policy**: every support, privacy, complaints and
  data-protection email is jokditakeerleek@gmail.com; the address is
  "Downtown Kigali, Nyarugenge District, City of Kigali, Rwanda" (downtown
  Kigali is in Nyarugenge); the complaints officer's mobile is the support
  line. Still blank: the two officers' names, the RDB company code and place
  of registration, the RICA and NCSA numbers, where data is stored, and the
  providers (hosting, email, address search, routes).
- **The Seller Agreement** (`prisma/legal/seller-agreement.txt`, ~3,800
  words, 18 sections, the Terms' style), built on the official text of **Law
  n° 011/2026** (competition and consumer protection, Official Gazette of
  04/03/2026), read from the gazette itself, articles 41–48 on e-commerce:
  selling a service through an app is e-commerce (41); the business's
  identity, full prices, refund terms and complaints within 72 hours / 15
  days, proof of purchase, no false reviews or endorsements (42); an
  intermediary carries those duties for a seller with no online shop of its
  own (43) — so the agreement makes the seller answerable for the truth of
  what it gives us (45); a licence from RICA where its regulations require
  one (44); the intermediary removes unlawful content as soon as reasonably
  practicable and may stop serving the seller (46); refund, repair or
  replacement and the 7-day withdrawal, refunds within 15 days (47); 30
  days' public notice before closing (48). Also Law n° 058/2021 (personal
  data: use only for the booking, NCSA registration where required, report
  breaches), Law n° 18/2010 (agreeing in the app binds as a signature), RRA
  (own taxes; EBM receipts where the law requires; our confirmation is not
  the seller's tax receipt), and sector licences (RDB, health, tourism,
  Rwanda FDA).
- **The platform's real rules, as the code has them**: deposit percentage
  per service, never below the fee; fee 10% of the price unless the app says
  otherwise, fixed at booking; share is the deposit less the fee, earned when
  done, no-show or customer-cancelled; held 2 days then paid daily to a
  checked MTN or Airtel number (a change pauses payouts); seller cancels →
  whole deposit back including the fee, the refund's mobile money charge the
  seller's; negative balances netted from later earnings; 5-minute hold;
  arrival codes (5 tries; code-less check-in by owner/manager, recorded,
  admins told); automatic done/no-show after 24 hours; reviews only after a
  done booking, one reply editable 7 days; ranking by bookings weighted by
  rating; a shop cannot start a conversation; approval then "Post my shop"
  (§268); pause any time. We pay the charge for sending payouts (nothing is
  deducted from a payout today).
- **Choices made in it, for the company to confirm** (none is in the code
  yet): 30 days' notice before a fee rise or a change against sellers; a
  balance below zero for 60 days may be asked for, payable in 14 days; 60
  days to query a payout; 3 days to give the seller's side of a complaint;
  liability capped at 12 months of fees (except what the law forbids
  capping); a licence to show and promote the seller's name, logo and
  photos; no paid ranking (and paid placements, if ever, marked); a
  disagreement answered in 15 days, then mediation or the courts in Kigali.
- **Deposits are received "on the seller's behalf"** (the platform as the
  seller's agent for collecting deposits only), the usual marketplace
  structure; whether that collection needs a payment-service licence under
  BNR Regulation n° 74/2023 is for a Rwandan lawyer to confirm.
- Published with the Terms and Privacy Policy (`legal:publish`, which now
  includes the Seller Agreement): locally Terms v8, Privacy v6, Seller
  Agreement v3; sellers are asked to accept it before listing (§126.4). The
  landing page's footer shows the email and phone by default.

## 276. Social pages in the footer (2026-10-13)

Asked: LinkedIn, Facebook, Instagram and TikTok icons.

- In the landing page's footer, under "Made for Rwanda": four round white
  buttons with each network's own mark (`SocialIcon.tsx`, shapes from Simple
  Icons) ~~in one colour, turning to the network's colour on hover~~ — **in
  their real colours, always** (the user asked): LinkedIn #0A66C2, Facebook
  #0866FF, Instagram's gradient (yellow, orange, pink, purple, blue), TikTok's
  black note with its cyan #25F4EE and red #FE2C55 edges. On hover a button
  lifts, ringed in its network's colour.
- The links come from the build (`VITE_LINKEDIN_URL`, `VITE_FACEBOOK_URL`,
  `VITE_INSTAGRAM_URL`, `VITE_TIKTOK_URL`). No account was given yet, so none
  is guessed: an icon without a link says "coming soon" and links nowhere —
  a wrong account is worse than none.
- "Talk to us" takes two columns' room, so the email stays on one line.

## 277. Who sees what: the owner, managers and staff, by branch (2026-10-14)

Asked: the main user (the owner) sees everything; the others should be given
one branch, or two, three, more or all — the owner decides — and should not see
the rest.

Access is now two things, not one. The **role** says *what* someone may do
(§14.2, §16.6). The **branches** say *where*.

### 277.1 Where: every branch, or the ones chosen

- `BusinessMembership.allLocations` (default true) and `MembershipLocation`
  rows (membership × branch). Invitations carry the same choice
  (`allLocations`, `locationIds`) and accepting copies it — only branches that
  are still the business's.
- **The owner always has every branch**, whatever the columns say.
- **"Every branch" includes ones opened later.** A list would leave a new
  branch with nobody on it.
- **Everyone who was already a member kept every branch** — the default — so
  nobody lost access when this arrived.
- Changed by the owner only (`PATCH /business/members/:id/branches`), never for
  the owner, only to the business's own open branches, at least one. It takes
  effect on the next request: roles and branches are read from the database
  every time (§14.2), so nobody signs in again.

### 277.2 What each person can do

| | Owner | Manager, every branch | Manager, some branches | Staff |
|---|---|---|---|---|
| See bookings, messages, reviews, branches, hours | all | all | theirs | theirs |
| Check in, finish, no-show; reply to messages and reviews | yes | yes | theirs | theirs |
| **Cancel a booking** (refunds the customer) | yes | yes | theirs | **no** |
| Hours, closures, breaks, branch photos, branch details | yes | yes | theirs | no |
| Switch a service on or off at a branch | yes | yes | theirs | no |
| Shopfront, logo, kinds; the service menu and prices; add, close, reopen branches; send for review; post | yes | yes | **no** | no |
| Balance, payouts, payout number's state | yes | yes | **no** | **no** |
| How it is going (analytics) | yes | yes | their branches | **no** |
| People: invite, remove, roles, branches; payout number; pause and resume | yes | no | no | no |

- **A branch outside someone's scope does not exist for them** — 404, the same
  answer as another business's branch (§10.7), for the branch, its bookings,
  its conversations and its reviews. Asking for it by id, or filtering a list
  by it, finds nothing.
- **Whole-business changes need every branch** (`@AllBranches()` on 19
  routes): a manager of some branches would otherwise be changing the others'
  prices and shopfront. Refused with 403 and a sentence saying who can.
- **New rule: staff cannot cancel.** Cancelling by the business refunds the
  customer in full (§25), so it is money leaving; the owner or a manager does
  it. Check-in, finishing and no-show stay with staff (§16.6).
- **The money is the owner's and every-branch managers'.** Its figures are the
  whole business's, so a manager of some branches would be reading the
  others' takings; the front desk does not need them. Supersedes §48.5's "any
  member may read the status".
- **Analytics are for the owner and managers.** A manager of some branches
  sees their branches together, or one of them; the response says which
  (`locationIds`, null for the whole business).
- **Review replies stay open to staff** (§92.1), within their branches.

### 277.3 Conversations, tickets and who is told

- **A question asked from a branch's page remembers the branch**
  (`Thread.locationId`; the customer app now sends it). A booking's
  conversation belongs to the booking's branch. A question with no branch —
  older ones, or one asked of the business as a whole — is seen by the owner
  and every-branch members only.
- **Help tickets**: someone with some branches sees the tickets they raised and
  those about bookings at their branches.
- **Who is told**: booking and message notices go to the owner, every-branch
  members, and those who look after that branch (supersedes §20.4 and §21.5's
  "every active member"). Money notices go to those who may see the money.
  Notices about the whole shop (moderation, approval) still go to everyone.
- **The People list** shows someone with some branches the people they work
  with: the owner, every-branch members, and those who share a branch — and of
  anyone's branches, only the shared ones.

### 277.4 The seller app says it, rather than refusing

- One `useAccess()` (`src/access.ts`) holds the rules, so every screen agrees.
  While it is still finding out who this is it acts as the owner, so nothing
  flickers away for most people; the server decides every request regardless.
- **People**: inviting asks "Where they work" — *Every branch, including any
  you open later*, or *Chosen branches* with a tick list. Each person shows
  their branches as tags; the owner changes them in a panel from the right.
  The roles card explains branches.
- **Menus**: *Getting paid* is hidden from those who may not see the money,
  *How it is going* from staff; a heading left empty goes too. Opened by its
  address anyway, the page says who it is for, in one calm card.
- **Pages** hide what someone cannot do and say so in a blue line: Services
  (no Add, no edit; a branch manager keeps the on/off switch), Branches & hours
  (staff see the week read-only; only every-branch runners add or close
  branches), Closures (read-only for staff), the shopfront (read-only; branch
  managers keep their branches' photos; only the owner sees the pause switch),
  Appointments (no Cancel for staff; "All your branches"), Overview (no money
  card, no owner actions), the setup screen, the go-live card, and the "For
  you" adverts (no "start a sale" or "add a branch" to someone who cannot).

### 277.5 Verified

- `test/branch-access.e2e.spec.ts`, 20 cases over HTTP: what a one-branch
  member sees; 404 on another branch's booking, branch, photos and reviews;
  `@AllBranches` refusals and an every-branch manager allowed; staff cancel
  refused; analytics refused to staff and scoped for a branch manager; money
  readers; who a branch-B message notifies; the inquiry's branch; the owner
  changing branches and the effect at once; refusals (manager, for the owner,
  none, another business's); an invitation's branches surviving acceptance;
  `/users/me`. Two older tests changed with the rule (staff reading the payout
  number). Full suite: 66 suites, 1,417 tests.
- In the browser on Kigali Barbers (3 branches), with a manager of one branch
  and staff of another invited and signed in through the real flow: the
  People page and its panel at 1440 and 390, saving a branch change through
  the panel (the staff member's branches followed at once), the branch
  manager's Services and Getting paid, the staff member's Branches & hours,
  People and shopfront. The two test accounts were removed afterwards.

## 278. The service page, cleaner: the shop under the photos, the promises where the money moves (2026-10-17)

The user, looking at the end of the service page (the shop card, then "Safe
to book"): it is not clean; the link to the shop could go on top, just under
or above the photos, and smaller; the rest may not belong on this page — find
it a professional place elsewhere.

**The page now ends where the choosing ends.** Photos, then who does it, then
the shop's words, then the one card with price, people, day and time. The
bottom bar is unchanged.

- **Who does it, one slim line under the photos** — the way listing pages
  everywhere name the seller under the pictures. The logo (36), the shop's
  name with a small chevron, and under it the rating "★ 3.5 (4)" and the
  drive time when known; with neither, "View their shop". No card: it sits on
  the page like the shop's own words. The branch is not repeated — the card
  below already says it. The whole line opens the shop's page.
- **"Ask"**, a small blue pill at the end of that line (signed in only),
  replaces the full-width "Have a question? Message the shop" row.
- **"Safe to book" is gone from this page.** Its promises are about paying,
  so each is said where the paying is:
  - at **checkout**, under the MoMo number: a green lock and "Your PIN goes
    only into your phone. This app never asks for it." — the place payment
    pages put their security line;
  - the refund rule was already at checkout, beside the amount;
  - "confirmed the moment you pay" is now the line under **Pay now**:
    "15% deposit · confirms your time";
  - and the whole set, with a fourth ("The rest is paid at the shop"), in
    **Account → About → How paying works**, a sheet (`PayingPromises`).
- **Fixed on the way:** in a browser, a shop that serves more than 20 people
  at once showed "How many people?" squeezed to one letter a line — the typed
  number box took the browser's default width (~150px). It now has a set
  width (`Stepper`).

Checked in the web preview at 390 and 1280 on two shops (one rated, one
not), the checkout of a test booking (cancelled and removed afterwards), and
the Account sheet.

## 279. How long a sign-in lasts, per app, and confirming it is you (2026-10-18)

Asked: after how long should people be signed out for safety, in each of the
three apps. Recommended, agreed ("yes build it"):

| App | Signed out after unused for | Signed out after, however busy |
|---|---|---|
| Admin console | **30 minutes** | **12 hours** |
| Seller app | **12 hours** | **30 days** |
| Customer app | **30 days** (as before) | — |

Why: the console can approve shops and mark payouts paid; the seller app
sits on a shop's shared front-desk computer (a working day, signed out by the
next morning); the customer app is on a person's own locked phone and nothing
can be paid without their MoMo PIN — signing customers out mostly loses
bookings. Before this, all three were the same: 30 days unused, renewed for
ever by use.

### 279.1 The server

- One table, `src/auth/session-policy.ts`, replaces `JWT_REFRESH_EXPIRES_IN`.
- **Unused**: the refresh token lives as long as the app's idle time, and is
  rotated on each use, as before.
- **However busy**: `RefreshToken.sessionStartedAt` — when the code was typed —
  is carried through every rotation. Past `start + most`, the refresh is
  refused ("For your safety, this sign-in has ended"), and no token is ever
  issued to outlive that moment (the access token is shortened to fit).
  Sign-ins that existed before are counted from the migration.
- Token pairs now say `session: { idleMinutes, maxMinutes, endsAt }`, so the
  screens never keep their own copy of the rules.
- Refresh tokens carry a random `jti`: two issued in the same second were the
  same token, and the stored hash is unique.

### 279.2 The screens (admin console and seller app)

- **The app keeps its own clock**, because the seller app checks for new
  bookings and messages every minute and those checks would keep a forgotten
  tab signed in for ever. It counts real clicks, keys, scrolling and touches,
  written to `localStorage` at most every 5 seconds — **shared by every tab**,
  so one busy tab keeps the others open.
- **"Still there?"** 2 minutes before the end in the console, 5 in the seller
  app: a ring running down, the time left, *Stay signed in* or *Sign out now*.
  Moving the mouse does not dismiss it; a button does. A sign-in's fixed end
  is said 2 minutes before ("Time to sign in again").
- A tab or browser opened again after too long is signed out at once, before
  anything shows. Opening a page counts as using it.
- While someone is busy without the screen asking the server for anything,
  the sign-in is renewed in the background (after half the idle time), so
  the server's clock agrees with the screen's.
- **Every tab is one sign-in**: signing out in one signs out the others, and
  two tabs renewing at the same moment no longer sign each other out (the
  loser uses the winner's new tokens).
- The sign-in page says why: "You were signed out after 30 minutes without
  use, to keep the console safe. Sign in again to carry on."
- `IdleGuard.tsx` and `words.ts` are identical copies in both apps (`cmp`).

### 279.3 Confirm it is you

The changes that move a shop's money or let someone in need a code typed in
the last **10 minutes** — a sign-in that recent, or a fresh "confirm it is
you" code:

- setting the **payout number**;
- **inviting** someone, changing their **role** or **branches**, **removing**
  them.

The server refuses with 403 and `code: STEP_UP_REQUIRED` (now part of
`ApiErrorDto`). The seller app then shows *Confirm it is you*, emails a
code of its own kind (`OtpPurpose.STEP_UP`, "Confirm it is you: 123456" —
it cannot sign anybody in, and a sign-in code cannot be used here), and on
the right code sends the same request again with an `X-Step-Up` pass; the
page that made the change never knows it was asked. The pass lasts 10
minutes, is kept in memory only, names its person, and is signed with a key
of its own (derived from the access key), so it can never stand in for a
sign-in. Who may do the change is answered first: staff are refused for
being staff, not asked for a code; the payout route checks the owner before
asking.

Tests that mint tokens now mint fresh sign-ins (`auth_time` = now), and can
mint older ones (`ctx.token(…, signedInMinutesAgo)`).

### 279.4 Fixed on the way

The console's Overview chart: the hover label on the first and last bars
stuck out past the chart, so on a phone the whole page — and every sheet that
slides up — was 18px wider than the screen. The end labels now lean inwards.

### 279.5 Verified

- `test/sessions.e2e.spec.ts`, 15 cases over HTTP through the real sign-in:
  each app's lengths; a refresh keeps its start; past the end it is refused;
  near the end no token outlives it; unused past idle it is refused; a fresh
  sign-in is enough; an older one is asked and a code lets the same change
  through (twice in a row, asked once); a wrong code; a confirm code cannot
  sign in, cannot be borrowed by another owner, and is not a sign-in; staff
  refused without being asked; role, branches and removal ask; the payout
  number asks the owner only. Full suite: 67 suites, 1,432 tests.
- In the browser: the console's warning at 1440, 1024 and 390, *Stay signed
  in* resetting the clock, the automatic sign-out with its note and the old
  sign-in refused by the server; the seller app's 12-hour warning at 390; the
  owner of Kigali Barbers with a 20-minute-old sign-in inviting someone — asked,
  the emailed code typed, the invitation sent by itself — at 1440 and 390. The
  test invitation was removed.

## 280. "Post this service" did nothing — the agreement, asked where the person is (2026-10-18)

Reported: in the seller app, a service filled in completely and "Post this
service" pressed — nothing happens, and it cannot be posted.

What happened (GrowthPath Consulting, from its saved draft): the shop's owner
had agreed to Seller Agreement version 2; version 3 was published on
2026-10-12 (§275). The server refuses to list a service until the current
version is accepted (§126.4) — and it did, with a 403. But:

1. **The refusal was shown behind the form.** It went to the page's notice
   line, under the panel the form sits in, so "Posting the service…" flashed
   and nothing seemed to happen.
2. **The agreement was asked only by "Add a service"**, and only once the
   app had finished checking. "Carry on" on a saved draft opened the form
   without asking; so did "Add a service" pressed before the check came back.

Fixed:

- **Asked before posting, however the form was opened** — new, carried on
  from a draft, or open since before a new version was published. The
  agreement opens over the form; agreeing carries on with what the person was
  doing (opens the form, opens the draft, or **posts the service** — nothing
  retyped).
- **The server's refusal says so with `code: AGREEMENT_REQUIRED`** (in
  `ApiErrorDto`), and the seller app answers it the same way: the agreement,
  in place, then the post again. This is the backstop for a version published
  while the form was open.
- **Any refusal of a post or save is said inside the form**, beside the
  button, in red — never on the page behind it. Closing the form clears it.

Verified in the browser: "Carry on" on a Kigali Barbers draft now shows the
agreement first; on a throwaway shop, the agreement taken away while the form
was open — Post refused, the agreement shown over the still-open form, "I
agree", and the service posted by itself (POST 403 → accept 200 → POST 201,
its draft discarded); a price over the maximum shows the server's sentence
beside the button. The throwaway shop was removed. Full suite: 67 suites,
1,433 tests (one added: the refusal carries its code).

## 281. A service's photos change only when "Save changes" is pressed (2026-10-18)

Reported: editing a service in the seller app — removing or adding a photo —
showed in the customer app before "Save changes" was pressed. The seller
wants to be the one to say when a change goes out.

The photo section of an existing service was a live manager: each add,
remove and "Make cover" went to the server at once (§132, §194). Everything
else in the form already waited for the button.

- **The photos are now part of the form**, the same way a new service's
  always were (§165): added, removed and made the cover in the form, and sent
  only on **Save changes** — the removed ones first (so a full service has
  room), then the new ones, then the cover, with "Uploading photo 1 of 2…" on
  the button. If one of them fails, the rest are still saved and the page
  says which did not go through.
- While a change waits, a new photo is marked **Not saved**, the panel says
  **Unsaved changes**, and a line under the photos says customers still see
  them as they were. Closing asks "Leave without saving?" and throws the
  photo changes away with the rest.
- Removing a photo no longer asks "cannot be brought back" — until Save it can.
- The live photo manager (`ServicePhotos`) is gone; one photo section serves
  a new service and an existing one.
- **Fixed on the way:** on a touch screen, "Make cover" and Remove appeared
  only on hover, which a phone does not have — so a non-cover photo could not
  be removed or made the cover. They are always shown there now.

Not changed, on purpose: a service's on/off switch per branch on its card
still acts at once — a switch is the control that does (§194) — and the
shopfront's photos (logo, cover, branch galleries) still save as they are
added; the same could be done there if wanted.

Verified in the browser: on Kigali Barbers, a photo removed, one added and
made the cover — the server still had the same three photos, the panel said
Unsaved changes; on a throwaway shop with two photos, one removed, one added
as cover: unchanged on the server while open, then on Save — DELETE, POST,
cover — leading with the new one; "Cancel" → "Leave without saving?" →
photos as they were; at 390 on a touch screen, the buttons on every photo.
The throwaway shop was removed.

## 282. MTN not answering: said plainly, and never a stuck payment (2026-10-18)

Reported: the customer app's checkout said "Could not start the payment —
Internal server error".

Cause: **MTN's MoMo sandbox was down** from about 00:19 on 2026-10-18 —
every authenticated call, even asking about a made-up user, answered MTN's
own `500 Internal server error`, while a wrong key was still refused
normally (401). Nothing in our keys or code had broken. But our side let it
through badly: a refused **token** was thrown as a plain error, so the
customer read "Internal server error".

- **Starting a deposit**: MTN refusing a token, or not being reachable, is
  now a failed start — `TRANSIENT`, or `CONFIGURATION` when MTN says our keys
  are wrong (401/403, and the admins are told, as §52.2). A `TRANSIENT`
  failure is answered **503**: "MTN MoMo is not answering right now, so the
  payment could not start. You have NOT been charged, and your booking is
  still held for a few minutes — please try again shortly." — never the
  operator's own words ("HTTP 503: no code given") as before.
- **A request lost on the way after the token** is NOT called "not started":
  MTN may have queued it and be prompting the customer, and calling it not
  started could let them pay with no booking to show. It is kept as under
  way with its reference; the poll asks MTN, and the unpaid-hold expiry
  bounds the wait.
- **Checking a payment under way**: no token, or no answer, is "not known
  yet" (PENDING) — the same rule a 5xx already had — never failed.
- **Payouts**: an admin sending a payout while MTN refused tokens left it
  "being sent" for a transfer MTN never saw (the row is marked before the
  call). No token now means nothing was sent: a refusal, and the payout goes
  back to PENDING for another attempt. A transfer lost after the token is
  left as before — "being sent" — because it may have arrived, and paying
  twice is worse than waiting.

Verified: `test/momo-unavailable.spec.ts` (7, MTN faked: token 500, no
network, 401, lost request, status checks while down, a normal start, a
payout refused); the existing transient-failure test now expects the 503 and
the plain words. Full suite: 68 suites, 1,440 tests. Live against the real
(down) sandbox: the API answered 503 with the sentence, and the customer
app's checkout showed it in its dialog. The test booking was removed.

## 283. Pasting a code takes all of it; a sale counts down to its end (2026-10-18)

Asked: (1) pasting the six-digit code into the code boxes put in only the
first three digits — let a paste fill as many boxes as digits were copied;
(2) a sale has a last day, so show the customer how long is left — days,
hours, minutes and seconds — for urgency.

### 283.1 The code, pasted

Cause: the email shows the code in six boxes, so copying it gives the digits
with gaps — "1 2 3 4 5 6", tabs or spaces between. Every code box had
`maxLength` 6, so the browser (or the phone's field) kept the first six
characters — "1 2 3 " — three digits, before our code saw the text.

- `codeFrom(text, length)` in all three apps (`ui/CodeBoxes.tsx` in the
  seller and admin apps, identical; `src/auth/CodeBoxes.tsx` in the customer
  app): a run of exactly six digits wins, so the code is found inside "Your
  sign-in code: 482913" and the 24 of "Booking 24, code 482913" is left out;
  otherwise every digit is taken, in order. Fewer digits fill as many boxes.
- The web boxes read a paste from the clipboard itself (`onPaste`) and have
  no `maxLength`; the customer app's one hidden field has none either. A whole
  code pasted over a half-typed one replaces it.
- Every code box benefits: signing in, "confirm it is you" (§279) and the
  seller's check-in.

Checked in the browser: the seller sign-in took "1⇥2⇥3⇥4⇥5⇥6" as 123···
before and as 123456 after; a real paste of "Your sign-in code: 482913" in
the admin console filled 482913; the customer app's field took the tabbed
code as 123456.

### 283.2 A sale's countdown

- The server sends the moment a sale ends — `discount.endsAt`, midnight after
  its last day in the platform's time zone (`liveDiscount` now takes the
  zone) — so the countdown reaches zero exactly when the price changes back,
  not when the customer's own clock thinks the day is over.
- **The service's page**: "Sale ends in" with four boxes — days, hrs, min,
  sec — each number dropping in as it changes. On the last day it turns the
  deepest coral with a pulsing dot: "Last day of the sale — ends in". At zero
  it says the sale has ended and fetches the price again. At most 460 wide.
- **Cards** (Home's shelves, "On sale"): a small "1d 22:20:01" on the photo's
  bottom corner, the length raised above it so a narrow card holds both.
  **The shop's list**: "Ends in 1d 22:22:40" under the price. Both coral
  when under a day; gone at zero.
- One shared once-a-second clock for every countdown on the screen.
- A sale with no last day ("until you end it") shows no countdown — there is
  nothing to count down to.

Checked: GrowthPath's 10% sale (until Mon 19 Oct) at 390 and 1280 — ticking
16 → 14 → 12 seconds two seconds apart; the shop list and the Home shelf; the
last-day look on Kimironko Spa's massage, its last day set to today for the
picture and put back to 12 Oct straight after. Sale tests updated (the end is
22:00 UTC — midnight in Kigali). Full suite: 68 suites, 1,440 tests.

## 284. "Discount", not "sale"; and every kind of place in the sign-in headline (2026-10-18)

Asked: "sale" is not an easy word for some users — say "discount"; and the
sign-in screens' rotating word ("Book your next braids.") leaves out kinds of
service the admin console offers, such as consultancy — add them, on both
apps.

### 284.1 Discount

Where "sale" meant a price cut, it now says **discount** — in the customer
app (the countdown, "discount until Mon 19 Oct", Home's **Discounts** shelf
and banner, checkout and the booking's "Discount · 10% off") and in the
seller app (the service form's **Discount** section, "End the discount", "1
with a discount", the adverts and the guide). Where "on sale" means
*available to book* — "6 on sale", "Not on sale", "Put back on sale" — it is
unchanged: that is a different thing. The server's emails already said "%
OFF". Code names (`SaleBadge`, `discount` fields) are unchanged.

### 284.2 The rotating word follows the categories

- **Customer app**: "Book your next ___." — short phrases for each of the 16
  categories (`src/auth/bookWords.ts`): haircut, car service, consultation,
  workout, photo shoot, table, yoga class, gorilla trek, getaway, home
  cleaning, pet grooming, fitting, class, concert, event… and a second and
  third round (braids, car wash, coaching call…).
- **Seller app**: "Grow your ___." (`src/auth/growWords.ts`): barbershop,
  garage, consultancy, gym, photo studio, restaurant, yoga studio, tour
  company, hotel, cleaning firm…
- Keyed by the category's icon word (stable through a rename), and shown only
  for categories **switched on** in the admin console (`GET /categories`) —
  Health & Medical, off today, does not appear until it is switched on. A
  category added later with no words of its own appears by its name.
- One category at a time, so the first words already show the range.
- Every phrase is measured to stay on one line: the widest customer phrase is
  272 of 342px on a phone; two seller phrases that wrapped ("coaching
  practice", "cleaning business") became "practice" and "cleaning firm".

Fixed on the way: the seller app's shopfront preview built a discount
without §283's `endsAt` and no longer compiled; it sends null (no countdown
in the preview).

## 285. Stories: a photo for today, at the top of the customer app (2026-10-18)

Asked: shops add photos to a story from the seller app, and customers see
them in the customer app, the way social apps do. Proposed on 6 October and
built now with the choices recommended then.

### 285.1 What a story is

- **One photo and up to 150 characters**, posted by the shop. Photos only —
  no video (upload size, data cost for customers, and a moderation load the
  platform is not staffed for).
- **Up 24 hours**, then gone from the customer app. The shop can take one
  down sooner. Three days after it ends, the row and the picture are deleted
  (a 03:30 job, `stories-clear-old`).
- **Ten a day per shop**, counted over the last 24 hours. One the shop
  deletes itself is gone and frees its place; one an administrator took down
  still counts.
- **Live the moment it is posted** — no approval queue. A story is
  low-stakes and short-lived; an approval step would make most of them
  stale before they showed. Customers report; administrators take down.
- **Only live shops' stories are shown** (approved, published, not paused —
  the same rule as the shop itself). A shop not yet live can post; its
  stories appear once it is.
- **Every story ends in "Book at <branch>"**: a story about a branch books
  that branch; one about the whole shop books the shop's first active
  branch. The point of a story is a booking.

### 285.2 Who posts (§277)

The owner and managers post and take down; staff see the page but do not
post. A manager of some branches posts only about one of their branches and
cannot take down a whole-shop story (403, `ALL_BRANCHES_ONLY`). A closed
branch cannot be chosen.

### 285.3 Seller app — Stories (under Your shop)

A phone beside the form shows exactly what customers will see: the photo
(a wide one sits whole on a blurred fill), the bars, the logo, the words and
the Book button. Drag a photo in or choose one; a few words (with four
tap-to-use ideas written for any kind of shop); which branch, when there is
more than one; "3 of 10 today"; **Post story**. Below: **Live now** (time
left, views, branch, delete) and **Ended** (the last two days, with the
reason if an administrator took it down).

### 285.4 Customer app

- **Home**: a row of round logos under the search, while browsing, only when
  a shop has a story. A coral ring means something new; it turns thin grey
  once seen, and seen shops move to the end. Shown to everyone, signed in or
  not.
- **The player** works the way every stories app does, so nobody has to
  learn it: bars along the top; five seconds a photo, counted from when it
  has loaded (a slow connection never skips one); tap right for the next,
  left for the one before; hold to pause (the words clear away); swipe
  sideways for the next shop, down to close. A shop's stories end and the
  next shop's begin. On a wide screen it plays in a phone-shaped frame with
  arrows either side.
- **Seen** is remembered on the phone as "seen up to" one time per shop
  (`src/stories/seen.ts`), because the phone's secure store holds about 2 KB
  a value. Opening a shop again starts at its first unseen story.
- **Views** are counted once per story per sitting, when the photo shows.
- **Report** (the ••• button) is inside the player rather than a separate
  sheet, which on a phone could open behind it: four reasons, signed in
  only, once per person per story. "The shop is not told who reported it."
- **Shop page**: with a story up, the logo wears the ring; tapping it plays
  that shop's stories.

### 285.5 Admin console — Stories (under Moderation)

**Reported** (still up, most reported first, with the reasons) and **Up
now**. **Take it down** asks for a reason, which the shop is sent
(`STORY_REMOVED`, with "raise a support ticket" if they disagree) and which
shows on the shop's ended story. **Keep it up** clears its reports so it
leaves the queue; a new report brings it back. A reported story that ends
leaves the queue by itself — it is no longer in front of anyone. The count
of reported stories is a badge on the menu and a row in "Waiting".

### 285.6 Server

`Story` and `StoryReport` (migration `…_stories`); `POST/GET/DELETE
/business/stories`; public `GET /stories` and `POST /stories/:id/view`;
`POST /stories/:id/report` (customers); `GET /admin/stories?view=`, `POST
/admin/stories/:id/remove` and `/keep`. 12 tests in
`test/stories.e2e.spec.ts`, which also remove the pictures they upload.

## 286. No button inside a button; a story's photo types said up front (2026-10-18)

Asked: fix the web warning "a button cannot contain a nested button"; and
which kinds of file a story takes.

### 286.1 No button inside a button

On the web every element marked as a button becomes a real `<button>`, and a
button inside another is not allowed (React warns; screen readers and
keyboards trip over it). Two cards did it:

- **The service card** (Home's shelves) had its heart inside the card's
  button. `PressableScale` now takes an `overlay`: buttons of their own that
  sit on top and sink with the card when it is pressed, but are not inside
  it. The heart is there, in exactly the same corner.
- **The saved-service card** (Saved → Services) held three buttons — the
  heart, the shop and Book. The card still opens to a tap but is no longer a
  button itself (`accessible={false}`): Book and the shop do everything it
  did, and a phone's screen reader can now reach each of the three, which it
  could not while the card was read as one block.

The place card and the shop page's service rows were never marked as
buttons, so they were fine. A second warning on the Saved page — the list's
`key` passed inside a spread, which React no longer accepts — is fixed too:
the key goes on the list itself. Home, Saved and a shop page now log no
errors.

### 286.2 What a story takes

The same photos as a shop's gallery: **JPG, PNG or WebP, up to 15 MB**. No
video, no GIF. The composer now says so under "Choose a photo", and a wrong
file is refused there and then in plain words ("A story is a photo — a video
cannot go up", "This one is a .svg file", "That photo is 22 MB") instead of
after an upload. The server checks the same rules regardless.

## 287. Notifications people choose; push; announcements; shops writing to followers (2026-10-19)

Asked: how do notifications work today, how do other apps do it (push,
marketing toggles, in-app), how should admins reach buyers and sellers —
research it and suggest the best way; then "go ahead with everything else
but leave out SMS".

Found: every notice was in the bell and also emailed, to everyone, with no
way to turn anything off; no push of any kind; nothing admins could send; and
four faults — user text put into emails without escaping, a notice stuck as
"pending" after a crash never retried, the reminder always saying "Tomorrow",
the seller's bell not opening anything. Research: Airbnb's kinds (booking,
account and security always on; promotions off-able), Fresha and Booksy
(reminders separate from marketing; a client's yes kept), Rwanda's data law
058/2021 (marketing can be refused at any time, free), Apple 4.5.4 (marketing
push only after a yes in the app), Gmail/Yahoo (one-click unsubscribe),
Google (ask for push when its use is plain, not at launch), quiet hours and a
weekly cap (common practice).

### 287.1 The rule

The in-app list always has everything — it is the record. A person chooses,
per kind, whether it also comes **as an alert** (push) and **by email**. The
kinds (`notification-catalog.ts`, one place for screens, sender and emails):

- **Customers:** Bookings and payments (email locked on), Reminders,
  Messages, Reviews ("How was it?" and replies), Offers from places you
  follow, News and offers from us (off until a yes), Account and support
  (email locked on).
- **Sellers:** Bookings (email locked on — one by one, or one 7:00 summary),
  Messages, Reviews, Money (payouts sent or failed, the payout number), Your
  shop and support (email locked on), News and tips (off until a yes).
- **Administrators:** Support tickets, Waiting for a check, Platform problems
  (locked on), Your account — by email (no push for the console).

Each team member chooses their own. Only choices that differ from the default
are stored (`NotificationPreference`); a yes or no to marketing is kept with
the words shown (`ConsentRecord`), because the law asks that consent can be
shown and withdrawn as easily as given.

### 287.2 How it is sent

- **One row per way it is sent** (`NotificationDelivery`: email or push, its
  own state, attempts and error). The notification is the inbox entry; the
  delivery is the post. Old rows' email state was moved over by the migration.
- **A sweep every minute** sends what is due and retries failures with a
  growing wait (2, 4, 8… minutes, up to an hour, five tries), and picks up a
  send interrupted half-way — the stuck-"pending" fault.
- **Quiet hours** (default 21:00–07:00 Kigali, per person): an alert that can
  wait (reviews, money, offers, news, account) waits; bookings, reminders and
  messages do not. Email is not held.
- **A message's email waits ten minutes** when an alert went too, and is
  skipped if the conversation was read in the app meanwhile.
- **A seller's morning summary**: booking emails held and sent as one at 7:00.
- **Marketing pushes: three a week at most** per person, whatever was sent;
  the rest stay in the list.
- **Emails** in the app's look, every word escaped, with why it came, where
  to change it, and — for anything not locked — a signed one-click "Stop
  emails like this" (RFC 8058 headers too), no sign-in needed.
- **A closed account is told nothing more**; administrators' alerts leave
  closed admin accounts out.

### 287.3 Push

- **Phones** (customer app): `expo-notifications`, through Expo's push
  service (free). Asked **after the first payment** ("Remind me before it"),
  or from Notifications in Account — never at launch. Tapping an alert opens
  what it is about. Signing out forgets the phone. Expo's receipts are read
  15 minutes later and a phone that is gone is switched off.
  **To go live:** run `eas init` (the project id is what a token is made
  from), add Android's FCM credentials and Apple's push key in EAS, and test
  on a development build — Expo Go and the browser preview cannot receive.
- **Browsers** (seller app): web push with VAPID keys and a small service
  worker; "Alerts on this computer" on the Notifications page. Chrome, Edge,
  Firefox and Safari on a Mac; an iPhone only from the home screen. Checked
  against Google's push service (it accepted, 201). Signing out turns it off
  there. **To go live:** generate a production pair (`.env.example`).
- **The bell is live** in all three apps over a socket (`/live`), the minute's
  poll kept underneath.

### 287.4 New notices

Payout sent / failed (to those who see the money), "How was it?" after a visit
(opens the review), announcements, shop offers. Every notice now carries
`link`, where it opens in its recipient's app — the bell, a push and an
email's button go to the same place. Fixed: the reminder says Today, Tomorrow
or the day; a chat message to a shop says "from a customer".

### 287.5 Announcements (admin console, People)

- **Two kinds.** A *service notice* reaches everyone it is for (category
  Account; email locked on, so use sparingly). *News and offers* reaches only
  people who said yes to news, and every one can stop.
- **Audience:** everyone, all customers (or a district — home area or where
  they booked), all sellers (or one category), one shop's team, one person.
  Never administrators.
- Live **reach** (people, by alert, by email, left out), alert and email
  previews, **a test to yourself**, **now or later**, and above 100 people the
  number must be typed back. A **report** per announcement: reached, read,
  alerts, emails, failed, waiting for quiet hours.
- A service notice can also be a **banner** across Home and the seller app
  until a date (a week if none), closable.
- **Write to them**: on a person's or a shop's panel, an administrator starts
  a **support conversation** (a ticket, assigned to them) rather than a
  one-way email — the person can answer. A shop means its owner.

### 287.6 Shops writing to their followers

- ~~A customer **follows** a shop from its page or right after booking; the
  follow is the yes, kept with its words ("Yes, send me X's offers. I can
  stop at any time."), and unfollowing is one tap, also from Notifications.~~
  *Superseded by §288: following and the yes to offers are now two things.*
- The seller's **Followers** page: how many follow, a message (title 60,
  message 300, which branch it opens), the follower's lock screen beside it,
  and what was sent with how many opened it. **One a week** per shop; only the
  owner and every-branch managers; only a live shop. It arrives as "Offers
  from places you follow" — quiet hours and the weekly cap apply.

### 287.7 Not done

- **SMS**, as asked — still the seam from §20.6.
- The **automatic no-show** is still silent.
- No per-business reminder lead time; no admin view of every delivery outside
  an announcement's report.

21 tests in `test/notification-choices.e2e.spec.ts`.

## 288. Following: one heart for a shop, and what it brings (2026-10-19)

The user asked whether following should give more than a weekly message —
seeing the services of shops you follow easily — and whether customers need a
list of the shops they follow. Both yes. Saving a place (§120) and following
it (§287) were two hearts for nearly the same wish, so they became one.

### 288.1 The rule

- **A shop has one heart: Follow.** It is the pill beside the shop's name.
  The heart that saved a place in the top bar is gone. Services keep their own
  heart (§158) — a haircut is saved, a shop is followed.
- **Following brings things into the app at once**, with no further yes:
  - its card under **Saved → Following**, with what is new there — a discount
    on now, a service added in the last 14 days, this week's message;
  - a **"From places you follow"** shelf on Home, newest first, not narrowed
    by area or chips (following is not about where you are);
  - its **stories first** in the stories row;
  - a **note in the notification list** when it starts a discount
    (`SHOP_DISCOUNT`) — in the list only, never an alert or email, once per
    discount (`discount_notes` remembers which were told; checked every 15
    minutes).
- **Offers as alerts or emails stay a separate yes**, per shop
  (`shop_follows.offersAt`), with its words kept in `consent_records`. Asked
  in the same moment as following: "Follow, and send me offers" / "Just
  follow" / "Not now". Changed on the card's bell under Saved → Following.
  The payment screen's switch is that yes, and says so.
- **Moved over:** everyone who had saved a place now follows its business,
  with offers off. Everyone who already followed keeps offers on — they had
  said yes to exactly that.
- **Follower count on a shop's page only from 20 up.** "3 people follow"
  reads worse than nothing.
- **Search order is not changed by follows.** A shop does not rank higher for
  being followed; that would reward the big ones and is not what search is for.

### 288.2 Where things are

- Customer app: `app/(tabs)/saved.tsx` (Following · N and Services · N),
  `src/components/FollowingCard.tsx`, `src/useFollow.ts` (`useFollows`,
  `useFollow`, `whose` for "Barbers'" not "Barbers's"), the Home shelf, and
  the stories order in `src/stories/seen.ts`. Notifications now links to
  Saved → Following instead of listing shops. Unfollowing from the card has
  Undo, which puts back the yes too. The Account tab counts Following.
- The dialog gained a `secondary` button (soft colour), so "Just follow" does
  not shout as loud as the main choice.
- Seller app: Followers says how many follow and how many get offers as
  alerts; the confirm says everyone sees the message in the app and only those
  who said yes are alerted; history reads "Alerted N". The phone preview shows
  the Follow pill.
- Backend: `GET /follows` is the rich list; `POST /follows/:id {offers}`,
  `PATCH /follows/:id {offers}`, `DELETE`. `GET /discover/services?following=true`
  (signed in). The shopfront carries `business.followers`.
- `/favourites` for places is no longer used by the app; it stays on the
  server for now.

### 288.3 The Follow button and why to follow (user's ask, same day)

- The user wanted Follow **right under the shop's pictures**, not a heart at
  the top, and the popup to **say plainly why following is worth it**;
  services keep their hearts on Home and on the shop page.
- Follow is now a **real button at the end of that row**: solid coral while
  not followed, soft once followed — so it no longer reads like the "Nails"
  tag beside it. The Saved card's Following button uses the same soft look.
  The seller's phone preview matches.
- The popup lists the reasons, each with its icon: its discounts as they
  start, new services as they are added, a row of its services on Home, its
  stories first, all of it in Saved → Following. The dialog gained `points`
  (a list with icons) and `note` (fine print).
- The **offer words are never scrolled out of sight**: the note sits outside
  the scrolling part, because "Follow, and send me offers" agrees to them. On
  a small phone (375×667) everything shows without scrolling.

### 288.4 Not done

- No "new from places you follow" badge on the Saved tab.
- Following a shop does not change the order of its services anywhere else.

25 tests in `test/notification-choices.e2e.spec.ts` (6 for this); 1477 in all.

## 289. Searching the money pages: payouts and payout numbers (2026-10-19)

The user asked for a search on **Payouts** and **Payout numbers** so an admin
can find one by place, name, number and so on. Both pages were a queue in
tabs with no way to find one shop.

### 289.1 The server

- **`GET /admin/payouts?q=`** and **`GET /admin/payout-destinations?q=`** — one
  word, matched by the database with the tab and the paging (§216), any case:
  - the shop: its **name**, its **phone**, an active member's **email**;
  - where it is: a branch's **name**, **street**, **district** or **province**
    ("Gasabo", "Northern", "KG 17");
  - a **number typed any way people type it** — "0788 100 004", "+250 788…",
    in threes, or only the end they remember. The leading 0 is dropped and
    the digits are looked for inside the stored "+250…" form; fewer than
    three digits is not a search (`numberPart`, `payout-search.ts`).
  - Payouts also match **any payout number the shop has ever given** (a
    statement names the number the money went to, which may since have been
    replaced) and the **transfer reference** (ours or the operator's).
  - Payout numbers match **that row's own number** (the shop's other numbers
    are rows of their own) and **who gave it**.
- Each row now carries **`places`**: the districts of the shop's open branches
  (a branch's name where it has no district), so a card found by a place
  shows the place.
- `test/money-search.spec.ts`, 5 tests.

### 289.2 The page

- **A search icon at the end of the tabs row**, as asked, rather than a box
  that takes a row on a page whose work is the tabs. It opens into a field
  with a smooth widening; asks once typing pauses; **×** clears and closes;
  **Escape** clears, then closes; **"/"** opens it from anywhere on the page.
  It stays open while a search is in force, and the search is kept in the
  address (`?q=`), like the tab. `ui/SearchToggle.tsx`, styles in
  `styles.css` (`.sx-*`), for any other list page that wants it.
- Where the tabs and an open field do not both fit (a tablet, a phone), the
  field takes its own line **above** the tabs instead of squeezing them — a
  container query on the bar, so it follows the space, not the screen.
- While searching, **the tabs count what was found**; the wallet on Payouts
  and the "not being paid" warning on Payout numbers keep the whole, since
  they are about the platform, not the search. The warning hides during a
  search.
- Each card shows **where the shop is** (pin + districts) under its name.
- Nothing found: "Nothing matches “…”", what to try, and **Clear the
  search**. Under a list: "4 of 4 for “gasabo”".

Checked at 1440, 1024 and 390 with the demo data: closed and open, a place
("gasabo"), a number with its 0 ("0788 100 001"), a search that finds
nothing. Nothing was sent, checked or refused.
