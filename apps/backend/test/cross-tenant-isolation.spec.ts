import { AppointmentStatus, BusinessStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { LocationsService } from '../src/business/locations.service';
import { ServicesService } from '../src/business/services.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { ChatService } from '../src/chat/chat.service';
import { StorageService } from '../src/storage/storage.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Isolation is enforced structurally: every query is scoped to the caller, so
 * another tenant's row never matches. The status must be 404 rather than 403 —
 * confirming a resource exists but belongs to someone else is itself a leak
 * (§10.7). NotFoundException is what Nest maps to 404, so asserting the
 * exception type asserts the status.
 */
describe('Cross-tenant isolation', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let locations: LocationsService;
  let services: ServicesService;
  let appointments: AppointmentsService;
  let chat: ChatService;

  // Two entirely unrelated businesses, and two unrelated customers.
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let alphaCustomer: { userId: string; email: string };
  let betaCustomer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessAccessService,
      LocationsService,
      ServicesService,
      AppointmentsService,
      AvailabilityService,
      PlatformSettingsService,
      ChatService,
      StorageService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    locations = moduleRef.get(LocationsService);
    services = moduleRef.get(ServicesService);
    appointments = moduleRef.get(AppointmentsService);
    chat = moduleRef.get(ChatService);

    await resetDatabase(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    alphaCustomer = await createCustomer(prisma);
    betaCustomer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  /** Asserts the rejection is a 404-mapping NotFoundException, not a 403. */
  const expect404 = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
  };

  describe('Location', () => {
    it("business B cannot read business A's location list into its own", async () => {
      const own = await locations.findAll(beta.userId);

      expect(own.every((l) => l.id !== alpha.locationId)).toBe(true);
    });

    it("business B gets 404 updating business A's location", async () => {
      await expect404(
        locations.update(beta.userId, alpha.locationId, { name: 'Hijacked' }),
      );
    });

    it("business B gets 404 deleting business A's location", async () => {
      await expect404(locations.remove(beta.userId, alpha.locationId));
    });

    it("business B gets 404 setting hours on business A's location", async () => {
      await expect404(
        locations.setHours(beta.userId, alpha.locationId, {
          hours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '17:00' }],
        }),
      );
    });

    it("business B gets 404 changing capacity on business A's location", async () => {
      await expect404(locations.setCapacity(beta.userId, alpha.locationId, 5));
    });

    it("business A's location is untouched after B's attempts", async () => {
      const location = await prisma.location.findUniqueOrThrow({
        where: { id: alpha.locationId },
      });

      expect(location.name).toBe('Test Branch');
      expect(location.capacity).toBe(1);
    });
  });

  describe('Service', () => {
    it("business B gets 404 updating business A's service", async () => {
      await expect404(services.update(beta.userId, alpha.serviceId, { priceCents: 1 }));
    });

    it("business B gets 404 deactivating business A's service", async () => {
      await expect404(services.deactivate(beta.userId, alpha.serviceId));
    });

    it("business A's service keeps its price after B's attempt", async () => {
      const service = await prisma.service.findUniqueOrThrow({
        where: { id: alpha.serviceId },
      });

      expect(service.priceCents).toBe(4500);
      expect(service.isActive).toBe(true);
    });

    it("business B's service list excludes business A's services", async () => {
      const own = await services.findAll(beta.userId);

      expect(own.every((s) => s.id !== alpha.serviceId)).toBe(true);
    });
  });

  describe('Appointment', () => {
    let alphaAppointment: { id: string };

    beforeAll(async () => {
      alphaAppointment = await createAppointment(prisma, {
        business: alpha,
        customerId: alphaCustomer.userId,
        status: AppointmentStatus.BOOKED,
      });
    });

    it("another customer gets 404 reading someone else's appointment", async () => {
      await expect404(appointments.findOne(betaCustomer.userId, alphaAppointment.id));
    });

    it("another customer gets 404 cancelling someone else's appointment", async () => {
      await expect404(appointments.cancel(betaCustomer.userId, alphaAppointment.id));
    });

    it("another customer gets 404 paying for someone else's appointment", async () => {
      await expect404(
        appointments.initiateDepositPayment(
          betaCustomer.userId,
          alphaAppointment.id,
          '260962217114',
        ),
      );
    });

    it("business B gets 404 verifying business A's appointment", async () => {
      await expect404(appointments.verify(beta.userId, alphaAppointment.id, '123456'));
    });

    it("business B gets 404 completing business A's appointment", async () => {
      await expect404(appointments.complete(beta.userId, alphaAppointment.id));
    });

    it("business B gets 404 marking business A's appointment a no-show", async () => {
      await expect404(appointments.noShow(beta.userId, alphaAppointment.id));
    });

    it("business B's appointment list excludes business A's appointments", async () => {
      const list = await appointments.findAll(beta.userId, 'BUSINESS', {});

      expect(list.appointments.every((a) => a.id !== alphaAppointment.id)).toBe(true);
      expect(list.total).toBe(0);
    });

    it("the customer's own list contains only their own appointments", async () => {
      const list = await appointments.findAll(betaCustomer.userId, 'CUSTOMER', {});

      expect(list.total).toBe(0);
    });

    it('the legitimate participants can still reach it', async () => {
      await expect(
        appointments.findOne(alphaCustomer.userId, alphaAppointment.id),
      ).resolves.toBeDefined();
      await expect(
        appointments.findOne(alpha.userId, alphaAppointment.id),
      ).resolves.toBeDefined();
    });

    it("business A's appointment is still BOOKED after every attempt", async () => {
      const after = await prisma.appointment.findUniqueOrThrow({
        where: { id: alphaAppointment.id },
      });

      expect(after.status).toBe(AppointmentStatus.BOOKED);
    });
  });

  describe('Thread', () => {
    let alphaThread: { id: string };

    beforeAll(async () => {
      alphaThread = await chat.createInquiryThread(alphaCustomer.userId, alpha.businessId);
    });

    it("another customer gets 404 reading someone else's thread", async () => {
      await expect404(chat.getThread(betaCustomer.userId, alphaThread.id, 'CUSTOMER'));
    });

    it("another customer gets 404 listing someone else's messages", async () => {
      await expect404(
        chat.listMessages(betaCustomer.userId, alphaThread.id, 'CUSTOMER', 50, 0),
      );
    });

    it("another customer gets 404 posting into someone else's thread", async () => {
      await expect404(
        chat.sendMessage({
          userId: betaCustomer.userId,
          role: 'CUSTOMER',
          threadId: alphaThread.id,
          body: 'I should not be here',
        }),
      );
    });

    it("another customer gets 404 marking someone else's thread read", async () => {
      await expect404(chat.markRead(betaCustomer.userId, alphaThread.id, 'CUSTOMER'));
    });

    it("business B gets 404 reading business A's thread", async () => {
      await expect404(chat.getThread(beta.userId, alphaThread.id, 'BUSINESS'));
    });

    it("business B gets 404 posting into business A's thread", async () => {
      await expect404(
        chat.sendMessage({
          userId: beta.userId,
          role: 'BUSINESS',
          threadId: alphaThread.id,
          body: 'Not my conversation',
        }),
      );
    });

    it("business B's thread list is empty", async () => {
      const list = await chat.listThreads(beta.userId, 'BUSINESS', 25, 0);

      expect(list.total).toBe(0);
    });

    it('both legitimate participants can reach the thread', async () => {
      await expect(
        chat.getThread(alphaCustomer.userId, alphaThread.id, 'CUSTOMER'),
      ).resolves.toBeDefined();
      await expect(
        chat.getThread(alpha.userId, alphaThread.id, 'BUSINESS'),
      ).resolves.toBeDefined();
    });

    it('no stray messages were written by the rejected attempts', async () => {
      const count = await prisma.message.count({ where: { threadId: alphaThread.id } });

      expect(count).toBe(0);
    });
  });

  describe('a non-APPROVED business is indistinguishable from a missing one', () => {
    it('returns 404 rather than revealing that a PENDING business exists', async () => {
      const pending = await createBusiness(prisma, { status: BusinessStatus.PENDING });

      await expect404(
        chat.createInquiryThread(betaCustomer.userId, pending.businessId),
      );
    });
  });
});
