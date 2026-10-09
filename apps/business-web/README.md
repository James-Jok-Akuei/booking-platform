# Business app

What a business uses day to day: see who is expected, verify arrivals, mark work
done. React + Vite + TypeScript, built to static files — same stack and the same
API client as the admin console.

## Running it

```bash
# backend, from apps/backend
docker compose up -d
npm run start:dev                      # http://localhost:4100

# this app, from the repo root
npm run dev --workspace=business-web   # http://localhost:5174
```

Port **5174**, so it can run alongside the admin console on 5173. Vite proxies
`/api/*` to the backend, so the browser sees one origin and CORS does not apply
locally.

## Signing in

No password. Enter the business account's email, read the six-digit code, enter
it. The code goes to **Mailhog at http://localhost:8025**, and is also printed
in the backend log.

`npm run seed:demo` in `apps/backend` creates `demo-nile@example.com`
(Kigali Barbers, OWNER) among others. **Every seeded appointment's arrival code
is `123456`.**

## The one screen, and what it is for

Appointments, defaulting to **Expected** — customers who are booked and have not
arrived. That is what someone opens this app to deal with.

- **Verify** takes the six-digit code the customer reads out. It is the gate
  that makes "done" mean something: without it there is nothing separating *the
  customer came* from *the business says so* (§16.2).
- **No code?** is manual verification, **OWNER and MANAGER only** (§54.3). It is
  recorded against whoever does it, with what the customer recalled, and every
  administrator is notified. Taking a code is counter work; deciding to proceed
  without one is a judgement.
- **Mark done** moves a verified appointment to COMPLETED, which is what starts
  its money maturing towards a payout.

## Money on this screen

**"You earn"** is the business's share of the *deposit* — not the price. The
balance is settled directly with the customer and the platform never sees it
(§29.2), which is why the row says so underneath.

Amounts are formatted using the exponent the server reports at
`GET /payments/currency`. **Never divide by 100 in a client**: that is right in
a two-decimal currency and wrong by a factor of a hundred in one with no minor
unit, which is what Rwandan francs are (§55.2, §70.1).

## Types

```bash
npm run openapi:generate --workspace=backend     # writes docs/openapi.json
npm run api:types --workspace=business-web       # regenerates schema.d.ts
```

`src/api/business.ts` is hand-written on purpose: the contract owns the shapes,
that file records which endpoints this app touches.

## Not built yet

Profile, locations, services, opening hours, staff, reviews, payouts and
analytics all have endpoints and no screens. This slice is the daily loop only.
