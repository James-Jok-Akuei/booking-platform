# Deploying this platform

Written for whoever puts this somewhere other than a laptop. It assumes the
reader has not read `DECISIONS.md`, and points at it where the reasoning matters.

Nothing here has been deployed yet. This describes what the code requires, and
each requirement is enforced at boot — the backend **refuses to start** in
production with any of them wrong, rather than failing later in front of a
customer (§116.3). That refusal lists every problem at once, so fixing them is
one pass rather than one deploy per mistake.

---

## What has to exist

| | Why |
|---|---|
| **PostgreSQL 16** | The ledger's immutability trigger, partial unique indexes and CHECK constraints are Postgres features, not Prisma ones. |
| **An SMTP sender** | Sign-in is a code by email. No email means nobody can sign in at all — not even you. |
| **Cloudflare R2** (or equivalent S3) | Uploaded files. See *Uploads* below; this is the one people get wrong. |
| **MTN MoMo production credentials** | Collections and Disbursements are separate products with separate keys. |

Three static sites (admin, business, customer-web if ever built) and one Node
service. The phone app is built and distributed separately.

---

## Environment

The backend reads `apps/backend/.env`. `apps/backend/.env.example` is the full
list with comments; the entries below are the ones that are **different in
production** and that boot checks.

### `CORS_ORIGINS` — required

Comma-separated origins of the apps that call this API from a browser:

```
CORS_ORIGINS=https://admin.example.com,https://business.example.com
```

Empty means every origin, which is right in development and never right here.

This is not an access control — curl, the phone app and any server ignore CORS
entirely, and the guards and rate limits are what actually protect the API. What
it does is stop a page on another site making requests from a signed-in person's
browser.

### `APP_BASE_URL` — required, and must be publicly reachable

```
APP_BASE_URL=https://api.example.com
```

This is stamped into the URL of **every uploaded file** — shop logos, cover
images, gallery photos, chat pictures, ticket attachments. Set to `localhost` or
a private address, every image in every app is a broken box while the API beside
it answers perfectly, which is what makes it so confusing to diagnose (§113.1).

**The URL is stored on the row when a file is uploaded.** Changing this later
fixes new uploads and not old ones, so get it right before anyone uses the
system.

### `R2_PUBLIC_URL` and the R2 keys — required

Without them, uploads fall back to local disk. That fallback exists for
development. On a host with an ephemeral filesystem — which is most of them —
**every uploaded file is deleted on the next deploy**, silently, and nobody
notices until a customer asks why a shop has no photos.

If the deployment genuinely has a persistent disk and you want that, say so on
purpose:

```
ALLOW_LOCAL_UPLOADS=true
```

Boot refuses rather than assuming either way.

### `MOMO_SANDBOX_CURRENCY_OVERRIDE` — must be unset

It rewrites the currency sent to the payment provider, and exists only because
MTN's sandbox accepts EUR alone (§52.1). The payment provider refuses to start if
it is set in production, independently of the boot check — two guards, because
this one bills real people in a currency nobody chose.

### `TRUST_PROXY_HOPS` — set it if there is a proxy

```
TRUST_PROXY_HOPS=1
```

Rate limiting counts by client IP. Behind a load balancer every request appears
to come from the balancer, so **one busy customer rate-limits everybody**. This
tells Express how many hops to trust.

Set it too high and a caller can forge the header and escape the limit entirely,
so it is the number of proxies you actually run, not a guess.

### `OPENAPI_PUBLIC` — leave unset

The spec is a complete map of the attack surface, and all three clients are built
from a generated file rather than from a live endpoint.

### `INTERNAL_CURRENCY` — set once, never changed

The unit of account for every amount in the database. `CurrencyGuard` refuses to
start if the ledger already holds entries in another currency, because changing
it would silently reinterpret every number ever stored (§55).

---

## Rate limits

Applied as middleware, off in tests, and deliberately uneven (§116.2):

| Path | Limit |
|---|---|
| `POST /auth/otp/request` | 5 / minute |
| `POST /auth/otp/verify` | 10 / minute |
| `POST /appointments/:id/initiate-deposit-payment` | 10 / minute |
| `POST /threads/inquiry` | 20 / minute |
| everything else | 600 / minute, 10,000 / hour |

The general ceiling is high **on purpose**. Counting is by IP, and in this market
that is not one person: mobile carriers put very large numbers of subscribers
behind a handful of addresses, and a salon or an office shares one. A limit tuned
to a single enthusiastic user would cut off a whole neighbourhood the moment a
few of them opened the app — and only the busiest places, which is the worst
possible group to break it for.

The real protection is the narrow limits. Those endpoints send email, charge a
phone or start a conversation, and each is small enough to matter even when
shared across a carrier's address.

---

## Order of operations

1. `npx prisma migrate deploy` from `apps/backend`. **Never `migrate dev`** in
   production — it can reset. Run it before the new code starts: the backend
   reads the schema at boot, and a backend ahead of its database fails in ways
   that look like code.
2. Load the reference data: `npx prisma db execute --file prisma/reference-data.sql`.
   Idempotent, and without it there are no provinces or districts, so every place
   filter matches nothing (§104).
3. Start the backend. It refuses to start if anything above is wrong.
4. Deploy the static apps with `VITE_API_URL` pointing at the backend.

---

## Before taking real money

These are not blockers for a staging deployment and are blockers for a real one.

- **Ledger history is enforced only going forward.**
  `ledger_entries_adjustment_payable` is `NOT VALID`, so it checks new rows and
  leaves pre-§45 ones alone (§115). On a database with no such rows — a fresh
  deployment has none — enforce it over everything too:
  ```sql
  ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_adjustment_payable";
  ```
- **Exchange-rate staleness**: `exchangeRateStalenessHours` defaults to 24.
  Decide whether that is right before the first payout.
- **Backups.** The ledger is the only record of what the platform owes anyone,
  it is append-only by design, and there is no other copy.

---

## What this document does not cover

Choosing a host, DNS, TLS, CI, and log aggregation. They do not depend on
anything specific to this codebase, and guessing at them here would date faster
than the rest of the file.
