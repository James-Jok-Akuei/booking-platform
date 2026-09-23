# Manual walk-through

> **Re-point to Rwanda, but NOT yet re-walked (§66.5).** Every command in this
> document was run against the old South Sudan dataset. The names, coordinates
> and currency below have been updated to match the Kigali seed, and the shape
> of every response is unchanged — but the **specific figures and distances have
> not been re-verified by hand**, so treat them as indicative until someone
> walks it again. §49's standard is that a walk-through is only worth trusting
> when it has actually been run, and this one currently is not.

A numbered sequence that exercises the whole system by hand, against the demo
dataset. **Every command here was run** against a real server before this
document was written; where reality differed from the plan it says so, and the
full list of what that turned up is in `DECISIONS.md` §49.4.

The point is to *watch the system behave*, not to collect 200s. Each step says
what to look at.

---

## 0. Setup

```bash
cd apps/backend
docker compose up -d                # Postgres on 5433, Mailhog on 8025
npx prisma migrate deploy
npm run prisma:seed                 # the category taxonomy — required first
npm run seed:demo                   # the demo world
npm run start:dev
```

`seed:demo` prints the accounts, ids and which business is in which interesting
state. **Keep that output** — the rest of this document refers to it.

It refuses to run unless all three hold: `NODE_ENV` is not `production`, the
database host is local, and the database is named `booking_platform`,
`booking_platform_dev` or `booking_platform_demo`. It deletes only rows it
created (everything reachable from a `demo-` email).

Two shell variables used throughout:

```bash
B=http://localhost:3000
J() { python3 -m json.tool; }       # pretty-print
```

---

## 1. Browse and search, with no account at all

Nothing here needs a token. That is the point — a customer has to be able to
find a business before they have any reason to sign up.

```bash
# Everything public
curl -s "$B/discover/locations?limit=5" | J

# Cheapest first, across pages
curl -s "$B/discover/locations?sort=price&limit=9" | J

# Near Nyarugenge, within 5km, nearest first
curl -s "$B/discover/locations?lat=-1.9441&lng=30.0619&radiusKm=5&sort=distance" | J

# Open right now
curl -s "$B/discover/locations?openNow=true" | J

# By rating, and by category
curl -s "$B/discover/locations?sort=rating" | J
curl -s "$B/categories" | J        # take a categoryId from here
curl -s "$B/discover/locations?categoryId=<id>" | J
```

**Look at:**

- `total` is **7**, not 9. Kicukiro Tailors (`PENDING`) and Gikondo Fitness
  (`SUSPENDED`) are absent. Approve Kicukiro in step 8 and it appears.
- `fromPriceMinor` is `2000` for **both** Kigali Barbers branches — services belong
  to the business, so branches share a price. Its retired "dye" service at
  1200 is cheaper and correctly ignored.
- Kacyiru Studio has `fromPriceMinor: null` and sorts **last** under
  `sort=price`. No services yet is not the same as free, and not the same as
  absent.
- `approxSettlement.fromPriceMinor` is the SSP figure, rounded to whole pounds,
  with `approximate: true` and the rate's `rateAsOf`. Every row on a page shares
  one `exchangeRate` — check two rows and confirm.
- Distances: Nyarugenge → Nyamirambo is **0.73 km**, → Kacyiru **3.02 km**. Drop
  `radiusKm` to 1 and only the first two survive.
- `openNow` depends on the hour you run this, in **Africa/Kigali**, not your
  machine's timezone. Nyamirambo Salon is closed all day today by design.

---

## 2. Location detail, availability, reviews

```bash
LOC=$(curl -s "$B/discover/locations?q=Nyarugenge" | python3 -c "import json,sys;print(json.load(sys.stdin)['locations'][0]['id'])")

curl -s "$B/discover/locations/$LOC" | J
DATE=$(python3 -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=2)).isoformat())")
curl -s "$B/locations/$LOC/availability?date=$DATE&durationMinutes=30" | J
curl -s "$B/locations/$LOC/reviews" | J
```

**Look at:**

- The detail carries services with `approxSettlement`, the weekly `hours`,
  `upcomingExceptions` (Kigali Barbers is shut **tomorrow** — a seeded public holiday) and
  `gallery`. It carries **no `reviews` key**: that is a separate paginated
  endpoint with its own exposure rules.
- Availability returns `source: "TEMPLATE"`, `08:00`–`19:00`, 43 slots on a
  fifteen-minute grid. Ask for **tomorrow** instead and you get
  `source: "CLOSED_EXCEPTION"` with the reason and zero slots.
