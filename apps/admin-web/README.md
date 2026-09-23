# Admin console

The operations app: business approval, payout destination verification, ledger
review, settings. React + Vite + TypeScript, built to static files.

## Running it

```bash
# 1. the backend, in apps/backend
docker compose up -d
npm run start:dev            # http://localhost:3000

# 2. this app
npm install                  # from the repo root
npm run dev --workspace=admin-web   # http://localhost:5173
```

Vite proxies `/api/*` to `localhost:3000`, so the browser sees one origin and
CORS does not apply in development. Leave `VITE_API_URL` empty locally.

## Signing in

There is no password. Enter an admin's email, read the six-digit code, enter it.

In development the code is **not emailed anywhere reachable** unless SMTP is
configured — it is printed to the backend's log:

```bash
grep -oE "OTP for .*: [0-9]{6}" <backend log> | tail -1
```

`npm run seed:demo` in `apps/backend` creates `demo-admin@example.com` along
with businesses in every interesting state, including a `PENDING` one with no
name — which is what the "needs a name first" case in the queue looks like.

## Types

`src/api/schema.d.ts` is generated from the backend's contract and is committed.
Regenerate it after any change to a DTO or a route:

```bash
npm run openapi:generate --workspace=backend   # writes docs/openapi.json
npm run api:types --workspace=admin-web        # regenerates schema.d.ts
```

`src/api/admin.ts` is hand-written on purpose: the contract owns the shapes, and
that file records which of the backend's ninety endpoints this app actually
touches.

## Deploying

`npm run build` emits static files to `dist/`. Set `VITE_API_URL` to the
backend's origin at build time.

**Before it goes anywhere public**, the backend's `enableCors()` has to be
narrowed to this app's origin — it currently allows every origin, which is fine
behind a dev proxy and not fine in production.
