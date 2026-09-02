import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  BusinessStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../src/prisma/prisma.service';

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
    priceCents?: number;
    depositPercentage?: number;
    status?: BusinessStatus;
    durationMinutes?: number;
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
      priceCents: options.priceCents ?? 4500,
      durationMinutes: options.durationMinutes ?? 60,
      depositPercentage: options.depositPercentage ?? 20,
    },
  });

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
) {
  const email = uniqueEmail('member');
  const user = await prisma.user.create({ data: { email, role: UserRole.BUSINESS } });
  await prisma.businessMembership.create({
    data: {
      userId: user.id,
      businessProfileId: businessId,
      role,
      status: BusinessMemberStatus.ACTIVE,
    },
  });
  return { userId: user.id, email };
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
      depositAmountCents: 900,
      platformFeeAmountCents: 450,
      businessAmountCents: 450,
      currency: 'USD',
      verificationCodeHash: await bcrypt.hash(KNOWN_VERIFICATION_CODE, 10),
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
