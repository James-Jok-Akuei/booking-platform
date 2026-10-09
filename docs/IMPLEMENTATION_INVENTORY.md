# Implementation Inventory

Audit of the booking-platform codebase as of commit `d24aba5` (2026-09-02).

**Method.** Everything below was read out of the source. Where `DECISIONS.md`
and the code disagree, the code is reported and the divergence is listed in
§12.2. Anything not verifiable from the source is marked *unclear* with the file
that would have to answer it.

---

## 1. Repository and stack

### 1.1 Layout

npm workspaces monorepo, `workspaces: ["apps/*"]`.

```
/                       package.json (workspace root), CLAUDE.md, DECISIONS.md, README.md
/apps/backend           the only app that exists
/docs                   this file
```

**There is no frontend.** `apps/` contains exactly one entry, `backend`. The root
`package.json` describes the repo as "monorepo (backend + web apps)" and
DECISIONS §4 plans three apps; none exist. No `packages/` directory, no shared
library.

### 1.2 Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 12 (`@nestjs/common ^12.0.1`) — **ESM-only** |
| Language | TypeScript 5.9 |
| Database | PostgreSQL (Docker compose at `apps/backend/docker-compose.yml`) |
| ORM | Prisma 5.22 (`@prisma/client`, `prisma`) |
| Auth | `@nestjs/jwt` 12, `passport` 0.7, `passport-jwt` 4 |
| Validation | `class-validator` 0.15, `class-transformer` 0.5 |
| Scheduling | `@nestjs/schedule` 12 |
| Realtime | `socket.io` 4.8 via `@nestjs/platform-socket.io` |
| Mail | `nodemailer` 9 |
| Object storage | `@aws-sdk/client-s3` 3 (Cloudflare R2 via S3 API) |
| Hashing | `bcrypt` 6 |
| Tests | Jest 30 + `ts-jest` 29, ESM mode |
| Node | engines `>=20`; local runtime is v24.1.0 |

### 1.3 Boot

`src/main.ts:7` — `NestFactory.create(AppModule)`, then `configureApp(app)`, then
listen on `process.env.PORT ?? 4100`.

`src/app-bootstrap.ts:14` — `configureApp` is the whole of the global
configuration and is deliberately shared with the boot smoke test so the test
cannot pass against a config `main.ts` no longer uses:

- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
- `app.enableCors()` — **wide open**, with an inline comment saying to tighten it
  before production (`app-bootstrap.ts:29`).

No global exception filter, interceptor or prefix is registered. `AppModule`
(`src/app.module.ts`) registers `ConfigModule.forRoot({ isGlobal: true })`,
`ScheduleModule.forRoot()`, `ServeStaticModule` serving `./uploads` at `/uploads`,
and 17 feature modules.

### 1.4 Tests

`jest.config.js`: ESM (`extensionsToTreatAsEsm`, `useESM: true`), `tsconfig.test.json`,
`testRegex: .*\.spec\.ts$`, `maxWorkers: 1`, `testTimeout: 30000`.

- `test/setup/env.ts` — `setupFiles`
- `test/setup/global-setup.ts` — creates the test database if absent then runs
  `npx prisma migrate deploy` against it, once per `npm test`
- `test/setup/test-module.ts` — `createTestModule(providers)` builds a targeted
  provider list rather than booting `AppModule`; always provides `PrismaService`,
  `LedgerService` and `PlatformSettingsService` (the last two real, not stubbed)
- `test/setup/e2e-app.ts` — `createE2eApp()` boots the real `AppModule` through
  `configureApp`, listens on an ephemeral port, then stops all cron jobs
- `test/setup/factories.ts` — fixture builders

`npm test` = `NODE_OPTIONS=--experimental-vm-modules jest`. Tests run against a
**real Postgres**, never a mocked Prisma. Current state: **538 tests, 14 suites,
all passing.**

---

## 2. Data model

Single Prisma schema, `prisma/schema.prisma`. 21 migrations, all hand-checked;
four contain raw SQL beyond plain DDL (§2.6).

### 2.1 Enums (complete)