- Ask for a **Sunday** and every location is closed.
- The reviews listing shows `displayName` — `"Amal K."`, `"Deng"`, and
  `"Anonymous"` for the customers who set no name. **No id and no email
  anywhere**, because you are anonymous. One review carries `responseText`.
- `ratingAvg` is `3.5` over `4`, not over 5: one seeded review is hidden by
  moderation and excluded from both the list and the average.

---

## 3. Register a customer and book

```bash
curl -s -X POST "$B/auth/otp/request" -H 'Content-Type: application/json' \
  -d '{"email":"walkthrough@example.com","role":"CUSTOMER"}'

# The code is NOT emailed anywhere reachable unless SMTP is configured.
# Read it from the server log:
grep -oE "OTP for walkthrough@example.com: [0-9]{6}" <server log> | tail -1
# ...or from Mailhog at http://localhost:8025 if you configured SMTP.

curl -s -X POST "$B/auth/otp/verify" -H 'Content-Type: application/json' \
  -d '{"email":"walkthrough@example.com","code":"<code>"}' | J
```

> `role` is needed only on **request**, and only for an email that has never
> signed up. Verify takes email and code (§50).

Save `accessToken`, then book:

```bash
CUST="Authorization: Bearer <accessToken>"
SVC=$(curl -s "$B/discover/locations/$LOC" | python3 -c "import json,sys;print(json.load(sys.stdin)['services'][0]['id'])")

curl -s -X POST "$B/appointments" -H "$CUST" -H 'Content-Type: application/json' \
  -d "{\"locationId\":\"$LOC\",\"serviceId\":\"$SVC\",\"startTime\":\"${DATE}T09:00:00.000Z\"}" | J
```

**Look at:**

- `status: "PENDING_PAYMENT"` — the slot is held, nothing is paid.
- `depositAmountMinor: 400`, `platformFeeAmountMinor: 200`,
  `businessAmountMinor: 200` on a 2000c haircut at 20% deposit and a 10% fee.
  **Both percentages apply to the service price**, so 200 + 200 = 400 exactly.
- `servicePriceMinor: 2000` is the price *you agreed*; `service` carries the
  name and duration but **no price**, so a later reprice cannot rewrite history.
- `approxSettlement.depositAmountMinor` — SSP 2,600.00.
- `verificationCodeSentAt` is set: an arrival code went to your inbox (§53.2).
  Fetch the booking on its own (`GET /appointments/$APPT`) and the response also
  carries `verificationCode` — **the customer's own read, and only theirs**
  (§54.2). Do the same read with the business token in step 5 and the field is
  not there at all.

---

## 4. The deposit, and the MoMo sandbox

```bash
APPT=<id from step 3>
curl -s -X POST "$B/appointments/$APPT/initiate-deposit-payment" -H "$CUST" \
  -H 'Content-Type: application/json' -d '{"phoneNumber":"256770000000"}' | J
```

**What actually happens with the seeded data: this fails.** The seed sets the
provider currency to `SSP`, which is right for production and which MTN's
sandbox rejects:

```
MoMo requesttopay rejected (500): {"message":"Currency not supported.","code":"INVALID_CURRENCY"}
```

The customer-facing message is only *"Provider rejected the request (HTTP 500)"*
— the actual reason is in the server log.

**To exercise the sandbox for real**, switch the platform to EUR first (admin
token from step 8):

```bash
curl -s -X PATCH "$B/admin/settings/exchange-rate" -H "$ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"exchangeRateUsdToProviderCurrency":0.92,"providerCurrency":"EUR"}' | J
```

Then re-book and re-initiate. You get `paymentStatus: "PENDING"` and a
`providerReferenceId`; the customer approves on their handset, and the
20-second poll flips the appointment to `BOOKED`. Poll it yourself with:

```bash
curl -s "$B/appointments/$APPT/payment-status" -H "$CUST" | J
```

**If the sandbox is unavailable**, the seeded appointments already went through
the real confirmation path (`applyPaymentResult`), so steps 5 onwards work
without it — use a seeded appointment rather than your own.

---

## 5. Verify arrival, complete, and watch the ledger

Use a seeded `BOOKED` appointment at Kigali Barbers, and the business token from
step 7. **Every seeded appointment has the arrival code `123456`.**

```bash
curl -s -X POST "$B/business/appointments/$APPT/verify" -H "$BIZ" \
  -H 'Content-Type: application/json' -d '{"code":"123456"}' | J   # -> IN_PROGRESS
curl -s -X POST "$B/business/appointments/$APPT/complete" -H "$BIZ" | J  # -> COMPLETED
```

