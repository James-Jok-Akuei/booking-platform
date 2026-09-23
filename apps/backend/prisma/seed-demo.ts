/**
 * A realistic demo dataset (§49).
 *
 *   npm run seed:demo
 *
 * SEPARATE from `prisma/seed.ts`, which seeds the category taxonomy and must
 * keep working on its own — the taxonomy is product data every environment
 * needs, while this is a sandbox nobody should run near real customers.
 *
 * ## How this differs from the test fixtures
 *
 * The suite builds its own minimal fixtures, one per behaviour. This builds a
 * WORLD: businesses in every interesting state at once, so that browsing,
 * searching, paying, reviewing and paying out can be walked end to end by hand
 * (see docs/MANUAL_WALKTHROUGH.md).
 *
 * ## Through the services, not around them
 *
 * Almost everything goes through the real services, so the seed hits the same
 * validation a real caller does — a seed that writes rows Prisma-directly can
 * happily create data the API would have refused, and then the walk-through is
 * exploring a system that does not exist.
 *
 * The exceptions are all one of three things, each marked `RAW WRITE` with its
 * reason at the call site:
 *   1. fabricating the PAST (an appointment that already happened),
 *   2. fabricating a PROVIDER CHARGE (MoMo is not called here),
 *   3. planting a KNOWN verification code, so the walk-through can verify an
 *      arrival by hand — the real code is emailed and bcrypt-hashed, so nobody
 *      running this script could otherwise know it.
 *
 * ## Idempotent
 *
 * Re-running deletes only what this script created — every seeded business,
 * customer and admin carries the `demo-` email prefix or is reachable from one —
 * and rebuilds it. It never touches the taxonomy, and never touches a row it did
 * not create.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  BusinessStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { LocationsService } from '../src/business/locations.service';
import { ServicesService } from '../src/business/services.service';
import { ScheduleManagementService } from '../src/availability/schedule-management.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import { TicketsService } from '../src/tickets/tickets.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { INTERNAL_CURRENCY } from '../src/payments/currency';

const log = new Logger('seed-demo');

/** Everything this script creates is reachable from an email with this prefix. */
const DEMO_PREFIX = 'demo-';

/** The code planted on every seeded appointment, so arrivals can be verified. */
const DEMO_VERIFICATION_CODE = '123456';

/**
 * The rate for every seeded charge.
 *
 * Exactly 1, and it has to be: the platform collects in the same currency it
 * prices in (§66), so there is nothing to convert — and `setExchangeRate`
 * refuses any other value for the unit of account (§55.3).
 */
const DEMO_RATE = 1;

const ADMIN_ACTOR = { userId: '', role: UserRole.ADMIN as string };

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Refuses to run anywhere that is not obviously a developer's machine.
 *
 * Three independent conditions, all required. Any one alone is too easy to
 * satisfy by accident — a staging box can be called `booking_platform`, and
 * `NODE_ENV` is unset far more often than it is set to `production`.
 *
 * This script DELETES data. The cost of an over-strict guard is an annoyed
 * developer setting one environment variable; the cost of a loose one is a
 * wiped database.
 */
function assertSafeDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set.');

  const parsed = new URL(url);
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '');

  const localHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];
  const allowedDatabases = ['booking_platform', 'booking_platform_dev', 'booking_platform_demo'];

  const problems: string[] = [];
  if (process.env.NODE_ENV === 'production') {
    problems.push('NODE_ENV is "production"');
  }
  if (!localHosts.includes(host)) {
    problems.push(`the database host is "${host}", not a local one`);
  }
  if (!allowedDatabases.includes(database)) {
    problems.push(
      `the database is named "${database}", which is not one of ${allowedDatabases.join(', ')}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to seed demo data: ${problems.join('; ')}.\n` +
        'This script DELETES rows. If this really is a throwaway database, point ' +
        'DATABASE_URL at a local one named booking_platform_demo.',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const HOUR = 3_600_000;

const email = (name: string) => `${DEMO_PREFIX}${name}@example.com`;

/**
 * A future slot at a given local hour, skipping days every seeded location is
 * shut.
 *
 * Sunday is closed everywhere in this dataset, and `create` rightly refuses a
 * slot on a closed day — so a naive "today + N days" produces bookings that
 * fail roughly one time in seven, depending on what day the seed is run. The
 * skip is the seed's problem to solve, not the API's.
 *
 * Africa/Kigali is UTC+2 with no DST, so local hour − 2 is the UTC hour.
 */
function futureSlot(daysAhead: number, hour: number): Date {
  const date = new Date(Date.now() + daysAhead * DAY);
  date.setUTCHours(hour - 2, 0, 0, 0);
  // Sunday (0) is shut for every seeded location; roll forward to Monday.
  while (date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

/** Today's weekday in Africa/Kigali, matching LocationHours.dayOfWeek. */
function jubaWeekday(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Kigali',
    weekday: 'short',
  }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts);
}

function jubaToday(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );
  return new Date(`${ymd}T00:00:00.000Z`);
}

interface SeededBusiness {
  label: string;
  userId: string;
  email: string;
  businessId: string;
  locationIds: string[];
  serviceIds: string[];
  note: string;
}

// ---------------------------------------------------------------------------

async function main() {
  assertSafeDatabase(process.env.DATABASE_URL);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const profiles = app.get(BusinessProfileService);
  const locations = app.get(LocationsService);
  const services = app.get(ServicesService);
  const schedules = app.get(ScheduleManagementService);
  const appointments = app.get(AppointmentsService);
  const reviews = app.get(ReviewsService);
  const tickets = app.get(TicketsService);
  const ledger = app.get(LedgerService);
  const destinations = app.get(PayoutDestinationsService);
  const moderation = app.get(BusinessModerationService);
  const settings = app.get(PlatformSettingsService);

  // -------------------------------------------------------------------------
  // Idempotency: remove only what a previous run of THIS script created.
  // -------------------------------------------------------------------------
  const previous = await prisma.user.findMany({
    where: { email: { startsWith: DEMO_PREFIX } },
    select: { id: true, businessMemberships: { select: { businessProfileId: true } } },
  });
  if (previous.length > 0) {
    const businessIds = [
      ...new Set(previous.flatMap((u) => u.businessMemberships.map((m) => m.businessProfileId))),
    ];
    // Cascades take locations, services, appointments, ledger entries, reviews,
    // tickets and payout destinations with them.
    await prisma.businessProfile.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.user.deleteMany({ where: { id: { in: previous.map((u) => u.id) } } });
    log.log(`Cleared ${previous.length} user(s) from a previous demo seed.`);
  }

  // -------------------------------------------------------------------------
  // Platform settings
  // -------------------------------------------------------------------------
  const admin = await prisma.user.create({
    data: { email: email('admin'), role: UserRole.ADMIN },
  });
  ADMIN_ACTOR.userId = admin.id;

  await settings.setPlatformFeePercentage(10, ADMIN_ACTOR);
  await settings.setExchangeRate(DEMO_RATE, INTERNAL_CURRENCY, ADMIN_ACTOR);
  await settings.setPayoutHoldDays(2, ADMIN_ACTOR);

  const categories = await prisma.category.findMany({
    include: { subcategories: true },
    orderBy: { name: 'asc' },
  });
  if (categories.length === 0) {
    throw new Error(
      'No categories found. Run `npm run prisma:seed` first — the taxonomy seed ' +
        'is separate and this script does not duplicate it.',
    );
  }
  const categoryFor = (index: number) => categories[index % categories.length];

  // -------------------------------------------------------------------------
  // Businesses
  // -------------------------------------------------------------------------
  const seeded: SeededBusiness[] = [];

  /** Creates the owner, the profile, and one location, through the services. */
  async function makeBusiness(options: {
    label: string;
    handle: string;
    description: string;
    lat: number;
    lng: number;
    address: string;
    locationName: string;
    categoryIndex: number;
    note: string;
  }): Promise<SeededBusiness> {
    const owner = await prisma.user.create({
      data: { email: email(options.handle), role: UserRole.BUSINESS },
    });
    const profile = await prisma.businessProfile.create({
      data: {
        name: options.label,
        members: {
          create: {
            userId: owner.id,
            role: BusinessMemberRole.OWNER,
            status: BusinessMemberStatus.ACTIVE,
          },
        },
      },
    });

    const category = categoryFor(options.categoryIndex);
    await profiles.update(profile.id, {
      description: options.description,
      phone: '+250788000000',
      categoryId: category.id,
      ...(category.subcategories[0] ? { subcategoryId: category.subcategories[0].id } : {}),
    });

    const location = await locations.create(owner.id, {
      name: options.locationName,
      address: options.address,
      latitude: options.lat,
      longitude: options.lng,
    });

    return {
      label: options.label,
      userId: owner.id,
      email: owner.email,
      businessId: profile.id,
      locationIds: [location.id],
      serviceIds: [],
      note: options.note,
    };
  }

  /** Weekly hours; `closedToday` shuts whichever weekday it is in Juba. */
  async function setHours(
    business: SeededBusiness,
    locationId: string,
    open: string,
    close: string,
    closedToday = false,
  ) {
    const today = jubaWeekday();
    await locations.setHours(business.userId, locationId, {
      hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        openTime: open,
        closeTime: close,
        // Sunday is shut everywhere; one location is additionally shut today.
        isClosed: dayOfWeek === 0 || (closedToday && dayOfWeek === today),
      })),
    });
  }

  // 1 — the flagship: two branches, full catalogue, money flowing.
  const nile = await makeBusiness({
    label: 'Kigali Barbers',
    handle: 'nile',
    description: 'Classic cuts and hot-towel shaves, two branches in Kigali.',
    lat: -1.9441,
    lng: 30.0619,
    address: 'KN 4 Ave, Nyarugenge',
    locationName: 'Nyarugenge Branch',
    categoryIndex: 0,
    note: 'APPROVED, 2 branches, verified payout destination, POSITIVE balance.',
  });
  const nileSecond = await locations.create(nile.userId, {
    name: 'Kimironko Branch',
    address: 'KG 11 Ave, Kimironko',
    latitude: -1.9403,
    longitude: 30.1274,
  });
  nile.locationIds.push(nileSecond.id);
  await setHours(nile, nile.locationIds[0], '08:00', '19:00');
  await setHours(nile, nileSecond.id, '09:00', '17:00');

  // 2 — deposit exactly at the platform-fee floor: business share is ZERO.
  const konyo = await makeBusiness({
    label: 'Kimironko Spa',
    handle: 'konyo',
    description: 'Massage and steam, beside the market.',
    lat: -1.9403,
    lng: 30.1274,
    address: 'KG 9 Ave, Kimironko',
    locationName: 'Kimironko',
    categoryIndex: 1,
    note: 'APPROVED. Deposit == fee (10%), so the business share of a deposit is ZERO.',
  });
  await setHours(konyo, konyo.locationIds[0], '10:00', '20:00');

  // 3 — owes money after cancelling on a customer: NEGATIVE balance.
  const thongpiny = await makeBusiness({
    label: 'Remera Nails',
    handle: 'thongpiny',
    description: 'Manicures, pedicures and nail art.',
    lat: -1.9536,
    lng: 30.1130,
    address: 'KG 17 Ave, Remera',
    locationName: 'Remera Studio',
    categoryIndex: 2,
    note: 'APPROVED. Cancelled a PAID booking, so its ledger balance is NEGATIVE.',
  });
  await setHours(thongpiny, thongpiny.locationIds[0], '09:00', '18:00');

  // 4 — payouts blocked: destination submitted but not yet verified.
  const autocare = await makeBusiness({
    label: 'Kigali Auto Care',
    handle: 'autocare',
    description: 'Servicing, diagnostics and tyres.',
    lat: -1.9700,
    lng: 30.0580,
    address: 'Airport Road',
    locationName: 'Airport Road Workshop',
    categoryIndex: 3,
    note: 'APPROVED but payout destination is UNVERIFIED — payouts are PAUSED.',
  });
  await setHours(autocare, autocare.locationIds[0], '08:00', '17:00');

  // 5 — closed today, and no payout destination at all.
  const haicinema = await makeBusiness({
    label: 'Nyamirambo Salon',
    handle: 'haicinema',
    description: 'Braiding, styling and treatments.',
    lat: -1.9770,
    lng: 30.0430,
    address: 'KN 2 Ave, Nyamirambo',
    locationName: 'Nyamirambo Salon',
    categoryIndex: 4,
    note: 'APPROVED, CLOSED TODAY, and NO payout destination at all.',
  });
  await setHours(haicinema, haicinema.locationIds[0], '09:00', '17:00', true);

  // 6 — never reviewed by an admin: invisible to the public.
  const gudele = await makeBusiness({
    label: 'Kicukiro Tailors',
    handle: 'gudele',
    description: 'Bespoke tailoring and alterations.',
    lat: -1.9890,
    lng: 30.1030,
    address: 'KK 15 Rd, Kicukiro',
    locationName: 'Kicukiro Workshop',
    categoryIndex: 5,
    note: 'PENDING approval — absent from discovery, and unbookable.',
  });
  await setHours(gudele, gudele.locationIds[0], '09:00', '17:00');

  // 7 — suspended: invisible, unbookable, payouts paused, existing bookings stand.
  const munuki = await makeBusiness({
    label: 'Gikondo Fitness',
    handle: 'munuki',
    description: 'Gym floor, classes and personal training.',
    lat: -1.9840,
    lng: 30.0740,
    address: 'KK 3 Ave, Gikondo',
    locationName: 'Gikondo Gym',
    categoryIndex: 6,
    note: 'SUSPENDED — invisible and unbookable, but its existing appointments stand.',
  });
  await setHours(munuki, munuki.locationIds[0], '06:00', '21:00');

  // 8 — approved with an empty catalogue: browsable, fromPriceMinor null.
  const atlabara = await makeBusiness({
    label: 'Kacyiru Studio',
    handle: 'atlabara',
    description: 'Photography studio, opening soon.',
    lat: -1.9380,
    lng: 30.0890,
    address: 'KG 7 Ave, Kacyiru',
    locationName: 'Kacyiru Studio',
    categoryIndex: 7,
    note: 'APPROVED with NO services — browsable, fromPriceMinor is null, sorts last by price.',
  });
  await setHours(atlabara, atlabara.locationIds[0], '09:00', '17:00');

  seeded.push(nile, konyo, thongpiny, autocare, haicinema, gudele, munuki, atlabara);

  // -------------------------------------------------------------------------
  // Approval. Everything defaults to PENDING, so this is what makes most of
  // them public — and it is worth seeing that ordering explicitly.
  // -------------------------------------------------------------------------
  for (const business of [nile, konyo, thongpiny, autocare, haicinema, atlabara, munuki]) {
    await moderation.approve(ADMIN_ACTOR, business.businessId);
  }
  // `gudele` is deliberately left PENDING.
  // `munuki` is suspended LATER, after its booking exists — a suspended
  // business cannot be booked with (§42.1), and the point of seeding it is to
  // show that a booking made BEFORE the suspension survives it.

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------
  async function addService(
    business: SeededBusiness,
    name: string,
    priceMinor: number,
    durationMinutes: number,
    depositPercentage: number,
  ) {
    const service = await services.create(business.userId, {
      name,
      priceMinor,
      durationMinutes,
      depositPercentage,
    });
    business.serviceIds.push(service.id);
    return service;
  }

  await addService(nile, 'Haircut', 5000, 30, 20);
  await addService(nile, 'Hot-towel shave', 8000, 45, 20);
  await addService(nile, 'Cut and beard', 12000, 60, 25);
  const retired = await addService(nile, 'Retired: dye', 3000, 60, 20);
  // Soft-deleted, so it must NOT set the headline price even though it is the
  // cheapest thing the business ever offered.
  await services.deactivate(nile.userId, retired.id);

  // Deposit exactly at the 10% floor: the platform takes the whole deposit and
  // the business's ledger share of it is exactly zero (§40.4).
  await addService(konyo, 'Full-body massage', 30000, 90, 10);
  await addService(konyo, 'Steam room', 8000, 30, 10);

  await addService(thongpiny, 'Manicure', 6000, 45, 20);
  await addService(thongpiny, 'Pedicure', 8000, 60, 20);

  await addService(autocare, 'Oil change', 20000, 60, 15);
  await addService(autocare, 'Full service', 60000, 180, 15);

  await addService(haicinema, 'Braiding', 15000, 120, 20);
  await addService(gudele, 'Suit fitting', 40000, 60, 20);
  await addService(munuki, 'Personal training', 12000, 60, 20);
  // `atlabara` deliberately has none.

  // -------------------------------------------------------------------------
  // A schedule exception: the flagship shuts tomorrow.
  // -------------------------------------------------------------------------
  const tomorrow = new Date(jubaToday().getTime() + DAY);
  await schedules.createException(nile.userId, nile.locationIds[0], {
    date: tomorrow.toISOString().slice(0, 10),
    isClosed: true,
    reason: 'Public holiday (demo data)',
  });

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------
  const customers = await Promise.all(
    [
      { handle: 'amal', displayName: 'Amal K.' },
      { handle: 'deng', displayName: 'Deng' },
      { handle: 'grace', displayName: 'Anonymous' }, // typed it deliberately (§31)
      { handle: 'peter', displayName: null }, // renders as "Anonymous"
      { handle: 'sara', displayName: null },
    ].map((c) =>
      prisma.user.create({
        data: {
          email: email(c.handle),
          role: UserRole.CUSTOMER,
          displayName: c.displayName,
        },
      }),
    ),
  );
  const [amal, deng, grace, peter, sara] = customers;

  // -------------------------------------------------------------------------
  // Appointments
  // -------------------------------------------------------------------------

  /**
   * Books through the real service, then drives it to a chosen end state.
   *
   * RAW WRITES, all three kinds, marked below:
   *  - the PAST: `create` refuses a slot behind the clock, so a booking that
   *    already happened has to be backdated after the fact;
   *  - the PROVIDER CHARGE: MoMo is not called here, so the figure
   *    `initiateDepositPayment` would have recorded is written directly;
   *  - the VERIFICATION CODE: it is emailed and stored only as a bcrypt hash,
   *    so nobody running this script could verify an arrival by hand without a
   *    known one being planted.
   */
  async function book(options: {
    business: SeededBusiness;
    customerId: string;
    locationIndex?: number;
    serviceIndex?: number;
    daysAhead: number;
    hour?: number;
    to: 'PENDING_PAYMENT' | 'BOOKED' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_BUSINESS';
    inThePast?: boolean;
  }) {
    const { business, customerId } = options;
    const locationId = business.locationIds[options.locationIndex ?? 0];
    const serviceId = business.serviceIds[options.serviceIndex ?? 0];

    const created = await appointments.create(customerId, {
      locationId,
      serviceId,
      startTime: futureSlot(options.daysAhead, options.hour ?? 10).toISOString(),
    });

    // RAW WRITE (known verification code): planted so the walk-through can call
    // POST /business/appointments/:id/verify with 123456. The real one is
    // emailed and only ever stored hashed.
    await prisma.appointment.update({
      where: { id: created.id },
      data: { verificationCodeHash: await bcrypt.hash(DEMO_VERIFICATION_CODE, 10) },
    });

    if (options.to === 'PENDING_PAYMENT') return created.id;

    // RAW WRITE (provider charge): what initiateDepositPayment would have
    // recorded after MoMo accepted. Without it the ledger entries carry no
    // settlement amount and the business is unpayable (§45).
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: created.id } });
    const reference = `demo-ref-${created.id.slice(0, 8)}`;
    await prisma.appointment.update({
      where: { id: created.id },
      data: {
        paymentProviderReferenceId: reference,
        paymentInitiatedAt: new Date(),
        providerCurrency: INTERNAL_CURRENCY,
        providerAmountMinor: row.depositAmountMinor * DEMO_RATE,
        exchangeRateUsed: DEMO_RATE,
      },
    });

    // The real confirmation path: writes depositPaidAt and the ledger pair.
    await appointments.applyPaymentResult(created.id, reference, 'SUCCESSFUL');

    if (options.inThePast) {
      // RAW WRITE (the past): create() refuses a slot behind the clock, so a
      // booking that already happened must be backdated afterwards.
      const start = new Date(Date.now() - options.daysAhead * DAY);
      await prisma.appointment.update({
        where: { id: created.id },
        data: { startTime: start, endTime: new Date(start.getTime() + HOUR) },
      });
    }

    switch (options.to) {
      case 'BOOKED':
        break;
      case 'IN_PROGRESS':
        await appointments.verify(business.userId, created.id, DEMO_VERIFICATION_CODE);
        break;
      case 'COMPLETED':
        await appointments.verify(business.userId, created.id, DEMO_VERIFICATION_CODE);
        await appointments.complete(business.userId, created.id);
        break;
      case 'NO_SHOW':
        await appointments.noShow(business.userId, created.id);
        break;
      case 'CANCELLED_BY_CUSTOMER':
        await appointments.cancel(customerId, created.id);
        break;
      case 'CANCELLED_BY_BUSINESS':
        await appointments.cancel(business.userId, created.id, {
          reason: 'Demo data: the business called this one off.',
          // Settlement minor units. The provider charges in the unit of
          // account, so this is simply what the gateway took (§45.4, §66).
          gatewayChargeMinor: 500,
        });
        break;
    }

    return created.id;
  }

  const completedForReview: Array<{ id: string; customerId: string }> = [];

  // The flagship: money in, money payable.
  for (const [index, customer] of [amal, deng, grace, peter].entries()) {
    const id = await book({
      business: nile,
      customerId: customer.id,
      serviceIndex: index % 3,
      daysAhead: 3 + index,
      hour: 10 + index,
      to: 'COMPLETED',
      inThePast: true,
    });
    completedForReview.push({ id, customerId: customer.id });
  }
  await book({ business: nile, customerId: sara.id, daysAhead: 9, to: 'NO_SHOW', inThePast: true });
  await book({ business: nile, customerId: amal.id, daysAhead: 4, hour: 14, to: 'BOOKED' });
  await book({ business: nile, customerId: deng.id, daysAhead: 5, hour: 15, to: 'PENDING_PAYMENT' });
  await book({
    business: nile,
    customerId: grace.id,
    locationIndex: 1,
    daysAhead: 6,
    hour: 11,
    to: 'IN_PROGRESS',
  });
  await book({
    business: nile,
    customerId: peter.id,
    daysAhead: 7,
    hour: 12,
    to: 'CANCELLED_BY_CUSTOMER',
  });

  // Zero-share business: completed, but the ledger nets to nothing.
  const konyoCompleted = await book({
    business: konyo,
    customerId: amal.id,
    daysAhead: 5,
    to: 'COMPLETED',
    inThePast: true,
  });
  completedForReview.push({ id: konyoCompleted, customerId: amal.id });

  // Negative balance: refunded in full, and the gateway charge is theirs.
  await book({
    business: thongpiny,
    customerId: deng.id,
    daysAhead: 2,
    to: 'CANCELLED_BY_BUSINESS',
  });

  // Paused business with money owed, so a payout run has something to skip.
  const autocareCompleted = await book({
    business: autocare,
    customerId: sara.id,
    daysAhead: 6,
    to: 'COMPLETED',
    inThePast: true,
  });
  completedForReview.push({ id: autocareCompleted, customerId: sara.id });

  // A booking made while the business was still in good standing...
  await book({ business: munuki, customerId: grace.id, daysAhead: 8, to: 'BOOKED' });

  // ...and only now the suspension. Order matters: booking a suspended business
  // is refused, and this appointment has to survive the suspension untouched
  // (§42.4) — customers are not punished for the business's conduct.
  await moderation.suspend(
    ADMIN_ACTOR,
    munuki.businessId,
    'Demo data: suspended to show what a suspension does.',
  );

  // -------------------------------------------------------------------------
  // Make the completed work payable NOW rather than after the 2-day hold, so a
  // payout run in the walk-through has something to pay.
  //
  // RAW WRITE (the past): availableAt is derived from the resolution date, and
  // there is no way to ask the system to pretend two days have passed.
  // -------------------------------------------------------------------------
  await prisma.ledgerEntry.updateMany({
    where: { availableAt: { not: null } },
    data: { availableAt: new Date(Date.now() - DAY) },
  });

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------
  const ratings = [5, 4, 3, 2, 5, 1];
  const reviewIds: string[] = [];
  for (const [index, item] of completedForReview.entries()) {
    const review = await reviews.create(item.customerId, item.id, {
      rating: ratings[index % ratings.length],
      comment:
        ratings[index % ratings.length] >= 4
          ? 'Quick, friendly and exactly what I asked for.'
          : 'Not what I expected, and I waited a while.',
    });
    reviewIds.push(review.id);
  }

  // A business reply on the first one.
  await reviews.respond(nile.userId, reviewIds[0], {
    responseText: 'Thank you — see you next time.',
  });
  // One hidden by moderation, so the public listing and the star average differ
  // from the raw row count.
  await reviews.hide(ADMIN_ACTOR, reviewIds[reviewIds.length - 1], {
    hiddenReason: 'Demo data: hidden to show moderation.',
  });

  // -------------------------------------------------------------------------
  // Payout destinations
  // -------------------------------------------------------------------------
  /**
   * Submits and verifies in one step.
   *
   * The id is read back from the database rather than taken from `submit()`'s
   * return value: that method's declared type spreads through a
   * `Record<string, unknown>` helper, so TypeScript sees only `msisdnLast3` and
   * a caller cannot reach the `id` it needs to verify. Noted in the
   * walk-through findings — a real client would hit the same wall.
   */
  async function verifyDestination(business: SeededBusiness, msisdn: string) {
    await destinations.submit(business.userId, { msisdn });
    const row = await prisma.payoutDestination.findFirstOrThrow({
      where: { businessId: business.businessId, status: 'UNVERIFIED' },
    });
    await destinations.verify(ADMIN_ACTOR, row.id, {
      verificationNote: 'Demo data: confirmed with the owner by phone.',
    });
  }

  await verifyDestination(nile, '+250788100001');
  await verifyDestination(konyo, '+250788100002');
  await verifyDestination(thongpiny, '+250788100003');

  // Submitted but NOT verified: payouts paused.
  await destinations.submit(autocare.userId, { msisdn: '+250788100004' });
  // `haicinema` deliberately has none at all.

  // -------------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------------
  const openTicket = await tickets.create(
    { userId: amal.id, role: UserRole.CUSTOMER },
    {
      category: 'TECHNICAL_ISSUE',
      subject: 'The app showed the wrong price',
      body: 'The listing said RWF 13,000 but I was charged a different amount.',
    },
  );

  const disputed = await tickets.create(
    { userId: deng.id, role: UserRole.CUSTOMER },
    {
      category: 'APPOINTMENT_DISPUTE',
      subject: 'Shop was closed when I arrived',
      body: 'I turned up for my appointment and nobody was there.',
    },
  );
  await tickets.transitionStatus({
    ticketId: disputed.id,
    to: 'IN_PROGRESS',
    actor: 'ADMIN',
    actorUserId: admin.id,
    actorRole: UserRole.ADMIN,
  });
  await tickets.transitionStatus({
    ticketId: disputed.id,
    to: 'RESOLVED',
    actor: 'ADMIN',
    actorUserId: admin.id,
    actorRole: UserRole.ADMIN,
    resolutionNote: 'Confirmed with the business. Refunding the platform fee.',
    billingAdjustment: {
      appointmentId: (
        await prisma.appointment.findFirstOrThrow({
          where: { customerId: deng.id, location: { businessId: thongpiny.businessId } },
        })
      ).id,
      type: 'FEE_REFUND',
      amount: 1.5,
      reason: 'Demo data: goodwill fee refund after a dispute.',
    },
  });

  // Executing it is what turns the decision into money (§36.5).
  const adjustment = await prisma.billingAdjustment.findFirstOrThrow({
    where: { ticketId: disputed.id },
  });
  await prisma.$transaction((tx) =>
    ledger.executeAdjustment(tx, adjustment.id, 'DEMO-SETTLE-1', ADMIN_ACTOR),
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const balances = await Promise.all(
    seeded.map(async (business) => {
      const sum = await prisma.ledgerEntry.aggregate({
        where: { businessId: business.businessId, payoutId: null },
        _sum: { amountMinor: true, settlementAmountMinor: true },
      });
      return {
        label: business.label,
        usd: sum._sum.amountMinor ?? 0,
        ssp: sum._sum.settlementAmountMinor ?? 0,
      };
    }),
  );

  const counts = {
    businesses: seeded.length,
    locations: await prisma.location.count(),
    services: await prisma.service.count(),
    appointments: await prisma.appointment.count(),
    ledgerEntries: await prisma.ledgerEntry.count(),
    reviews: await prisma.review.count(),
    tickets: await prisma.ticket.count(),
  };

  const lines: string[] = [
    '',
    '='.repeat(78),
    'DEMO DATA SEEDED',
    '='.repeat(78),
    '',
    'LOG IN AS (OTP flow — request a code, then read it from the Mailhog inbox',
    'at http://localhost:8025, or from the backend log if SMTP is unconfigured):',
    '',
    `  admin      ${admin.email}`,
    `  customer   ${amal.email}   (display name "Amal K.")`,
    `  customer   ${peter.email}   (no display name — renders as "Anonymous")`,
    '',
    'BUSINESSES AND WHY EACH ONE IS INTERESTING:',
    '',
  ];

  for (const business of seeded) {
    const balance = balances.find((b) => b.label === business.label)!;
    lines.push(`  ${business.label}`);
    lines.push(`    owner        ${business.email}`);
    lines.push(`    businessId   ${business.businessId}`);
    lines.push(`    locationId   ${business.locationIds.join(', ')}`);
    lines.push(
      `    unsettled    ${INTERNAL_CURRENCY} ${balance.ssp} minor` +
        (balance.usd === balance.ssp
          ? ''
          : ` (reporting ${INTERNAL_CURRENCY} ${balance.usd})`),
    );
    lines.push(`    note         ${business.note}`);
    lines.push('');
  }

  lines.push('HANDY IDS:');
  lines.push(`  verification code on every seeded appointment:  ${DEMO_VERIFICATION_CODE}`);
  lines.push(`  open ticket:      ${openTicket.id}`);
  lines.push(`  resolved ticket:  ${disputed.id}`);
  lines.push(`  hidden review:    ${reviewIds[reviewIds.length - 1]}`);
  lines.push(
    `  currency:         ${INTERNAL_CURRENCY} throughout — priced, charged and settled in it,\n` +
      '                    so no conversion happens anywhere (§66).',
  );
  lines.push('');
  lines.push(
    `COUNTS: ${counts.businesses} businesses, ${counts.locations} locations, ` +
      `${counts.services} services, ${counts.appointments} appointments, ` +
      `${counts.ledgerEntries} ledger entries, ${counts.reviews} reviews, ` +
      `${counts.tickets} tickets.`,
  );
  lines.push('');
  lines.push('Next: docs/MANUAL_WALKTHROUGH.md');
  lines.push('='.repeat(78));

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  await app.close();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('\nDemo seed failed:\n', error);
  const prisma = new PrismaClient();
  await prisma.$disconnect();
  process.exit(1);
});
