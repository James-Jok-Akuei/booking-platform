import { INTERNAL_CURRENCY } from '../../src/payments/currency';
import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  BusinessStatus,
  PayoutDestinationStatus,
  PayoutVerificationMethod,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { recalculateFromPrice } from '../../src/business/from-price';

let counter = 0;
/** Unique per call, so suites never collide on the one-email-one-account rule. */
export const uniqueEmail = (prefix: string) =>
  `${prefix}.${Date.now()}.${counter++}@test.local`;

export interface TestBusiness {
  userId: string;
  email: string;
  businessId: string;
  locationId: string;
  serviceId: string;
}

/**
 * A complete, bookable business: owner account, APPROVED profile, a location
 * open 09:00-17:00 every day, and one service.
 *
 * Bookable end-to-end on purpose — availability (§12) refuses slots outside
 * opening hours and for non-APPROVED businesses, so a half-built fixture would
 * fail for reasons unrelated to what a test is asserting.
 */
export async function createBusiness(
  prisma: PrismaService,
  options: {
    capacity?: number;
    priceMinor?: number;
    depositPercentage?: number;
    status?: BusinessStatus;
    durationMinutes?: number;
    /**
     * The payout destination to seed (§48). Defaults to VERIFIED, because a
     * business that cannot be paid is a special case, not the normal one — and
     * without it every payout fixture would silently be paused. Pass 'NONE' or
     * 'UNVERIFIED' for the cases that are about exactly that.
     */
    payoutDestination?: 'VERIFIED' | 'UNVERIFIED' | 'NONE';
  } = {},
): Promise<TestBusiness> {
  const email = uniqueEmail('owner');
  const user = await prisma.user.create({
    data: { email, role: UserRole.BUSINESS },
  });

  const business = await prisma.businessProfile.create({
    data: {
      name: 'Test Salon',
      status: options.status ?? BusinessStatus.APPROVED,
      // A complete shop that has asked to be reviewed (§255), as every shop
      // with a name was under the rule before it — and as the migration made them.
      submittedAt: new Date(),
      // And, once approved, posted by its owner (§268) — a complete shop is
      // one customers can find.
      // A suspended shop was approved and posted before it was suspended.
      publishedAt: ([BusinessStatus.APPROVED, BusinessStatus.SUSPENDED] as BusinessStatus[]).includes(
        options.status ?? BusinessStatus.APPROVED,
      )
        ? new Date()
        : null,
      members: {
        create: {
          userId: user.id,
          role: BusinessMemberRole.OWNER,
          status: BusinessMemberStatus.ACTIVE,
        },
      },
    },
  });

  const location = await prisma.location.create({
    data: {
      businessId: business.id,
      name: 'Test Branch',
      address: 'Test Road, Juba',
      capacity: options.capacity ?? 1,
      hours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          openTime: '09:00',
          closeTime: '17:00',
          isClosed: false,
        })),
      },
    },
  });

  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      name: 'Test Service',
      currency: INTERNAL_CURRENCY,
      durationMinutes: options.durationMinutes ?? 60,
      depositPercentage: options.depositPercentage ?? 20,
      // Offered at this business's branch, at this branch's price (§72). A
      // service with no offer row is bookable nowhere, so a fixture without
      // one would make every booking test fail for the wrong reason.
      locations: {
        create: [{ locationId: location.id, priceMinor: options.priceMinor ?? 4500 }],
      },
    },
  });

  if ((options.payoutDestination ?? 'VERIFIED') !== 'NONE') {
    const verified = (options.payoutDestination ?? 'VERIFIED') === 'VERIFIED';
    await prisma.payoutDestination.create({
      data: {
        businessId: business.id,
        msisdn: `+21192${String(Date.now()).slice(-7)}`,
        submittedById: user.id,
        status: verified
          ? PayoutDestinationStatus.VERIFIED
          : PayoutDestinationStatus.UNVERIFIED,
        ...(verified
          ? {
              verificationMethod: PayoutVerificationMethod.ADMIN,
              verificationNote: 'Seeded fixture.',
              verifiedAt: new Date(),
            }
          : {}),
      },
    });
  }

  // Location.fromPriceMinor is a denormalised aggregate maintained by the
  // service and location write paths (§44). A fixture that writes rows straight
  // to the database bypasses those, so it must maintain it too — otherwise
  // every factory-built location would look like a business with no services.
  await recalculateFromPrice(prisma, business.id);

  return {
    userId: user.id,
    email,
    businessId: business.id,
    locationId: location.id,
    serviceId: service.id,
  };
}