**Look at:**

- `complete` is refused from `BOOKED`. Verification is the gate, and the error
  says so.
- `verificationMethod` is now `CODE`, and `verifiedById` names the business user
  who entered it (§54.3).

### 5a. When the code cannot be used at all (§54)

A customer whose email never arrived asks for another — **from their own
token**, and the previous code dies the moment this succeeds:

```bash
curl -s -X POST "$B/appointments/$APPT/resend-verification-code" -H "$CUST" | J
# Immediately again -> 400 "A code was just sent. Try again in N second(s)"
# With the BUSINESS token -> 404. A code the business can summon is not a code.
```

Read the new code from the server log (or Mailhog), and confirm `123456` is now
refused while the new one works.

When there is no usable code at all — flat phone, no email, five codes burned —
an OWNER or MANAGER verifies on the customer's account of themselves:

```bash
curl -s -X POST "$B/business/appointments/$APPT/verify-manually" -H "$BIZ" \
  -H 'Content-Type: application/json' \
  -d '{"note":"Read back the booking time, the service and the branch."}' | J
```

**Look at:**

- It works, and it is the one route to `IN_PROGRESS` that rests on the
  business's word. That is why the row now carries `verificationMethod: MANUAL`,
  `verifiedById`, and the note verbatim — and why **every admin is emailed as it
  happens**. Check an admin's `GET /notifications`.
- STAFF is refused. Taking a code is counter work; deciding to proceed without
  one is not.
- The note is not checked against the appointment, deliberately: every fact the
  server could check is already on the business's own screen (§54.3).
- Immediately after completion, that appointment's ledger entries gain an
  `availableAt` of `completedAt + 2 days` (the configurable hold), and the
  appointment gains `payoutHoldDaysApplied: 2`.
- Two entries exist per paid appointment: `DEPOSIT_RECEIVED` positive and
  `PLATFORM_FEE` negative, summing to `businessAmountMinor`. In SSP they sum to
  the business's settlement share.

Inspect them directly — there is no ledger read API for a business:

```sql
SELECT type, "amountMinor", "settlementCurrency", "settlementAmountMinor", "availableAt"
FROM ledger_entries WHERE "appointmentId" = '<appt>';
```

---

## 6. Leave a review

Only the customer on a `COMPLETED` appointment can review it, once.

```bash
curl -s -X POST "$B/appointments/$APPT/reviews" -H "$CUST" \
  -H 'Content-Type: application/json' \
  -d '{"rating":5,"comment":"Sharp fade, ten minutes.","displayName":"Walkthrough W."}' | J

curl -s "$B/locations/$LOC/reviews" | J
```

**Look at:** the name appears on the **public** listing with no id or email
beside it, and it is stored on the *user* — so it retro-labels every review that
customer has ever left. Set it to `"Anonymous"` on purpose and it is still
distinguishable in the database from someone who set nothing.

---

## 7. The business side

```bash
curl -s -X POST "$B/auth/otp/request" -H 'Content-Type: application/json' \
  -d '{"email":"demo-nile@example.com","role":"BUSINESS"}'
# read the code from the log, then verify with "role":"BUSINESS"
BIZ="Authorization: Bearer <accessToken>"
BID=<Kigali Barbers's businessId from the seed output>

curl -s "$B/businesses/$BID/analytics" -H "$BIZ" | J
curl -s "$B/businesses/$BID/balance" -H "$BIZ" | J
curl -s -X POST "$B/reviews/<reviewId>/response" -H "$BIZ" \
  -H 'Content-Type: application/json' -d '{"responseText":"Thank you!"}' | J
```

**Look at:**

- Analytics **never** produces a single "revenue" number. `collectedThroughPlatform`
  and `balanceOwedToBusiness` are separate, and the second says in its own
  `note` that the platform never sees that money.
- The default range is **30 days on `startTime`**, so backdated seeded
  appointments fall outside it. `range` in the response tells you what you got.
- `balance` splits available / pending / unresolved and reports
  `availableBySettlementCurrency` — what will actually be sent.
- **A `PENDING` payout is invisible here.** After step 8 runs, `availableNowMinor`
  drops to 0 and `lifetimePaidMinor` stays 0 until an admin marks it paid; the
  money in flight appears nowhere.

---

## 8. Admin

Admins log in exactly like anyone else — **no role in the body**, at either
step (§50):