| Enum | Values |
|---|---|
| `UserRole` | `BUSINESS`, `CUSTOMER`, `ADMIN` |
| `BusinessStatus` | `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` |
| `OtpPurpose` | `LOGIN` |
| `BusinessMemberRole` | `OWNER`, `MANAGER`, `STAFF` |
| `BusinessMemberStatus` | `ACTIVE`, `REMOVED` |
| `InvitationStatus` | `PENDING`, `ACCEPTED`, `REVOKED` |
| `ReporterType` | `CUSTOMER`, `BUSINESS` |
| `TicketCategory` | `PAYMENT_ISSUE`, `APPOINTMENT_DISPUTE`, `ACCOUNT_ISSUE`, `TECHNICAL_ISSUE`, `OTHER` |
| `TicketStatus` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` |
| `TicketAuthorType` | `REPORTER`, `ADMIN` |
| `BillingAdjustmentType` | `FEE_REFUND`, `GATEWAY_FEE_DEBIT` |
| `NotificationType` | 16 values — see §8 |
| `NotificationChannel` | `EMAIL`, `SMS` |
| `NotificationStatus` | `PENDING`, `SENT`, `FAILED` |
| `MediaType` | `PHOTO` |
| `MediaStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `AppointmentStatus` | `PENDING_PAYMENT`, `BOOKED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `CancelledBy` | `CUSTOMER`, `BUSINESS`, `SYSTEM_EXPIRY` |
| `PayoutStatus` | `PENDING`, `PAID`, `FAILED` |
| `LedgerEntryType` | `DEPOSIT_RECEIVED`, `PLATFORM_FEE`, `DEPOSIT_REFUND`, `PLATFORM_FEE_REVERSAL`, `GATEWAY_FEE_DEBIT`, `ADJUSTMENT` |

`NotificationChannel.SMS` exists in the enum but **no SMS channel is
implemented** — the only channel class is `EmailNotificationChannel`
(`src/notifications/channels/email-notification.channel.ts`).

`MediaStatus` has `PENDING`/`APPROVED`/`REJECTED` but **no moderation endpoint
exists** to move a photo between them (§11).

### 2.2 Identity and access

**`User`** (`users`)
- `id` uuid PK, `email` String @unique, `role UserRole`, `createdAt`, `updatedAt`
- `displayName String?` — review byline; null renders as `"Anonymous"` at read
  time and the literal is never written on a user's behalf (§31)
- **There is no name, phone or avatar field on User.** `displayName` is the only
  human-readable identifier besides `email`.
- Relations: memberships, sent invitations, appointments (as customer),
  cancelled appointments (as actor), notifications, threads, messages, read
  states, tickets (reported/assigned), ticket messages/attachments, created
  adjustments, reviews (author/hidden-by/responded-by), exchange-rate updates,
  refresh tokens, OTP codes.

**`OtpCode`** (`otp_codes`) — `email`, `codeHash` (bcrypt), `purpose`,
`attempts`, `maxAttempts @default(5)`, `expiresAt`, `consumedAt`, `userId?`.
Index `[email, purpose]`. Raw code never stored.

**`RefreshToken`** (`refresh_tokens`) — `userId`, `tokenHash @unique`,
`expiresAt`, `revokedAt?`. Raw token never stored.

**`BusinessMembership`** (`business_memberships`) — `userId`, `businessProfileId`,
`role`, `status @default(ACTIVE)`.
- `@@unique([userId, businessProfileId])` — one row per person per business,
  flipped between ACTIVE and REMOVED rather than duplicated
- **Partial unique index, hand-written**: at most one `ACTIVE` membership per
  user (§2.6)
- Indexes `[businessProfileId, status]`, `[userId, status]`

**`BusinessInvitation`** (`business_invitations`) — `businessProfileId`, `email`,
`role`, `invitedByUserId`, `status @default(PENDING)`, `expiresAt`.

### 2.3 Business catalogue

**`BusinessProfile`** (`business_profiles`) — `name?`, `description?`, `phone?`,
`categoryId?`, `subcategoryId?`, `logoUrl?`, `coverImageUrl?`,
`status BusinessStatus @default(PENDING)`, `rejectionReason?`. Indexes
`[categoryId]`, `[status]`.

**`Category`** / **`Subcategory`** — taxonomy, seeded by `prisma/seed.ts`.
`Subcategory` has `@@unique([categoryId, name])`.

**`Location`** (`locations`) — `businessId`, `name`, `address`, `latitude?`,
`longitude?`, `phone?`, `capacity Int @default(1)`,
`ratingAvg Decimal?(3,2)`, `ratingCount Int @default(0)`.
`ratingAvg`/`ratingCount` are **denormalised aggregates**, recomputed inside the
same transaction as any review write (`reviews.service.ts:436`).

**`LocationHours`** — `dayOfWeek Int` (0=Sunday, JS convention), `openTime`/
`closeTime` as `"HH:mm"` strings, `isClosed`. `@@unique([locationId, dayOfWeek])`.

**`Service`** (`services`) — `name`, `description?`, `priceCents Int`,
`durationMinutes Int`, `currency @default("USD")`,
`depositPercentage Decimal(5,2) @default(10.00)`, `isActive Boolean @default(true)`.
Services are **soft-deleted** (`isActive`), and `Appointment.serviceId` is
`onDelete: Restrict` so a booked service always resolves.

**`LocationMedia`**, **`LocationScheduleException`** (`@@unique([locationId, date])`),
**`LocationTimeBlock`** — gallery and schedule overrides.

### 2.4 The appointment

**`Appointment`** (`appointments`). Grouped by role:

*Identity and time*
- `locationId` (Cascade), `serviceId` (**Restrict**), `customerId` (Cascade)
- `startTime`, `endTime` — absolute instants; `endTime` is derived server-side
  from `durationMinutes`, never accepted from the client
  (`appointments.service.ts:194`)
- `status AppointmentStatus @default(PENDING_PAYMENT)`

*Money — SNAPSHOT, frozen at booking*
- `depositAmountCents`, `platformFeeAmountCents`, `businessAmountCents` — all
  `Int`, non-null. Permanent invariant: **fee + business == deposit**
- `servicePriceCents Int?`, `depositPercentage Decimal?(5,2)`,
  `platformFeePercentage Decimal?(5,2)` — the *inputs* those amounts came from,
  nullable with **no backfill** (§30)
- `currency @default("USD")`

*Provider payment — snapshot at charge time*
- `paymentProviderReferenceId?`, `paymentInitiatedAt?`
- `providerCurrency?`, `providerCurrencyAmountCents?`, `exchangeRateUsed Decimal?(18,8)`
- `depositPaidAt?` — written once in the `SUCCESSFUL` branch of
  `applyPaymentResult` (`appointments.service.ts:562`), never cleared

*Verification*
- `verificationCodeHash?` (bcrypt), `verificationAttempts Int @default(0)`, `verifiedAt?`

*Lifecycle timestamps*
- `completedAt?`, `cancelledAt?`, `noShowAt?`, `reminderSentAt?`

*Cancellation attribution (§33)*
- `cancelledBy CancelledBy?` — who **bears responsibility**
- `cancelledByUserId String?` — who **performed** the action (FK → User, SetNull)
- `cancellationReason String?`, `cancellationTicketId String?` (FK → Ticket, SetNull)

*Payout*
- `payoutHoldDaysApplied Int?` — the hold in force when this appointment
  resolved (§38)

Indexes: `[locationId, startTime]`, `[customerId, startTime]`,
`[status, endTime]`, `[status, createdAt]`.

**Live vs snapshot summary.** Everything under "Money" and "Provider payment" is
frozen at write. `Service.priceCents`, `Service.depositPercentage` and
`PlatformSetting.platformFeePercentage` are **live** and editable, which is
exactly why the snapshot columns exist.

### 2.5 Money: ledger, payouts, adjustments

**`LedgerEntry`** (`ledger_entries`) — the append-only record.
- `businessId` (Cascade), `appointmentId?` (**SetNull**), `billingAdjustmentId?` (SetNull)
- `type LedgerEntryType`
- `amountCents Int` — **SIGNED, from the business's perspective**: positive is
  owed to them, negative owed back
- `currency @default("USD")`
- `availableAt DateTime?` — null = not yet payable
- `payoutId String?` (FK → Payout, **SetNull**) — null = unsettled
- Indexes `[businessId, payoutId, availableAt]`, `[appointmentId]`
- **Immutability enforced by a database trigger** (§2.6)

**`Payout`** (`payouts`) — `businessId`, `amountCents`, `currency`,
`status PayoutStatus @default(PENDING)`, `reference?`, `failureReason?`,
`runAt`, `paidAt?`. Indexes `[businessId, status]`, `[status, runAt]`.
`amountCents` is a record of what a business was told; **the entries stamped with
the payout id remain the authority.**

**`BillingAdjustment`** (`billing_adjustments`) — `businessId`, `appointmentId?`,
`ticketId?`, `type BillingAdjustmentType`, `amount Decimal(12,2)` (**major
units, not cents**), `reason`, `settledAt?`, `settlementRef?`, `createdById`.
Index `[businessId, settledAt]`.

**`PlatformSetting`** (`platform_settings`) — single row, PK is the fixed
sentinel string `'platform'` (`PLATFORM_SETTING_ID`, `platform-settings.service.ts:29`).
See §9.

### 2.6 Database triggers, partial indexes and CHECK constraints

Four migrations contain SQL Prisma's DSL cannot express:

1. **`20260829220000_membership_partial_unique_active`**
   - A `DO $$ … RAISE EXCEPTION` pre-flight that refuses to migrate if any user
     already holds >1 ACTIVE membership
   - `CREATE UNIQUE INDEX business_memberships_active_userId_key ON business_memberships("userId") WHERE "status" = 'ACTIVE'`

2. **`20260831120000_chat_threads_messages`**
   - `CREATE UNIQUE INDEX threads_inquiry_customer_business_key ON threads("customerId","businessProfileId") WHERE "appointmentId" IS NULL` — exactly one inquiry thread per customer↔business pair
   - `CHECK (NULLIF(BTRIM("body"), '') IS NOT NULL OR "photoUrl" IS NOT NULL)` — a message must carry text or a photo

3. **`20260901090000_support_tickets`**
   - `CREATE SEQUENCE ticket_reference_seq` — human-quotable `TKT-000123`
     references generated inside the creating transaction

4. **`20260902230000_ledger_entries`**
   - `CREATE FUNCTION ledger_entries_reject_mutation()` + `CREATE TRIGGER
     ledger_entries_immutable BEFORE UPDATE ON ledger_entries FOR EACH ROW`.
     Rejects any change to `type`, `amountCents`, `currency`, `businessId`,
     `appointmentId`, `billingAdjustmentId`, `createdAt`, `id`. Only
     `availableAt` and `payoutId` remain writable.

Also: `20260902160000_reviews` adds `CHECK ("rating" >= 1 AND "rating" <= 5)` and
`CREATE UNIQUE INDEX reviews_appointmentId_key` (one review per appointment).

---

## 3. Modules

| Module | Owns | Services | Controllers | Depends on |
|---|---|---|---|---|
| `PrismaModule` | DB client | `PrismaService` | — | — |
| `AuthModule` | OTP login, JWT issue/refresh | `AuthService`, `JwtStrategy` | `AuthController` | Prisma, Mail, Config |
| `UsersModule` | own-account read, display-name moderation | `UsersService` | `UsersController`, `AdminUsersController` | Prisma, Notifications (@Global) |
| `StorageModule` | R2 / local-disk uploads | `StorageService` | — | Config |
| `CategoriesModule` | public taxonomy | — (controller uses Prisma directly) | `CategoriesController` | Prisma |
| `BusinessModule` | profile, locations, services, gallery, members | `BusinessProfileService`, `LocationsService`, `ServicesService`, `GalleryService`, `MembersService`, `BusinessAccessService` | `BusinessController`, `MembersController` | Prisma, Storage, Settings |
| `AvailabilityModule` | slot computation, schedule overrides | `AvailabilityService`, `ScheduleManagementService` | `AvailabilityController`, `ScheduleManagementController` | Prisma, Business |
| `SettingsModule` (**@Global**) | platform fee, exchange rate, payout hold | `PlatformSettingsService`, `ExchangeRateScheduler` | `AdminSettingsController` | Prisma, Notifications |
| `PaymentsModule` | MoMo provider, currency conversion | `MomoPaymentProvider` (via `PAYMENT_PROVIDER` token) | — | Config |
| `AppointmentsModule` | booking lifecycle, deposits | `AppointmentsService`, `AppointmentsScheduler`, `PaymentsScheduler` | `AppointmentsCustomerController`, `AppointmentsBusinessController`, `AppointmentsSharedController`, `AdminAppointmentsController` | Availability, Business, Mail, Chat, **Ledger** |
| `NotificationsModule` (**@Global**) | notification rows, dispatch, retry | `NotificationsService`, `NotificationsScheduler`, `EmailNotificationChannel` | `NotificationsController` | Prisma, Mail |
| `ChatModule` | threads, messages, realtime | `ChatService`, `ChatGateway` | `ChatController` | Prisma, Storage, Notifications |
| `TicketsModule` | support tickets, adjustments (creation) | `TicketsService`, `TicketsScheduler` | `TicketsController`, `AdminTicketsController` | Prisma, Storage, Notifications |
| `ReviewsModule` | reviews, responses, moderation | `ReviewsService` | `ReviewsCustomerController`, `ReviewsBusinessController`, `ReviewsPublicController`, `AdminReviewsController` | Business, Notifications |
| `AnalyticsModule` | business reporting | `AnalyticsService` | `AnalyticsController` | Prisma, Config |
| `LedgerModule` | ledger entries, refunds, adjustment execution, held total | `LedgerService` | `AdminLedgerController` | Prisma, Settings |
| `PayoutsModule` | payout runs, balances | `PayoutsService`, `PayoutsScheduler` | `AdminPayoutsController`, `BusinessPayoutsController` | Prisma |

`SettingsModule` and `NotificationsModule` are `@Global()`, so nothing imports
them explicitly.

**Notable dependency:** `AppointmentsModule` imports `LedgerModule`
(`appointments.module.ts`). `ChatModule` is imported by `AppointmentsModule` so a
booking can auto-create its thread; the reverse direction is broken by
`ChatGateway` implementing `OnModuleInit` and calling
`chat.registerRealtimePublisher(this)` rather than a DI cycle (§23.4/§23.3).

---

## 4. Full endpoint table

Guards are listed as applied. **Reach** describes who can actually get a 2xx.
"404-not-403" means a caller outside the tenant gets `NotFoundException` rather
than a permission error — the project-wide convention.

### 4.1 Auth — `src/auth/auth.controller.ts` (no guards at all)

| Method | Path | Guards | Roles | Reach | Purpose |
|---|---|---|---|---|---|
| POST | `/auth/otp/request` | none | — | anonymous | Send a 6-digit login OTP by email |
| POST | `/auth/otp/verify` | none | — | anonymous | Exchange OTP for access + refresh tokens |
| POST | `/auth/refresh` | none | — | anonymous (needs valid refresh token) | Rotate tokens |
| POST | `/auth/logout` | none | — | anonymous (needs refresh token) | Revoke a refresh token |

### 4.2 Users — `src/users/`

| Method | Path | Guards | Roles | Reach | Purpose |
|---|---|---|---|---|---|
| GET | `/users/me` | `JwtAuthGuard` (method-level) | — | any authenticated | Own account + active membership + `displayName` |
| PATCH | `/admin/users/:id/display-name/clear` | `JwtAuthGuard`, `RolesGuard` | ADMIN | admin | Clear a review byline; reason required; notifies the customer. **Service also asserts ADMIN** (`users.service.ts:38`) |

### 4.3 Categories — `src/categories/categories.controller.ts`

| Method | Path | Guards | Roles | Reach | Purpose |
|---|---|---|---|---|---|
| GET | `/categories` | none | — | anonymous | Full taxonomy with subcategories. Deliberately public |

### 4.4 Business profile & catalogue — `src/business/business.controller.ts`
Controller guards: `JwtAuthGuard, RolesGuard, BusinessRolesGuard` · `@Roles(BUSINESS)`

| Method | Path | `@BusinessRoles` | Reach | Purpose |
|---|---|---|---|---|
| GET | `/business/profile` | OWNER, MANAGER, STAFF | any active member | Own business profile |
| PATCH | `/business/profile` | OWNER, MANAGER | owner/manager | Update profile |
| POST | `/business/locations` | OWNER, MANAGER | owner/manager | Create a location |
| GET | `/business/locations` | OWNER, MANAGER, STAFF | any active member | List own locations |
| PATCH | `/business/locations/:id` | OWNER, MANAGER | owner/manager | Update a location |
| DELETE | `/business/locations/:id` | OWNER, MANAGER | owner/manager | Delete a location |
| PATCH | `/business/locations/:id/capacity` | OWNER, MANAGER | owner/manager | Set concurrent-booking capacity |
| POST | `/business/locations/:id/hours` | OWNER, MANAGER | owner/manager | Replace the weekly hours template |
| POST | `/business/locations/:id/gallery` | OWNER, MANAGER | owner/manager | Upload a photo (multipart, `file`) |
| GET | `/business/locations/:id/gallery` | OWNER, MANAGER, STAFF | any active member | List gallery photos |
| DELETE | `/business/locations/:id/gallery/:mediaId` | OWNER, MANAGER | owner/manager | Remove a photo |
| POST | `/business/services` | OWNER, MANAGER | owner/manager | Create a service |
| GET | `/business/services` | OWNER, MANAGER, STAFF | any active member | List own services |
| PATCH | `/business/services/:id` | OWNER, MANAGER | owner/manager | Update a service |
| DELETE | `/business/services/:id` | OWNER, MANAGER | owner/manager | Soft-delete (`isActive = false`) |

### 4.5 Members — `src/business/members.controller.ts`
Controller guards: `JwtAuthGuard, RolesGuard, BusinessRolesGuard` · `@Roles(BUSINESS)`

| Method | Path | `@BusinessRoles` | Reach | Purpose |
|---|---|---|---|---|
| POST | `/business/members/invite` | OWNER | owner only | Invite by email (7-day TTL) |
| GET | `/business/members` | OWNER, MANAGER, STAFF | any active member | List members |
| PATCH | `/business/members/:membershipId/role` | OWNER | owner only | Change a member's role (never the owner's) |
| DELETE | `/business/members/:membershipId` | OWNER | owner only | Set membership REMOVED |
| GET | `/business/invitations` | OWNER | owner only | List pending invitations |
| DELETE | `/business/invitations/:invitationId` | OWNER | owner only | Revoke an invitation |

### 4.6 Schedule overrides — `src/availability/schedule-management.controller.ts`
Controller guards: `JwtAuthGuard, RolesGuard, BusinessRolesGuard` · `@Roles(BUSINESS)`

| Method | Path | `@BusinessRoles` | Reach | Purpose |
|---|---|---|---|---|
| POST | `/business/locations/:id/schedule-exceptions` | OWNER, MANAGER | owner/manager | Add a holiday / custom-hours day |
| GET | `/business/locations/:id/schedule-exceptions` | OWNER, MANAGER, STAFF | any active member | List exceptions |
| DELETE | `/business/locations/:id/schedule-exceptions/:exceptionId` | OWNER, MANAGER | owner/manager | Remove an exception |
| POST | `/business/locations/:id/time-blocks` | OWNER, MANAGER | owner/manager | Block part of a day |
| GET | `/business/locations/:id/time-blocks` | OWNER, MANAGER, STAFF | any active member | List time blocks |
| DELETE | `/business/locations/:id/time-blocks/:blockId` | OWNER, MANAGER | owner/manager | Remove a block |

### 4.7 Availability (public) — `src/availability/availability.controller.ts`

| Method | Path | Guards | Roles | Reach | Purpose |
|---|---|---|---|---|---|
| GET | `/locations/:id/availability` | `OptionalJwtAuthGuard` | — | **anonymous**, or richer for a member | Bookable slots for a date. A non-`APPROVED` business is 404 to anyone who is not one of its members (`availability.service.ts:142`) |

### 4.8 Appointments — `src/appointments/`

**Customer controller** — `JwtAuthGuard, RolesGuard` · `@Roles(CUSTOMER)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| POST | `/appointments` | customer | Book. Computes and snapshots all money; creates a chat thread; emails a verification code |
| POST | `/appointments/:id/initiate-deposit-payment` | customer | Start the MoMo collection. Converts USD→provider currency at a fresh rate read |