export async function createCustomer(prisma: PrismaService) {
  const email = uniqueEmail('customer');
  const user = await prisma.user.create({
    data: { email, role: UserRole.CUSTOMER },
  });
  return { userId: user.id, email };
}

/** Adds a member in a given role to an existing business. */
export async function addMember(
  prisma: PrismaService,
  businessId: string,
  role: BusinessMemberRole,
  /** The branches they look after (§277). Left out: every branch. */
  locationIds?: string[],
) {
  const email = uniqueEmail('member');
  const user = await prisma.user.create({ data: { email, role: UserRole.BUSINESS } });
  const membership = await prisma.businessMembership.create({
    data: {
      userId: user.id,
      businessProfileId: businessId,
      role,
      status: BusinessMemberStatus.ACTIVE,
      allLocations: !locationIds,
      ...(locationIds && { locations: { create: locationIds.map((locationId) => ({ locationId })) } }),
    },
  });
  return { userId: user.id, email, membershipId: membership.id };
}

export const KNOWN_VERIFICATION_CODE = '123456';

/**
 * Creates an appointment directly in a chosen state.
 *
 * Written straight to the database rather than driven through the booking flow,
 * because the state-machine suite needs an appointment in each state and the
 * only supported route to some of them runs through the very transitions under
 * test. The verification hash is a KNOWN code so IN_PROGRESS is reachable.
 */
export async function createAppointment(
  prisma: PrismaService,
  params: {
    business: TestBusiness;
    customerId: string;
    status: AppointmentStatus;
    startsInHours?: number;
    durationMinutes?: number;
    verified?: boolean;
    /**
     * What the provider charged, in settlement minor units (§45). Defaults to
     * 900 USD cents at 650 SSP/USD, matching the hardcoded money below — a real
     * paid appointment always has this, and without it every ledger entry a
     * fixture produces is unpayable. Pass null for the pre-§45 shape.
     */
    providerCharge?: number | null;
  },
) {
  const start = new Date(Date.now() + (params.startsInHours ?? 48) * 3_600_000);
  const end = new Date(start.getTime() + (params.durationMinutes ?? 60) * 60_000);

  return prisma.appointment.create({
    data: {
      locationId: params.business.locationId,
      serviceId: params.business.serviceId,
      customerId: params.customerId,
      startTime: start,
      endTime: end,
      status: params.status,
      depositAmountMinor: 900,
      platformFeeAmountMinor: 450,
      businessAmountMinor: 450,
      currency: 'USD',
      ...(params.providerCharge === null
        ? {}
        : {
            providerCurrency: 'SSP',
            providerAmountMinor: params.providerCharge ?? 585_000,
            exchangeRateUsed: 650,
          }),
      verificationCodeHash: await bcrypt.hash(KNOWN_VERIFICATION_CODE, 10),
      // The readable copy the customer's own app shows (§54.2). Written here
      // too, from the same constant, because a fixture that sets only the hash
      // is a pre-§54 row — and a suite whose every appointment looks pre-§54
      // cannot test the display path at all.
      verificationCode: KNOWN_VERIFICATION_CODE,
      verifiedAt: params.verified ? new Date() : null,
    },
  });
}

/** A seeded ADMIN. Per §3 admins are never self-service, so tests create them directly. */
export async function createAdmin(prisma: PrismaService) {
  const email = uniqueEmail('admin');
  const user = await prisma.user.create({ data: { email, role: UserRole.ADMIN } });
  return { userId: user.id, email };
}

/** The caller shape TicketsService expects, mirroring the JWT payload. */
export const asUser = (userId: string, role: string) => ({ userId, role });

/** The next occurrence of a given local hour, on the grid, comfortably ahead. */
export function futureSlot(daysAhead: number, utcHour: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}