```bash
curl -s -X POST "$B/auth/otp/request" -H 'Content-Type: application/json' \
  -d '{"email":"demo-admin@example.com"}'
# read the code from the server log, then:
curl -s -X POST "$B/auth/otp/verify" -H 'Content-Type: application/json' \
  -d '{"email":"demo-admin@example.com","code":"<code>"}' | J
```

They still cannot self-*register*: a brand-new email may only be created as
`BUSINESS` or `CUSTOMER`. An admin has to be seeded, which the demo seed does.

```bash
ADMIN="Authorization: Bearer <token>"

# The approval queue — oldest PENDING first
curl -s "$B/admin/businesses?status=PENDING" -H "$ADMIN" | J
curl -s -X PATCH "$B/admin/businesses/<gudeleId>/approve" -H "$ADMIN" | J

# Payout destinations awaiting verification
curl -s "$B/admin/payout-destinations?status=UNVERIFIED" -H "$ADMIN" | J
curl -s -X PATCH "$B/admin/payout-destinations/<id>/verify" -H "$ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"verificationNote":"Confirmed by phone with the owner."}' | J

# Run, export, pay
curl -s -X POST "$B/admin/payouts/run" -H "$ADMIN" | J
curl -s "$B/admin/payouts" -H "$ADMIN" | J
curl -s "$B/admin/payouts/<payoutId>/export" -H "$ADMIN"
curl -s -X PATCH "$B/admin/payouts/<payoutId>/mark-paid" -H "$ADMIN" \
  -H 'Content-Type: application/json' -d '{"reference":"MOMO-WALK-001"}' | J
```

**Look at:**

- Approving Kicukiro makes it appear in step 1's search immediately.
- Verifying Kigali Auto Care's number changes it from paused to payable on the
  **next** run, not retroactively.
- The run summary: `payoutsCreated: 3`, `skippedNonPositive: 1` (Konyo Konyo,
  whose deposit share is exactly zero), and `pausedBusinesses` listing anyone
  held back and why.
- **`totalMinor` in that summary is settlement minor units (SSP), not cents.**
- The CSV carries the **verified msisdn**, the provider, a `payable` column, and
  one `TOTAL` row per currency. Supersede a destination and re-export: the row
  becomes `NOT RECORDED` / `DO NOT SEND` while the payout still exists.

---

## 9. A ticket and an adjustment

The seed leaves one open ticket and one resolved with an executed adjustment.

```bash
curl -s -X POST "$B/tickets" -H "$CUST" -H 'Content-Type: application/json' \
  -d '{"category":"TECHNICAL_ISSUE","subject":"Wrong price shown","body":"The listing said one thing and I was charged another."}' | J

curl -s "$B/admin/tickets" -H "$ADMIN" | J
curl -s -X PATCH "$B/admin/tickets/<id>/status" -H "$ADMIN" -H 'Content-Type: application/json' \
  -d '{"status":"IN_PROGRESS"}' | J
curl -s -X PATCH "$B/admin/tickets/<id>/status" -H "$ADMIN" -H 'Content-Type: application/json' \
  -d '{"status":"RESOLVED","resolutionNote":"Refunding the platform fee.","billingAdjustment":{"appointmentId":"<appt>","type":"FEE_REFUND","amount":1.50,"reason":"Goodwill."}}' | J

curl -s -X PATCH "$B/admin/billing-adjustments/<adjustmentId>/execute" -H "$ADMIN" \
  -H 'Content-Type: application/json' -d '{"settlementRef":"DEMO-1"}' | J
```

**Look at:** recording the adjustment moves no money — `settledAt` is null and
no ledger entry exists. **Executing** it writes one `ADJUSTMENT` entry
(`+150` USD cents, `+97,500` SSP) and stamps `settledAt`. Execute it twice and
the second attempt is refused.

There is no endpoint that lists billing adjustments; read the id from the
resolved ticket's response or the database.

---

## 10. Reconciliation

```bash
curl -s "$B/admin/ledger/held" -H "$ADMIN" | J
```

Compare against what is actually unsettled:

```sql
SELECT "settlementCurrency", SUM("settlementAmountMinor"), COUNT(*)
FROM ledger_entries WHERE "payoutId" IS NULL GROUP BY 1;
```

**Look at:** they do not agree, and cannot. `held` groups by the **USD**
`currency` column (`USD 900c`), while the money is actually held in **SSP**
(`585,000` minor). See §49.4.

---

## Resetting

```bash
npm run seed:demo     # idempotent — clears the previous demo data and rebuilds
```