**Business controller** — `JwtAuthGuard, RolesGuard, BusinessRolesGuard` · `@Roles(BUSINESS)`

| Method | Path | `@BusinessRoles` | Reach | Purpose |
|---|---|---|---|---|
| POST | `/business/appointments/:id/verify` | OWNER, MANAGER, **STAFF** | any active member | Enter the customer's arrival code → `IN_PROGRESS` |
| POST | `/business/appointments/:id/complete` | OWNER, MANAGER, **STAFF** | any active member | `IN_PROGRESS` → `COMPLETED`; releases ledger entries |
| POST | `/business/appointments/:id/no-show` | OWNER, MANAGER, **STAFF** | any active member | `BOOKED` → `NO_SHOW`; releases ledger entries |

**Shared controller** — `JwtAuthGuard` only (no `@Roles`)

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/appointments` | customer **or** business member | Scoped list. `findAll` enumerates the role explicitly and refuses anything else (`appointments.service.ts:1044`) |
| GET | `/appointments/:id` | the customer or an active member of its business (404 otherwise) | Detail. Adds `approxSettlement` only for the customer |
| GET | `/appointments/:id/payment-status` | either party | Queries the provider live and applies any resulting transition |
| POST | `/appointments/:id/cancel` | either party | Cancel. Reason required for a business; `gatewayChargeCents` required for a business cancelling a **paid** appointment |

**Admin** — `JwtAuthGuard, RolesGuard` · `@Roles(ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| PATCH | `/admin/appointments/:id/business-cancellation` | admin | Reclassify a dispute as a business cancellation and run the same refund path. **Service also asserts ADMIN** (`appointments.service.ts:886`) |

### 4.9 Reviews — `src/reviews/`

| Method | Path | Guards | Roles | Reach | Purpose |
|---|---|---|---|---|---|
| POST | `/appointments/:id/reviews` | `JwtAuthGuard, RolesGuard` | CUSTOMER | the appointment's customer, `COMPLETED` only | Leave a review; optional `displayName` written to `User` in the same transaction |
| PATCH | `/reviews/:id` | `JwtAuthGuard, RolesGuard` | CUSTOMER | the author, within 7 days | Edit rating/comment/displayName. **No delete exists** |
| POST | `/reviews/:id/response` | `JwtAuthGuard, RolesGuard, BusinessRolesGuard` | BUSINESS | any active member of the owning business | Post the single business reply |
| PATCH | `/reviews/:id/response` | same | BUSINESS | same, within 7 days of the response | Edit the reply |
| GET | `/locations/:id/reviews` | `OptionalJwtAuthGuard` | **anonymous** | Public listing. Public viewers get `displayName` only; owning business and admins additionally get `{id, email}` |
| PATCH | `/admin/reviews/:id/hide` | `JwtAuthGuard, RolesGuard` | ADMIN | admin | Soft-hide with a required reason; recomputes the rating |
| PATCH | `/admin/reviews/:id/unhide` | same | ADMIN | admin | Restore |

### 4.10 Chat — `src/chat/chat.controller.ts`
Controller guard: `JwtAuthGuard` (no controller-level `@Roles`)

| Method | Path | Extra guards | Reach | Purpose |
|---|---|---|---|---|
| POST | `/threads/inquiry` | `RolesGuard` + `@Roles(CUSTOMER)` | customer | Open (or return) the one inquiry thread with a business |
| GET | `/threads` | — | customer or business member | List own threads |
| GET | `/threads/:id` | — | participants only | Thread detail |
| GET | `/threads/:id/messages` | — | participants only | Paginated messages |
| POST | `/threads/:id/messages` | — | participants only | Send text and/or a photo (multipart `photo`) |
| POST | `/threads/:id/read` | — | participants only | Mark read |

`ChatService.participantScope` (`chat.service.ts:432`) throws
`ForbiddenException` for any role that is not `CUSTOMER` or `BUSINESS` — an
**ADMIN token cannot reach chat**.

**WebSocket:** `ChatGateway`, namespace `/chat`, `cors: { origin: '*' }`
(`chat.gateway.ts:47-51`). JWT is read from the socket handshake `auth` payload,
not a query string. Events: `thread:join`, `thread:leave`, `thread:read`. There
is deliberately **no send-via-socket event** — sending is REST only.

### 4.11 Tickets — `src/tickets/`

**Reporter controller** — `JwtAuthGuard, RolesGuard` · `@Roles(CUSTOMER, BUSINESS)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| POST | `/tickets` | customer or business | Raise a ticket (optional attachment) |
| GET | `/tickets` | reporter, or any member of the reporting business | Own tickets |
| GET | `/tickets/:id` | same | Ticket detail; internal notes filtered out |
| POST | `/tickets/:id/messages` | same | Reply (optional attachment) |
| POST | `/tickets/:id/reopen` | reporter only, within 14 days of `resolvedAt` | `RESOLVED` → `IN_PROGRESS` |

**Admin controller** — `JwtAuthGuard, RolesGuard` · `@Roles(ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/admin/tickets` | admin | Queue, filterable. **Service also asserts ADMIN** (`tickets.service.ts:265`) |
| GET | `/admin/tickets/:id` | admin | Full detail including internal notes |
| PATCH | `/admin/tickets/:id/assign` | admin | Assign to an admin |
| PATCH | `/admin/tickets/:id/status` | admin | Transition; may attach a `BillingAdjustment` |
| POST | `/admin/tickets/:id/messages` | admin | Reply or internal note (`isInternal`) |

### 4.12 Notifications — `src/notifications/notifications.controller.ts`
Controller guard: `JwtAuthGuard`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/notifications` | any authenticated (own only) | Own inbox, paginated |
| PATCH | `/notifications/read-all` | any authenticated | Mark all own read |
| PATCH | `/notifications/:id/read` | any authenticated (own only) | Mark one read |

### 4.13 Analytics — `src/analytics/analytics.controller.ts`
Guards: `JwtAuthGuard, RolesGuard` · `@Roles(BUSINESS, ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/businesses/:id/analytics` | admin (any business) or a member of that business | Counts by status, rates, money, review stats, busiest periods. **Service asserts scope** via `assertMayRead` (`analytics.service.ts:116`) |

### 4.14 Payouts and balances — `src/payouts/payouts.controller.ts`

**Admin** — `JwtAuthGuard, RolesGuard` · `@Roles(ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| POST | `/admin/payouts/run` | admin | Trigger a payout run now |
| GET | `/admin/payouts` | admin | List payouts, filterable by business/status |
| PATCH | `/admin/payouts/:id/mark-paid` | admin | Record a transfer; **`reference` required** |
| PATCH | `/admin/payouts/:id/mark-failed` | admin | **Unstamps its entries** back into the pool; `reason` required |

All four also assert ADMIN in `PayoutsService` (`payouts.service.ts:363`).

**Business-facing** — `JwtAuthGuard, RolesGuard` · `@Roles(BUSINESS, ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/businesses/:id/balance` | admin (any) or a member of that business | Available now / pending / unresolved / lifetime paid — all summed on read |
| GET | `/businesses/:id/payouts` | same | That business's payouts, paginated |

Both assert scope via `assertMayRead` (`payouts.service.ts:370`) — **404, not 403**.

### 4.15 Ledger and adjustments — `src/ledger/admin-ledger.controller.ts`
Guards: `JwtAuthGuard, RolesGuard` · `@Roles(ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/admin/ledger/held` | admin | Total unsettled entries by currency — the reconciliation figure |
| PATCH | `/admin/billing-adjustments/:id/execute` | admin | Turn a recorded adjustment into a signed ledger entry; once only |

Both assert ADMIN **in the controller body** (`admin-ledger.controller.ts:67`),
not in the service — see §5.5.

### 4.16 Settings — `src/settings/admin-settings.controller.ts`
Guards: `JwtAuthGuard, RolesGuard` · `@Roles(ADMIN)`

| Method | Path | Reach | Purpose |
|---|---|---|---|
| GET | `/admin/settings/platform-fee` | admin | Current fee |
| PATCH | `/admin/settings/platform-fee` | admin | Change fee (future bookings only) |
| GET | `/admin/settings/exchange-rate` | admin | Rate, age, who set it, staleness flag + warning |
| PATCH | `/admin/settings/exchange-rate` | admin | Set the rate; records the acting admin |
| PATCH | `/admin/settings/exchange-rate/staleness` | admin | Change the staleness threshold |
| GET | `/admin/settings/payout-hold` | admin | Current hold. **Service asserts ADMIN** |
| PATCH | `/admin/settings/payout-hold` | admin | Change the hold. **Service asserts ADMIN** |

Only the two payout-hold methods assert the role in the service; the fee and
exchange-rate methods are **guard-only** (§5.5, §12.2).

### 4.17 Static

`GET /uploads/*` — `ServeStaticModule`, `index: false`, `fallthrough: false`.
Serves the local-disk upload fallback. Unauthenticated.

---

## 5. Auth and access model

### 5.1 Token issue and verification

Login is **OTP-only** — there is no password field anywhere.

1. `POST /auth/otp/request` → `AuthService.requestOtp`. Generates a 6-digit code
   with `crypto.randomInt` (`auth.service.ts:120`), bcrypt-hashes it
   (`BCRYPT_ROUNDS = 10`), stores an `OtpCode` row, emails the raw code.
   - `OTP_EXPIRES_IN_MINUTES` default **10**
   - `OTP_MAX_ATTEMPTS` default **5**
   - `OTP_RESEND_COOLDOWN_SECONDS` default **60**
   - `OTP_MAX_REQUESTS_PER_HOUR` default **5**
2. `POST /auth/otp/verify` → bcrypt-compares, marks `consumedAt`, issues tokens.
3. Tokens are signed with **two separate secrets**: `JWT_ACCESS_SECRET`
   (default TTL `15m`) and `JWT_REFRESH_SECRET` (default `30d`)
   (`auth.service.ts:319-327`). Payload is `{ sub, email, role }`.
4. Refresh tokens are stored **hashed** (`RefreshToken.tokenHash @unique`) and
   can be revoked.
5. `JwtStrategy` (`jwt.strategy.ts`) extracts a bearer token, `ignoreExpiration:
   false`, and maps the payload to `{ userId, email, role }` as `request.user`.

**The role is read from the token, not the database, on every request.** A role
change would not take effect until the access token expires. Nothing re-reads
`User.role` in the guard chain.

### 5.2 Guards

| Guard | File | What it does |
|---|---|---|
| `JwtAuthGuard` | `auth/guards/jwt-auth.guard.ts` | Bare `AuthGuard('jwt')`. Rejects anything that is not a valid token |
| `OptionalJwtAuthGuard` | `auth/guards/optional-jwt-auth.guard.ts` | Same strategy, but `handleRequest` returns `undefined` instead of throwing. A **bad token is treated exactly like no token** — it can never authenticate anyone |
| `RolesGuard` | `auth/guards/roles.guard.ts` | Reads `@Roles(...)` metadata; **returns `true` when the decorator is absent** |
| `BusinessRolesGuard` | `business/guards/business-roles.guard.ts` | Resolves the caller's ACTIVE membership (403 if none), attaches `{membershipId, businessId, role}` to the request, then enforces `@BusinessRoles(...)`. **No declaration means "any active member"** |

`OptionalJwtAuthGuard` is used on exactly two routes:
`GET /locations/:id/availability` and `GET /locations/:id/reviews`.

### 5.3 The business-membership model

A `BUSINESS` user reaches their `BusinessProfile` **only** through
`BusinessMembership` — there is no direct relation. The relation is a **list**
because `REMOVED` rows accumulate as history; at most one is `ACTIVE`, enforced
by the partial unique index. Callers wanting "the business this person works in"
must filter to ACTIVE. `BusinessAccessService.requireActiveMembership`
(`business-access.service.ts:32`) is the single place that does so.

### 5.4 Query scoping in services

Cross-tenant safety is carried by **scoping the query**, not by filtering after
the fact:

- `AppointmentsService.requireBusinessAppointment` (`:1103`) — resolves the
  caller's business, then queries the appointment with that business in the
  `where`. Another tenant's appointment simply never matches → 404.
- `AppointmentsService.requireParticipantAppointment` (`:1125`) — customer match
  first, else an ACTIVE-membership count on the owning business; 404 otherwise.
- `ChatService.requireParticipant` (`:446`) — same shape for threads.
- `ReviewsService.requireBusinessReview` (`:274`) — `where: { id, businessId }`.
- `PayoutsService.assertMayRead` (`:370`) and `AnalyticsService.assertMayRead`
  (`:116`) — admin passes; otherwise an ACTIVE-membership count, else **404**.
- `ReviewsService.listForLocation` and `AvailabilityService` — non-`APPROVED`
  businesses are 404 to non-members.

### 5.5 Guard-only vs guard + service assertion

**Guard plus service-level assertion** (the §27.1 two-layer rule):
`/admin/tickets` listing, `/admin/users/:id/display-name/clear`,
`/admin/appointments/:id/business-cancellation`, all four `/admin/payouts/*`,
both `/businesses/:id/{balance,payouts}`, `/businesses/:id/analytics`,
`/admin/settings/payout-hold` (GET and PATCH), and chat/appointment/review/ticket
scoping as above.

**Controller-body assertion** (not in the service): `/admin/ledger/held` and
`/admin/billing-adjustments/:id/execute` assert ADMIN inside
`AdminLedgerController` (`:67`). Functionally two-layer, structurally different
from the rest.

**Guard only — no service-level role check:**
- `/admin/settings/platform-fee` (GET and PATCH)
- `/admin/settings/exchange-rate` (GET, PATCH, and `/staleness` PATCH)
- `/admin/reviews/:id/hide` and `/unhide` — `ReviewsService.hide/unhide` take an
  `adminId` but never verify the caller is an admin
- `/admin/tickets/:id/{assign,status,messages}` — only the listing asserts
- The entire `/business/**` surface relies on `BusinessRolesGuard`; the
  underlying services take a resolved `businessId` and do not re-check the role

This is logged as outstanding in DECISIONS §38.4 for settings; the reviews and
ticket-mutation cases are **not** logged anywhere.

---

## 6. The money path, end to end

**Unit of account: USD integer cents everywhere** (`INTERNAL_CURRENCY`,
`payments/currency.ts:12`). Percentages are `Prisma.Decimal`. No float arithmetic
touches money.

### 6.1 Booking → payout (the happy path)

1. **`AppointmentsService.create`** (`appointments.service.ts:187`)
   - Loads the `Service` (price, `depositPercentage`, duration) and the
     `Location`; verifies they belong to the same business; verifies the service
     is active.
   - `endTime` is derived from `durationMinutes` — never taken from the client
     (`:194`).
   - Reads the **live** `platformFeePercentage` from settings (`:198`).
   - `computeAppointmentAmounts(priceCents, depositPercentage, platformFeePercentage)`
     (`appointment-pricing.ts:39`):
     ```
     deposit     = round_half_up(price × depositPct  / 100)
     platformFee = round_half_up(price × platformPct / 100)
     business    = deposit − platformFee        // by SUBTRACTION, never re-rounded
     ```
     Both percentages apply to the **service price**, not to each other. The
     invariant `platformFee + business == deposit` holds exactly by construction.
   - Inside one transaction: writes the appointment with `status =
     PENDING_PAYMENT`, the three amounts, **and the three snapshot inputs**
     (`servicePriceCents`, `depositPercentage`, `platformFeePercentage`), plus a
     bcrypt-hashed 6-digit verification code.
   - Then (outside the transaction): emails the verification code, creates the
     chat thread, notifies the business `APPOINTMENT_BOOKED`.
   - **No ledger entry yet.** Nothing has been paid.

2. **`AppointmentsService.initiateDepositPayment`** (`:356`)
   - Refuses if a payment reference is already outstanding.
   - Reads the exchange rate **once** (`:372`). If unset → `BadRequestException`,
     deliberately fatal. If the conversion rounds to `<= 0` → also fatal.
   - `convertUsdCentsToProviderCents(depositAmountCents, rate)` — `Decimal`
     multiply, `ROUND_HALF_UP` at the single rounding point.
   - Calls `PaymentProvider.initiatePayment` (MoMo `requesttopay`).
   - On acceptance, writes `paymentProviderReferenceId`, `paymentInitiatedAt`,
     and the **snapshot trio** `providerCurrency`,
     `providerCurrencyAmountCents`, `exchangeRateUsed`.
   - The *same* `rate` variable both computes the charge and is persisted, so
     the charged and recorded rates cannot differ.

3. **Confirmation — `AppointmentsService.applyPaymentResult`** (`:553`)
   - Single transaction:
     - `updateMany` conditional on `status = PENDING_PAYMENT` **and** the same
       reference → `status = BOOKED`, `depositPaidAt = now`.
     - If and only if `count > 0`, `LedgerService.recordDepositReceived(tx, id)`.
   - That conditional update is what makes ledger writes **exactly-once**: a
     repeated confirmation matches no row, so no entries follow.
   - `recordDepositReceived` (`ledger.service.ts:53`) appends **two** entries,
     both `availableAt: null`:

     | Type | Amount |
     |---|---|
     | `DEPOSIT_RECEIVED` | `+depositAmountCents` |
     | `PLATFORM_FEE` | `−platformFeeAmountCents` |

     Net = `businessAmountCents` by construction.

4. **Resolution → money becomes payable.** `LedgerService.releaseOnResolution`
   (`ledger.service.ts:116`) is called inside the same transaction as every
   status change that resolves an appointment: `complete()`, `noShow()`,
   `cancel()`, and the auto-transition sweep.
   - Reads `payoutHoldDays` **at resolution time** and records it on the
     appointment as `payoutHoldDaysApplied`.
   - Anchors (`availableAtFor`, `ledger.service.ts:377`):

     | Outcome | `availableAt` |
     |---|---|
     | `COMPLETED` | `completedAt` + hold |
     | `NO_SHOW` | **scheduled `endTime`** + hold |
     | `CANCELLED` by `CUSTOMER` with `depositPaidAt` set | **scheduled `endTime`** + hold |
     | `CANCELLED` by `BUSINESS` | nothing released here — a refund is owed |
     | `SYSTEM_EXPIRY`, never paid | no entries exist at all |
   - Idempotent: only touches entries where `availableAt IS NULL AND payoutId IS NULL`.

5. **`PayoutsService.run`** (`payouts.service.ts:44`)
   - `groupBy(businessId)` over entries where `payoutId IS NULL AND availableAt <= now`.
   - Sum `<= 0` → **no payout created, entries left unstamped**, so the negative
     carries forward and nets against future earnings.
   - Sum `> 0` → `payOne` in one transaction: re-select the entries, refuse a
     multi-currency set, create the `Payout` as `PENDING`, then `updateMany`
     stamping `payoutId` **conditional on `payoutId` still being null**. If the
     stamped count ≠ the selected count, the whole transaction is rolled back
     (`ConflictException`, caught and logged) — that is the concurrency guard.
   - **No provider transfer is called.** A human sends the money.

6. **`markPaid`** records `status = PAID`, a required `reference`, and `paidAt`.
   **`markFailed`** records `status = FAILED` with a required reason and, in the
   same transaction, sets `payoutId = null` on every entry it held so the next
   run picks them up.

7. **Export: none.** There is no CSV, spreadsheet or download endpoint anywhere
   in `src` (verified by search). Reconciliation is `GET /admin/ledger/held`,
   which returns JSON totals by currency.

### 6.2 Business cancellation → refund

`AppointmentsService.cancel` with the caller being a business member and
`depositPaidAt` set (`appointments.service.ts:775`):

- `reason` is required; **`gatewayChargeCents` is also required** and is refused
  if absent — the value is supplied, never derived.
- One transaction: the status/attribution update, then
  `LedgerService.recordBusinessCancellationRefund` (`ledger.service.ts:186`),
  which appends three entries with `availableAt = now`:

  | Type | Amount |
  |---|---|
  | `DEPOSIT_REFUND` | `−depositAmountCents` |
  | `PLATFORM_FEE_REVERSAL` | `+platformFeeAmountCents` |
  | `GATEWAY_FEE_DEBIT` | `−gatewayChargeCents` |

  The first two net to exactly `−businessAmountCents`, cancelling the booking
  pair. The customer is made whole **including the platform fee** — the platform
  gives up its own cut. The business's net position for the appointment becomes
  exactly `−gatewayChargeCents`.
- The original deposit pair is released at the same moment (`availableAt = now`),
  so the whole appointment is settled together.
- Refunding twice is refused: the method counts existing `DEPOSIT_REFUND` rows
  and throws `ConflictException`.

**Admin dispute path** — `reclassifyAsBusinessCancellation`
(`appointments.service.ts:876`) sets `cancelledBy = BUSINESS`,
`cancelledByUserId = the admin`, `cancellationTicketId`, and calls **the same**
refund method. Tested to produce identical entry shapes.

### 6.3 Customer cancellation and no-show

Both append **nothing**. The existing `DEPOSIT_RECEIVED` / `PLATFORM_FEE` pair is
simply released at `endTime + hold`. The deposit is non-refundable (§2), so the
business keeps `businessAmountCents` and the platform keeps its fee. No gateway
debit arises because no refund is processed.

### 6.4 Billing adjustment

`LedgerService.executeAdjustment` (`ledger.service.ts:278`):
- Refuses if `settledAt` is already set (`ConflictException`) — once only.
- `amount` is `Decimal` **major units**; converted with
  `new Prisma.Decimal(amount).mul(100).toDecimalPlaces(0, ROUND_HALF_UP)`.
- Sign by type: `FEE_REFUND` → **positive**, `GATEWAY_FEE_DEBIT` → **negative**.
- Writes one `ADJUSTMENT` entry with `availableAt = now` and
  `billingAdjustmentId` set, then stamps `settledAt` + `settlementRef`.

### 6.5 Sign convention (summary)

All `LedgerEntry.amountCents` are signed **from the business's perspective**.

| Type | Sign |
|---|---|
| `DEPOSIT_RECEIVED` | + |
| `PLATFORM_FEE` | − |
| `DEPOSIT_REFUND` | − |
| `PLATFORM_FEE_REVERSAL` | + |
| `GATEWAY_FEE_DEBIT` | − |
| `ADJUSTMENT` | + for `FEE_REFUND`, − for `GATEWAY_FEE_DEBIT` |

**A business balance is always `SUM(amountCents)`.** There is no balance column
anywhere in the schema, and §34.2 states there must never be one.

### 6.6 Customer-facing currency display (§39)

`AppointmentsService.rateContext()` reads the rate **once per response** via
`PlatformSettingsService.getExchangeRateForDisplay()` (a quiet read that does not
raise the missing-row alarm). `withApproxSettlement` attaches an
`approxSettlement` map keyed by USD field name, rounded to whole local-currency
units. Applied to `create`, `findAll` (CUSTOMER role only), `findOne` and
`cancel` (customer only). Never persisted; rejected as input by
`forbidNonWhitelisted`.

---

## 7. Scheduled jobs

Eight cron jobs. `ScheduleModule.forRoot()` in `AppModule`; `createE2eApp()` stops
them all after boot, and the boot smoke test leaves them running.

| Name | Cadence | File | What it does | Mutates |
|---|---|---|---|---|
| `payment-confirmation-poll` | every 20s (`*/20 * * * * *`) | `appointments/payments.scheduler.ts:54` | Polls the provider for `PENDING_PAYMENT` appointments with a reference | via `applyPaymentResult`: `status`, `depositPaidAt`, ledger entries, notifications |
| `pending-payment-expiry` | every 60s (`0 * * * * *`) | `appointments/payments.scheduler.ts:119` | Releases unpaid holds past `PENDING_PAYMENT_TTL_MS` (5 min). Re-checks the provider first and "rescues" a late success | `status = CANCELLED`, `cancelledAt`, `cancelledBy = SYSTEM_EXPIRY`, `cancelledByUserId = null`; notifications |
| `appointment-auto-transition` | every 15 min (`0 */15 * * * *`) | `appointments/appointments.scheduler.ts:38` | 24h after `endTime`: `IN_PROGRESS → COMPLETED`, `BOOKED → NO_SHOW`. Never invents a COMPLETED from BOOKED | `status`, `completedAt`/`noShowAt`, **and releases ledger entries in the same transaction** |
| `appointment-reminders` | every 15 min (`0 */15 * * * *`) | `notifications/notifications.scheduler.ts:33` | Sends `APPOINTMENT_REMINDER` ~24h ahead (`REMINDER_LEAD_TIME_MS`) | `reminderSentAt`; creates notifications |
| `notification-retry` | every 5 min (`0 */5 * * * *`) | `notifications/notifications.scheduler.ts:99` | Retries `FAILED`/`PENDING` notifications up to `MAX_NOTIFICATION_ATTEMPTS` (5) | `Notification.status`, `failureCount`, `lastError`, `sentAt` |
| `ticket-auto-close` | daily 03:00 (`0 0 3 * * *`) | `tickets/tickets.scheduler.ts:25` | Closes `RESOLVED` tickets past the 14-day window | `Ticket.status = CLOSED`, `closedAt` |
| `payout-run` | daily 02:00 (`EVERY_DAY_AT_2AM`) | `payouts/payouts.scheduler.ts:23` | Runs `PayoutsService.run()` | Creates `Payout` rows; stamps `LedgerEntry.payoutId` |
| `exchange-rate-staleness` | hourly (`EVERY_HOUR`) | `settings/exchange-rate.scheduler.ts:32` | Notifies every admin when the rate is past its threshold, debounced to once a day | `PlatformSetting.exchangeRateStaleNotifiedAt`; creates notifications |

---

## 8. Notifications

`NotificationsService.notify` writes a `Notification` row with **rendered**
`subject` and `body` (`notification-templates.ts:renderNotification`) and
dispatches through `EmailNotificationChannel`. Copy is rendered once at send time
and stored, so the inbox always shows what was actually sent — re-rendering
against live data would let a later change rewrite history.

`NotificationsService.notifyBusiness` fans out to every ACTIVE member.
`notifyAdmins` (in `TicketsService` and `ExchangeRateScheduler`) fans out to
every `role = ADMIN` user.

| Type | Trigger | Recipients |
|---|---|---|
| `APPOINTMENT_BOOKED` | `AppointmentsService.create` (`:294`) | business members |
| `DEPOSIT_CONFIRMED` | `applyPaymentResult` success (`:596`) | both parties |
| `DEPOSIT_FAILED` | `applyPaymentResult` failure (`:623`) | customer only |
| `APPOINTMENT_CANCELLED` | `cancel()` (`:856`), `reclassifyAsBusinessCancellation` (`:948`), expiry sweep (`payments.scheduler.ts:190`) | both parties |
| `APPOINTMENT_NO_SHOW` | `noShow()` (`:753`) | customer only |
| `APPOINTMENT_REMINDER` | reminder sweep (`notifications.scheduler.ts:71`) | customer |
| `BUSINESS_INVITATION` | `MembersService` invite (`:136`, `:142` — registered and unregistered paths) | invitee |
| `NEW_MESSAGE` | `ChatService` (`:373`), debounced by `MESSAGE_NOTIFICATION_DEBOUNCE_MS` (5 min) | the other participant |
| `TICKET_CREATED` | `TicketsService.create` (`:135`) | all admins |
| `TICKET_MESSAGE` | ticket replies (`:678`, `:689`, `:695`) — **never for internal notes** | reporter / business / admins |
| `TICKET_STATUS_CHANGED` | status transition (`:515`) | reporter |
| `REVIEW_CREATED` | `ReviewsService.create` (`:143`) | business members |
| `REVIEW_RESPONSE` | `ReviewsService.respond` (`:245`) | review author |
| `REVIEW_HIDDEN` | `ReviewsService.hide` (`:334`, `:337`) | author **and** business |
| `DISPLAY_NAME_CLEARED` | `UsersService.clearDisplayName` (`:57`) | the customer |
| `EXCHANGE_RATE_STALE` | staleness sweep (`exchange-rate.scheduler.ts:55`) | all admins |

Channel: `EMAIL` only. `NotificationChannel.SMS` exists in the enum with no
implementation.

---

## 9. Settings

All live on the single `PlatformSetting` row (`id = 'platform'`). All are
admin-only, API-only — **there is no admin UI**.

| Setting | Type | Default | Range | Changed by | If unset / missing |
|---|---|---|---|---|---|
| `platformFeePercentage` | `Decimal(5,2)` | `10.00` | 0–100, ≤2 dp | `PATCH /admin/settings/platform-fee` | Row missing → falls back to the documented default rather than failing every booking (`platform-settings.service.ts:66`). **Cached in-process for 30 s** (`CACHE_TTL_MS`, `:44`) |
| `payoutHoldDays` | `Int` | **2** | 0–30 (`MIN/MAX_PAYOUT_HOLD_DAYS`) | `PATCH /admin/settings/payout-hold` | Falls back to `DEFAULT_PAYOUT_HOLD_DAYS` (2) |
| `providerCurrency` | `String` | `"EUR"` | 3-letter ISO 4217 | `PATCH /admin/settings/exchange-rate` (optional field) | Defaults to `EUR`; supersedes any `MOMO_CURRENCY` env var |
| `exchangeRateUsdToProviderCurrency` | `Decimal(18,8)?` | **null** | `> 0`, ≤8 dp | `PATCH /admin/settings/exchange-rate` | **Deposit payment initiation fails outright** with a 400 (`appointments.service.ts:373`). Customer-facing `approxSettlement` is silently omitted. Nothing else breaks |
| `exchangeRateStalenessHours` | `Int` | `24` | 0–720 | `PATCH /admin/settings/exchange-rate/staleness` | Falls back to `DEFAULT_STALENESS_HOURS` (24) |
| `exchangeRateUpdatedAt` / `exchangeRateUpdatedById` / `exchangeRateStaleNotifiedAt` | timestamps / FK | null | — | written as a side effect of the above | Age reporting shows null; an unset rate is reported as `configured: false`, **not** stale |

Everything else that looks configurable is a **code constant**, not a setting —
see §10.3.

---

## 10. Enforced business rules

### 10.1 Appointment state machine

There is no declarative transition table for appointments (unlike tickets); the
rules live in guard clauses inside `AppointmentsService`.

| From | To | Via | Enforced at |
|---|---|---|---|
| `PENDING_PAYMENT` | `BOOKED` | `applyPaymentResult('SUCCESSFUL')` | conditional `updateMany` on status + reference (`:534`) |
| `PENDING_PAYMENT` | `CANCELLED` | `cancel()`, or the expiry sweep | `cancellable` list (`:779`); sweep is conditional on status |
| `BOOKED` | `IN_PROGRESS` | `verify()` | rejects unless `status === BOOKED` (`verify()`, `:639`) |
| `BOOKED` | `NO_SHOW` | `noShow()` or the auto sweep | rejects unless `BOOKED` (`noShow()`, `:721`) |
| `BOOKED` | `CANCELLED` | `cancel()` | `cancellable` list |
| `IN_PROGRESS` | `COMPLETED` | `complete()` or the auto sweep | rejects unless `IN_PROGRESS` (`complete()`, `:691`) |
| any except `COMPLETED` | `CANCELLED` | `reclassifyAsBusinessCancellation()` (admin) | rejects `COMPLETED` and already-`BUSINESS`-cancelled (`:893-903`) |

Hard rules:
- **`COMPLETED` is unreachable from `BOOKED`.** Completion requires verification;
  the auto sweep never invents a COMPLETED from a BOOKED either.
- `IN_PROGRESS` and `COMPLETED` cannot be cancelled.
- A verified appointment cannot be marked a no-show.
- `MAX_VERIFICATION_ATTEMPTS = 5` (`appointments.service.ts:50`).

The admin reclassification is the **only** path that writes `CANCELLED` from a
non-cancellable state.

### 10.2 Ticket state machine

Declarative — `TICKET_TRANSITIONS` (`tickets/ticket-status.ts:26`). Anything not
listed throws.

| From | To | Permitted actors |
|---|---|---|
| `OPEN` | `IN_PROGRESS` | ADMIN |
| `IN_PROGRESS` | `RESOLVED` | ADMIN |
| `RESOLVED` | `IN_PROGRESS` | **REPORTER only** (an admin reopening their own resolution would defeat the window) |
| `RESOLVED` | `CLOSED` | ADMIN, SYSTEM (the sweep) |

`resolutionNote` is required to reach `RESOLVED`.

### 10.3 Every threshold and where it comes from

| Value | Current | Source | File |
|---|---|---|---|
| Payout hold | **2 days** | **admin setting** | `platform-settings.service.ts:23` (default) |
| Exchange-rate staleness threshold | **24 h** | **admin setting** | `platform-settings.service.ts:14` (default) |
| Stale reminder interval | 24 h | constant | `settings/exchange-rate.scheduler.ts:9` |
| Platform fee | 10.00 % | **admin setting** | `PlatformSetting.platformFeePercentage` |
| Review edit window | **7 days** | constant | `reviews/review-window.ts:2` |
| Ticket reopen / auto-close window | **14 days** | constant | `tickets/ticket-status.ts:4` |
| Appointment auto-transition grace | **24 h** after `endTime` | constant | `appointments/appointments.scheduler.ts:8` |
| Pending-payment TTL | **5 min** | constant | `appointments/payments.scheduler.ts:20` |
| Reminder lead time | **24 h** | constant | `notifications/notifications.scheduler.ts:8` |
| Max notification attempts | 5 | constant | `notifications/notifications.service.ts:17` |
| Max verification attempts | 5 | constant | `appointments/appointments.service.ts:50` |
| Invitation TTL | 7 days | constant | `business/members.service.ts:21` |
| Gallery photos per location | 30 | constant | `business/gallery.service.ts:15` |
| Inquiry threads per customer per day | 10 | constant | `chat/chat.service.ts:21` |
| Chat notification debounce | 5 min | constant | `chat/chat.service.ts:24` |
| Analytics default range | 30 days | constant | `analytics/analytics.service.ts:17` |
| Analytics max range | 365 days | constant | `analytics/analytics.service.ts:18` |
| Slot grid | 15 min | constant | `availability/time.util.ts:18` |
| Max upload size | 15 MB | constant | `storage/storage.service.ts:13` |
| Allowed upload types | jpg, jpeg, png, webp | constant | `storage/storage.service.ts:16` |
| OTP expiry / attempts / cooldown / hourly cap | 10 min / 5 / 60 s / 5 | **env vars with defaults** | `auth/auth.service.ts:71-92` |
| Access / refresh token TTL | 15 m / 30 d | **env vars with defaults** | `auth/auth.service.ts:321,326` |
| Display name length | 2–40 chars | constant | `reviews/dto/create-review.dto.ts` |

Date ranges use the half-open `[from, to)` convention throughout.

---

## 11. What is NOT implemented

Direct list. Each line says why it is absent.

**Customer discovery and browsing — does not exist.**
There is **no public endpoint that lists businesses, locations or services.**
`GET /categories` returns the taxonomy and nothing else. The only public reads
are `GET /locations/:id/availability` and `GET /locations/:id/reviews`, and both
require a location id the customer has no way to obtain from this API. A customer
cannot search, browse, filter by category, or see a price before booking. *Why
absent:* never built — the modules were sequenced business-side first (§7 build
order), and no turn has specified it.

**Payout automation — absent by necessity.**
The MoMo integration is **collections only**: one subscription key pair, and only
`/collection/token/`, `/collection/v1_0/requesttopay` and its status endpoint
(`payments/momo-payment.provider.ts:110,155,205`). `PaymentProvider` declares
exactly two methods, both inbound. Every payout is created `PENDING` and marked
paid by hand with a reference. *Why absent:* no disbursement credential or client
exists; MTN Disbursements would need its own subscription and provider class.

**Full online payment — only the deposit is collected.**
The balance is settled directly between customer and business, offline. Nothing
records whether it was ever paid; `balanceOwedToBusiness` in analytics is an
expectation, not a receipt, and says so in its own response. *Why absent:*
product decision (§2), not a gap.

**Payout currency conversion — undecided.**
The ledger and payouts are USD; businesses would be paid in SSP. Nothing decides
which day's rate applies or who bears the movement between calculation and
transfer (§34.5, §36.7). *Why absent:* explicitly deferred rather than guessed.

**Pre-§34 appointments are not payable.**
Appointments paid before the ledger existed have no entries and no backfill; they
must be settled out of band (§34.6). *Why absent:* the data to synthesise them
honestly (a `depositPaidAt`, a resolution date) was never recorded.

**MTN's collection fee is not netted from anyone.**
DECISIONS §19 records the decision — the business absorbs it out of its share —
and marks itself **"DECIDED, NOT IMPLEMENTED"**. `computeAppointmentAmounts` has
no provider-fee term, and nothing anywhere subtracts one on collection. The
`GATEWAY_FEE_DEBIT` that *does* exist only covers **refunds**, and its amount is
supplied by hand.

**No admin UI.** Every admin surface is API-only (§16.9). Admin accounts are not
self-service — the auth DTOs accept only BUSINESS and CUSTOMER, so an admin must
be seeded manually (`admin-settings.controller.ts:19`).

**No business approval endpoint.** `BusinessStatus` has `PENDING`, `APPROVED`,
`REJECTED`, `SUSPENDED` and non-`APPROVED` businesses are hidden from public
reads — but **no route sets the status.** A business can only be approved by
editing the database directly. *Unclear whether this is deliberate; no DECISIONS
section covers it.*

**No media moderation endpoint.** `MediaStatus` has `PENDING`/`APPROVED`/
`REJECTED` and uploads default to `PENDING`, but nothing transitions them.

**No SMS.** `NotificationChannel.SMS` exists in the enum; the only channel
implementation is email.

**No review deletion.** Deliberate — delete-and-repost is how a review escapes a
business response (`reviews.service.ts:~155`).

**No appointment rescheduling / postponement.** Deliberate, DECISIONS §5.

**No ownership transfer.** `MembersService` refuses to change the owner's role
(`members.service.ts:232`), and invitations cannot mint an OWNER.

**No refund of the balance, no partial refunds, no chargebacks.**

**No source TODOs.** A search for `TODO`, `FIXME`, `XXX`, `HACK`, `@ts-ignore`
and `@ts-expect-error` across `src/`, `test/` and `scripts/` returns **nothing**.

---

## 12. DECISIONS.md index

### 12.1 Sections

| § | Title | Summary |
|---|---|---|
| 1 | Product scope | Service-booking marketplace; customers book, businesses manage |
| 2 | Revenue model | Deposit at booking; platform fee out of the deposit; balance offline. Flat-fee model **superseded** by percentage |
| 3 | Authentication | One email, one role; OTP-only; admins never self-service |
| 4 | Architecture | One backend, one database, three planned apps |
| 5 | No in-app postponement | Cancel-and-rebook instead |
| 6 | Tech stack | Nest + Prisma + Postgres choices |
| 7 | Module build order | Sequencing of the eight modules |
| 8 | Monorepo restructure | Workspace layout decisions |
| 9 | First-run fixes | Environment and config fixes |
| 10 | Business profile, locations, services, gallery | The catalogue module |
| 11 | Auth fix | Role conflict checked before the rate limit |
| 12 | Availability & scheduling | Slot computation, hours, exceptions, blocks |
| 13 | Availability fixes | Exception precedence; public status filtering |
| 14 | Multi-person business accounts | Memberships, invitations, roles |
| 15 | Membership uniqueness | Scoped to ACTIVE rows via a partial index |
| 16 | The Appointment system | Lifecycle, verification, capacity, money snapshot |
| 17 | Payments | Deposits via MTN MoMo; polling and expiry |
| 18 | Currency tracking | USD as the unit of account |
| 19 | Who absorbs MTN's fee | **DECIDED, NOT IMPLEMENTED** — the business absorbs it |
| 20 | Notifications | Rows, rendering, channels, retry |
| 21 | Chat | Threads, messages, photo attachments |
| 22 | Realtime chat transport | WebSocket layer alongside REST |
| 23 | Automated test suite | Jest, real Postgres, targeted provider modules |
| 24 | Support tickets | Lifecycle, attachments, internal notes |
| 25 | Correcting BillingAdjustment | Renamed to the real fee model; refund rules stated |
| 26 | Boot smoke test | Real AppModule boot under a tight timeout |
| 27 | Guard-chain tests over HTTP | Closing §23.3; two-layer enforcement rule |
| 28 | Reviews | Per-location, one per appointment, 7-day edit, moderation |
| 29 | Business analytics | Reporting from money data that actually exists |
| 30 | Pricing snapshot | The inputs the amounts came from, frozen at booking |
| 31 | Customer display names | On the User, "Anonymous" rendered not stored |
| 32 | Agreed price, not today's | Removed the live-price join from appointment reads |
| 33 | Cancellation attribution | `cancelledBy`, `cancelledByUserId`, `depositPaidAt` |
| 34 | The ledger | Append-only, signed, trigger-enforced, no balance column |
| 35 | Payout runs | Selection, negative carry-forward, concurrency, manual transfer |
| 36 | Refunds and adjustments | Business-cancellation reversal; adjustment execution |
| 37 | Exchange-rate staleness | Loud, never fatal |
| 38 | Payout hold becomes a setting | Default 2 days; hold at resolution time |
| 39 | Approximate SSP alongside USD | Display-only local-currency figure |

### 12.2 Where DECISIONS.md and the code disagree

1. **§34.3 still says the payout hold is 7 days.** The table there reads
   `completedAt + 7 days` / `endTime + 7 days`. The code's default is **2 days**
   and the value is now an admin setting (§38). §34.3 was never marked
   `~~superseded~~` and does not cross-reference §38. *A reader who stops at §34
   will get the hold wrong.*

2. **The schema comment on `BusinessMemberRole.STAFF` is stale.** It reads
   "read-only for now; gains booking permissions with the Appointment module"
   (`prisma/schema.prisma`, `BusinessMemberRole`). STAFF **can** verify, complete
   and mark no-show (`appointments.controller.ts:87,102,116`) and can read
   profile, locations, services, gallery, members, exceptions and time blocks.
   §14's own outstanding list already marks this `~~done~~`, so only the schema
   comment is wrong.

3. **§19 describes fee handling that does not exist.** It states MTN's collection
   fee is absorbed by the business's share. Nothing implements it. §19 does label
   itself "DECIDED, NOT IMPLEMENTED", so this is disclosed — but a reader
   skimming the money sections could reasonably assume it is live.

4. **§38.4 logs the settings two-layer gap; the equivalent gaps in Reviews and
   Tickets are not logged.** `ReviewsService.hide/unhide` and the ticket
   assign/status/message admin methods take an admin id without verifying the
   caller's role, relying on `@Roles(ADMIN)` alone. DECISIONS §27.1 states the
   two-layer rule generally; these are unlisted exceptions.

5. **§4 and the root `package.json` describe three apps.** Only `apps/backend`
   exists. §4 is a plan, not a claim about the present, but the package
   description ("monorepo (backend + web apps)") reads as a statement of fact.

No other contradiction was found between a DECISIONS claim and the code.

---

## 13. Tests

**538 tests, 14 suites, all passing.** One suite runs over HTTP; the other
thirteen call services directly against a real Postgres.

| Suite | Level | ~it-blocks | Covers |
|---|---|---|---|
| `app-boot.spec.ts` | boot | 1 | The real `AppModule` boots through `configureApp` inside a tight timeout |
| `guard-chain.e2e.spec.ts` | **HTTP** | ~71 | The whole guard chain as a client experiences it: 401/403/404 per role per module, the global `ValidationPipe`, admin-only routes, payout and settings routes, `approxSettlement` rejection on writes |
| `appointment-state-machine.spec.ts` | service | ~38 | Every legal and illegal transition; cancellation attribution; `depositPaidAt` survival |
| `capacity.spec.ts` | service | ~11 | Concurrent-booking capacity; the expiry sweep frees a slot and records `SYSTEM_EXPIRY` |
| `money-invariant.spec.ts` | service | ~23 | `fee + business == deposit` across many inputs; the pricing snapshot reproduces the stored amounts; appointment reads never show today's price |
| `ledger.spec.ts` | service | ~34 | Entry signs and sums; `availableAt` per resolution path; exactly-once; the append-only trigger; the configurable hold; a **source scan** asserting every `CANCELLED` write sets `cancelledBy` |
| `payouts.spec.ts` | service | ~31 | Run selection; negative carry-forward; concurrency; mark-paid/failed; balances; cross-tenant refusal |
| `refunds.spec.ts` | service | ~28 | Business-cancellation reversal maths; customer-cancel and no-show appending nothing; the admin dispute path; adjustment execution; held total |
| `analytics.spec.ts` | service | ~32 | Counts, rates, money figures, completeness reporting, scope enforcement |
| `reviews.spec.ts` | service | ~53 | Creation preconditions, edit window, responses, moderation, display names, exposure rules |
| `support-tickets.spec.ts` | service | ~40 | Ticket lifecycle, transitions, internal notes, attachments, reopen window |
| `cross-tenant-isolation.spec.ts` | service | ~33 | 404-not-403 across modules for another tenant's resources |
| `approx-settlement.spec.ts` | service | ~19 | One rate read per response; unset/stale behaviour; business views unchanged; nothing persisted |
| `exchange-rate-staleness.spec.ts` | service | ~16 | Staleness reporting, admin notification debounce, "still serves while stale" |

(`it.each` blocks expand at runtime, so the static counts undercount; 538 is the
real total.)

### Deliberately NOT covered

- **The MTN MoMo sandbox.** No test contacts it; `paymentProviderStub` is used
  everywhere. Payment behaviour against the real sandbox is a manual check
  (§23, `test/setup/test-module.ts:48`).
- **The WebSocket gateway.** `ChatGateway` has no automated test; it was verified
  with a standalone `socket.io-client` script (`scripts/ws-smoke-test.js`).
- **Email delivery.** `MailService` is stubbed; `isConfigured()` returns false in
  tests.
- **Object storage.** R2 is never contacted; uploads fall back to local disk.
- **Most HTTP surfaces.** `guard-chain.e2e.spec.ts` tests **one representative
  route per protected module**, not every handler, on the grounds that guards are
  declared per controller.
- **Availability slot computation** has no dedicated suite — it is exercised
  indirectly through booking and capacity tests. *This is a genuine coverage gap
  for a non-trivial algorithm.*
- **Concurrency** is tested only for the payout run. Booking races rely on
  database constraints, not on tested interleaving.

---

## 14. Risks and surprises

**Load-bearing conventions — break these and things go quiet, not loud.**

1. **404, not 403, for cross-tenant access.** Every service returns
   `NotFoundException` for another tenant's resource. A well-meaning change to
   403 would leak the existence of other tenants' records.
2. **A business balance is `SUM(ledger_entries.amountCents)`.** There is no
   balance column, and §34.2 says there must never be one. Adding a cached
   balance would be the single most damaging change available in this codebase.
3. **Money is integer cents and `Prisma.Decimal`.** No float ever touches it.
   `businessAmountCents` is computed by *subtraction*, never by its own rounded
   percentage, so the three amounts cannot disagree by a cent.
4. **Snapshot, don't join.** Amounts, their inputs, the exchange rate and the
   payout hold are all frozen at write because every source is editable. §32
   exists because one such join shipped and showed customers today's price for a
   months-old booking.
5. **`whitelist` + `forbidNonWhitelisted` are doing security work.** Adding a
   field to a response is safe; adding one to a DTO widens what can be sent.

**Sharp edges.**

6. **The role comes from the JWT, never re-read.** A revoked admin keeps admin
   powers until their 15-minute access token expires. Nothing consults
   `User.role` after login.
7. **CORS is `enableCors()` with no options**, and the chat gateway is
   `cors: { origin: '*' }`. Both are explicitly flagged as pre-production work.
8. **`RolesGuard` returns `true` when `@Roles` is absent.** On a controller with
   only `JwtAuthGuard`, *any* authenticated user reaches the handler. That is
   correct for `/appointments` and `/threads` (the services scope), but it means
   forgetting `@Roles` fails open.
9. **`AppointmentsSharedController` has no `@Roles` at all.** An ADMIN token can
   call `GET /appointments`, which `findAll` refuses (`:1044`) — a
   `ForbiddenException` from the service, not the guard. This is the exact
   fall-through that was fixed once already in chat.
10. **Node ESM + Jest is fragile.** `@nestjs/common@12` is ESM-only and the local
    Node is 24.1 (< 24.9), so Jest must run with
    `NODE_OPTIONS=--experimental-vm-modules`. Running `npx jest` directly fails
    with a confusing "Must use import to load ES Module" error. Always use
    `npm test`.
11. **`test/setup/test-module.ts` provides `LedgerService` and
    `PlatformSettingsService` to every suite.** Adding a hard dependency to
    either will break unrelated suites with `Cannot read properties of undefined
    (reading '$queryRaw')` — a compile failure surfacing as a Prisma error.
12. **`ledger.spec.ts` contains a source-scanning test.** It reads `src/`, counts
    `status: AppointmentStatus.CANCELLED` writes, and asserts there are exactly
    **three**. Adding a fourth cancellation path fails that test by design — and
    it has already caught one real addition.

**Looks wrong, is deliberate.**

13. **A negative available balance produces no payout and leaves entries
    unstamped.** Stamping them would silently forgive the debt.
14. **`approxSettlement.amountMinor` is always a multiple of 100.** The rounding
    is in the value, not the unit — the rate is hand-set and does not justify
    piastre precision.
15. **A `NO_SHOW` becomes payable at `endTime + hold` while an auto-completed
    appointment becomes payable around `endTime + 24h + hold`.** The anchors
    differ because a no-show has no `completedAt`. §38.3 argues against aligning
    them.
16. **The customer's display name lives on `User`, not `Review`** — the opposite
    of the snapshot rule, and correct: a name describes a person now.

**Looks fine, is fragile.**

17. **`getExchangeRate()` logs at ERROR when the settings row is missing.** That
    is right for the payment path and was wrong for display reads; a quiet
    `getExchangeRateForDisplay()` was added. Any new hot-path caller must use the
    quiet one or it will flood the log.
18. **The exchange rate has no live feed.** If nobody updates it, customers are
    charged at a stale rate indefinitely. This is loud (admin notifications) but
    never fatal, by design.
19. **`Payout.amountCents` can drift from its entries** if an opposing entry is
    later appended for the same appointment. That is intended — the payout
    records what a business was told — but a reconciliation that trusts
    `Payout.amountCents` over the entries would be wrong.
20. **The `platformFeePercentage` is cached in-process for 30 seconds**
    (`CACHE_TTL_MS`, `platform-settings.service.ts:44`). A fee change is not
    instantly visible, and with multiple instances two bookings a second apart
    can be priced at different fees. The exchange rate is deliberately **not**
    cached.

**Flagged in earlier turns and still outstanding.**

21. `/admin/settings/platform-fee` and `/admin/settings/exchange-rate` are
    **guard-only**, with no service-level role assertion (§38.4).
22. `ReviewsService.hide/unhide` and the ticket admin mutations are also
    guard-only, and this is **not** recorded anywhere in DECISIONS.md.
23. **No transfer is automated** — every payout is sent by hand (§36.7).
24. **Payout currency is undecided** — the ledger is USD, businesses are paid in
    SSP (§34.5, §36.7).
25. **§34.3's 7-day hold is stale documentation** (§12.2 item 1).

---

## Summary

This is a **complete, well-tested backend for the business side of a
service-booking marketplace, with no customer-facing front door**. A business can
be created, staffed with roles, given locations, services, opening hours and
schedule overrides; a customer with a known location id can see availability,
book, pay a deposit through MTN MoMo in the local currency, verify their arrival
with a code, chat with the business, review the appointment afterwards, and raise
a support ticket. Behind that, the money is rigorous: every amount is snapshotted
at write, the deposit split is invariant to the cent, an append-only ledger with
a database-enforced immutability trigger records every movement, payouts run on a
schedule against a configurable hold, and business-cancellation refunds return
the customer their deposit *including* the platform's own fee.

What it cannot do is get a customer to that booking screen in the first place:
**there is no discovery, search, or browsing of any kind** — no endpoint lists
businesses, locations or services to the public, so the customer journey has no
beginning. Nor can it move money outward on its own: the payment integration is
collections-only, so every payout is created `PENDING` and wired by hand, and the
question of what exchange rate a USD-denominated payout is settled at in SSP
remains explicitly undecided. Only the deposit is ever collected online — the
balance is settled offline between customer and business and the platform never
sees it. There is no admin interface, no way to approve a pending business except
by editing the database, and no frontend of any kind. It is, precisely, a
production-grade engine waiting for a shopfront.
