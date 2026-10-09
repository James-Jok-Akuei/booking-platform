# Booking Platform

A service-booking marketplace. Customers book appointments with businesses
across non-delivery service categories; businesses manage their services,
availability and bookings; admins oversee the marketplace.

## Contents

| Path | What's there |
|---|---|
| [`apps/backend/`](apps/backend/) | NestJS + Prisma + PostgreSQL API — **[setup instructions](apps/backend/README.md)** |
| [`DECISIONS.md`](DECISIONS.md) | Every product & technical decision, with reasoning. Read this first. |
| [`apps/business-web/`](apps/business-web/) | The business app (Vite + React), :5174 |
| [`apps/customer-app/`](apps/customer-app/) | The customer app (Expo), web at :8081 |
| [`apps/admin-web/`](apps/admin-web/) | The admin portal (Vite + React), :5173 |
| [`apps/website/`](apps/website/) | The public site — the landing page (Vite + React), :5175 |

## Product overview

**Categories in scope:** Beauty & Personal Care, Health & Wellness, Photography &
Creative Services, Events, Home Services, Professional & Consulting, Automotive,
Pet Services. Medical/dental and catering are explicitly out of scope for MVP.

**Revenue model.** At booking time the customer pays a **deposit** — a percentage of
the service price. The flat platform fee (e.g. $1/appointment) is deducted from that
deposit **first**; the remainder goes to the business. The remaining balance is
settled directly between customer and business (cash or any method), or the customer
may pay in full online upfront. If the customer cancels or never pays the balance,
the deposit is non-refundable and the business is not owed the rest.

The point: the platform fee is always collected upfront, from money that already
moved through the platform — revenue never depends on businesses honestly reporting
completed appointments.

**Three apps, one backend.** Business, Customer and Admin frontends all talk to a
single NestJS backend backed by a single PostgreSQL database. They're separated by
role-based access (`BUSINESS` / `CUSTOMER` / `ADMIN` on the `User` model), not by
running three separate backends.

**Auth.** OTP-via-email only for MVP — no passwords. One email maps to exactly one
role. JWT access + refresh tokens with refresh token rotation.

**No in-app postponement.** Rescheduling is handled through in-app chat, and a
business can directly edit an appointment's date/time with no approval workflow.

See [`DECISIONS.md`](DECISIONS.md) for the full reasoning behind each of these.

## Quick start

```bash
# 1. Install all workspace dependencies from the repo root
npm install

# 2. Start Postgres + Mailhog
npm run docker:up

# 3. Configure the backend environment
cp apps/backend/.env.example apps/backend/.env

# 4. Create the database schema
npm run backend:prisma:generate
npm run -w apps/backend exec prisma migrate dev --name init

# 5. Run the API
npm run backend:dev
```

The API listens on `http://localhost:4100`. Mailhog's inbox — where OTP emails
land in development — is at `http://localhost:8025`.

Full backend detail, endpoint reference and design notes: [`apps/backend/README.md`](apps/backend/README.md).

## Build order

Auth (done) → **Business profile & services (next)** → Availability & scheduling →
Appointment state machine → Payments/deposits/wallet → Chat → Notifications →
Reviews & reporting → Admin portal.

## Repo layout

```
booking-platform/
├── apps/
│   └── backend/            # NestJS API
│       ├── prisma/         # schema + migrations
│       ├── src/
│       │   ├── auth/       # OTP auth, JWT, guards, strategies
│       │   ├── users/      # GET /users/me
│       │   ├── mail/       # SMTP / OTP delivery
│       │   ├── prisma/     # global PrismaService
│       │   └── common/     # shared decorators
│       └── docker-compose.yml
├── DECISIONS.md
├── package.json            # npm workspaces root
└── README.md
```
